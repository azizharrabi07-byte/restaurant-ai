-- ============================================================================
-- Production-readiness migration for Sufra / restaurant-ai
-- ============================================================================
-- Run this file in the Supabase SQL editor. It is idempotent and safe to
-- re-run. It assumes the tables created by earlier (ad-hoc) migrations exist
-- (restaurants, categories, products, restaurant_tables, orders, order_items,
-- workers, worker_invites).
--
-- What this adds:
--   1. Atomic daily order-number allocation (counter row + RPC).
--   2. Unique backstop index for daily ticket numbers (after dedupe).
--   3. Idempotency support for order creation (order.client_ref).
--   4. Product sort_order for stable menu ordering.
--   5. Worker-table hardening (session_token, expires_at) + one-time invites.
--   6. Check constraints for money/quantity integrity.
--   7. RLS lockdown (defense-in-depth; the app runs on the service role and
--      is unaffected by these policies, but direct anon-key access is).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ATOMIC DAILY ORDER NUMBERS
-- ---------------------------------------------------------------------------
-- A counter row per (restaurant_id, day). The function below uses an atomic
-- UPSERT: one statement, an implicit row lock, and `last_number` is returned
-- already incremented. Safe under concurrency.

CREATE TABLE IF NOT EXISTS public.sufra_daily_counters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day           date NOT NULL DEFAULT CURRENT_DATE,
  last_number   integer NOT NULL DEFAULT 1001,
  PRIMARY KEY (restaurant_id, day)
);

CREATE OR REPLACE FUNCTION public.sufra_next_order_number(p_restaurant uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  INSERT INTO public.sufra_daily_counters AS c (restaurant_id, day, last_number)
  VALUES (p_restaurant, CURRENT_DATE, 1001)
  ON CONFLICT (restaurant_id, day)
  DO UPDATE SET last_number = c.last_number + 1
  RETURNING c.last_number;
$$;

-- Allow the service-role app to call the function.
GRANT EXECUTE ON FUNCTION public.sufra_next_order_number(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. UNIQUE BACKSTOP + DEDUPE
-- ---------------------------------------------------------------------------
-- Re-number existing orders so the unique index below can be created even if
-- earlier bugs produced duplicate daily numbers.
--
-- NOTE: the unique index cannot use (created_at::date) directly — casting
-- timestamptz to date is timezone-dependent (STABLE), and Postgres rejects
-- non-IMMUTABLE expressions in indexes (42P17). Instead we keep a real
-- order_day column in sync with a trigger and index that.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_day date;

CREATE OR REPLACE FUNCTION public.sufra_set_order_day()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.order_day := ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'UTC')::date;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sufra_orders_set_day ON public.orders;
CREATE TRIGGER sufra_orders_set_day
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sufra_set_order_day();

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY restaurant_id, created_at::date
      ORDER BY created_at, id
    ) AS rn
  FROM public.orders
)
UPDATE public.orders o
SET daily_order_number = 1000 + ranked.rn
FROM ranked
WHERE o.id = ranked.id
  AND o.daily_order_number IS DISTINCT FROM (1000 + ranked.rn);

UPDATE public.orders
SET order_day = (created_at AT TIME ZONE 'UTC')::date
WHERE order_day IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_daily_number_unique
  ON public.orders (restaurant_id, order_day, daily_order_number);

-- ---------------------------------------------------------------------------
-- 3. IDEMPOTENCY (duplicate click / retry protection)
-- ---------------------------------------------------------------------------
-- Clients may send a stable client_ref (uuid) per order attempt. If the same
-- ref is re-used within the day for the same restaurant, the API returns the
-- existing order instead of creating a duplicate.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_ref uuid;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_ref_unique
  ON public.orders (restaurant_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- Who accepted an order (worker attribution). Written by the API from a
-- verified worker session; NULL when an order has not been accepted.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accepted_by uuid;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accepted_by_name text;

-- ---------------------------------------------------------------------------
-- 4. PRODUCT ORDERING
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill: existing products keep their insertion order.
WITH seq AS (
  SELECT id, row_number() OVER (
    PARTITION BY restaurant_id ORDER BY created_at, id
  ) - 1 AS rn
  FROM public.products
)
UPDATE public.products p
SET sort_order = seq.rn
FROM seq
WHERE p.id = seq.id
  AND p.sort_order = 0;

CREATE INDEX IF NOT EXISTS products_menu_order
  ON public.products (restaurant_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- 5. WORKER TABLES (server-side invites + sessions)
-- ---------------------------------------------------------------------------
-- Live schema already provides: workers(restaurant_id, full_name, role,
-- created_at) and worker_invites(invite_token, role, is_used, used_by,
-- expires_at, created_at). We only add the server-session column on workers.
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS session_token text UNIQUE;

CREATE INDEX IF NOT EXISTS worker_invites_token_idx ON public.worker_invites (invite_token);
CREATE INDEX IF NOT EXISTS workers_session_token_idx ON public.workers (session_token);
CREATE INDEX IF NOT EXISTS workers_restaurant_idx ON public.workers (restaurant_id);

-- ---------------------------------------------------------------------------
-- 6. MONEY / QUANTITY CHECK CONSTRAINTS
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_price_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_price_check CHECK (price >= 0 AND price <= 999999);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_total_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_check CHECK (total >= 0 AND total <= 10000000);

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_quantity_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 1 AND quantity <= 500);

-- Regular integers for prices are recommended; existing money columns are
-- kept as-is but the manual `price_snapshot` column is clamped on write by the
-- API (see src/lib/order-utils.ts).

-- ---------------------------------------------------------------------------
-- 7. RLS LOCKDOWN (defense-in-depth)
-- ---------------------------------------------------------------------------
-- The REST API runs with the service role, which bypasses RLS. These policies
-- exist so that an exposed anon/public key cannot read or mutate private data.

ALTER TABLE public.restaurants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_invites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sufra_daily_counters ENABLE ROW LEVEL SECURITY;

-- Helper: is the current authenticated user the owner of a restaurant?
CREATE OR REPLACE FUNCTION public.sufra_is_owner(p_restaurant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE id = p_restaurant AND owner_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.sufra_is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sufra_is_owner(uuid) TO service_role;

-- Restaurants: only the owner can READ/MODIFY. No anonymous reads at all.
-- (The public menu is served by the server component using the service role.)
DROP POLICY IF EXISTS "restaurants_owner_all" ON public.restaurants;
CREATE POLICY "restaurants_owner_all"
  ON public.restaurants
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Owner-scoped policies for every restaurant-owned table.
-- NOTE: order_items has no restaurant_id column — it is scoped through its
-- parent order (see the dedicated policy below).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','products','restaurant_tables','orders']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_all" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_owner_all" ON public.%I FOR ALL TO authenticated USING (public.sufra_is_owner(restaurant_id)) WITH CHECK (public.sufra_is_owner(restaurant_id))', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "order_items_owner_all" ON public.order_items;
CREATE POLICY "order_items_owner_all"
  ON public.order_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.sufra_is_owner(o.restaurant_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND public.sufra_is_owner(o.restaurant_id)
    )
  );

-- Workers: owner manages. Workers are NOT Supabase auth users — their
-- sessions are opaque server-side tokens checked by the API (service role),
-- so no `auth.uid()`-based self-read policy exists.
DROP POLICY IF EXISTS "workers_self_read" ON public.workers;
DROP POLICY IF EXISTS "workers_owner_all" ON public.workers;
CREATE POLICY "workers_owner_all"
  ON public.workers
  FOR ALL
  TO authenticated
  USING (public.sufra_is_owner(restaurant_id))
  WITH CHECK (public.sufra_is_owner(restaurant_id));

DROP POLICY IF EXISTS "worker_invites_accept" ON public.worker_invites;
DROP POLICY IF EXISTS "worker_invites_owner_all" ON public.worker_invites;
CREATE POLICY "worker_invites_owner_all"
  ON public.worker_invites
  FOR ALL
  TO authenticated
  USING (public.sufra_is_owner(restaurant_id))
  WITH CHECK (public.sufra_is_owner(restaurant_id));

-- NOTE: there is deliberately NO public/unauthenticated policy on
-- worker_invites. Invite redemption runs through the service-role API
-- (`POST /api/auth/worker/accept`), never through the anon key, so invite
-- tokens are never readable over PostgREST.

-- Safeguard: the migration must never leave `using (true)` policies behind.
DROP POLICY IF EXISTS "public_read_all" ON public.restaurants;
DROP POLICY IF EXISTS "public_read_all" ON public.categories;
DROP POLICY IF EXISTS "public_read_all" ON public.products;
DROP POLICY IF EXISTS "public_read_all" ON public.restaurant_tables;
DROP POLICY IF EXISTS "public_read_all" ON public.orders;
DROP POLICY IF EXISTS "public_read_all" ON public.order_items;

-- ---------------------------------------------------------------------------
-- 8. MENU IMAGE STORAGE (Supabase Storage, public read)
-- ---------------------------------------------------------------------------
-- Persistent restaurant/menu images live in the `menu-images` bucket as files;
-- the database stores only their public URLs (never multi-MB base64).
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
CREATE POLICY "menu_images_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'menu-images');

-- ---------------------------------------------------------------------------
-- 9. WORKER MODEL ALIGNMENT (token sessions, not auth-user-linked rows)
-- ---------------------------------------------------------------------------
-- Workers authenticate with opaque server-side session tokens, NOT Supabase
-- Auth accounts, so their rows must not be tied to auth users and the role
-- check must accept the app's role values. (Legacy ad-hoc constraints did
-- both: workers_id_fkey required id ∈ users, and the role check rejected
-- 'Cashier'/'Manager' — every worker insert failed.)
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_id_fkey;
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_role_check CHECK (role IN ('Cashier', 'Manager', 'cashier', 'manager'));
ALTER TABLE public.workers ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_role_check;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_role_check CHECK (role IN ('Cashier', 'Manager', 'cashier', 'manager'));