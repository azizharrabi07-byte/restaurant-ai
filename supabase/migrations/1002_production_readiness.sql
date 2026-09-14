-- ============================================================================
-- Production-readiness migration for Sufra / restaurant-ai
-- ============================================================================
-- Run this file in the Supabase SQL editor. It is idempotent and safe to
-- re-run. It assumes the tables created by earlier (ad-hoc) migrations exist
-- (restaurants, categories, products, restaurant_tables, orders, order_items,
-- workers, worker_invites).
--
-- SAFE TO RE-RUN (revisited): the earlier revision was NOT idempotent despite
-- claiming to be — its dedupe block renumbered every order on every run
-- (DB-07). Every statement below is now either naturally idempotent
-- (IF EXISTS / IF NOT EXISTS / ON CONFLICT) or explicitly guarded so a second
-- run is a no-op on a healthy database. The statements are also defended
-- against the partial state a previous failed run can leave behind.
--
-- ORDERING: on a FRESH project run `0001_init_schema.sql` FIRST, then this
-- file. 0001 creates the base tables, the PK defaults, the unique constraints
-- and the helper functions; 1002 adds the counters/RPC, order_day, the CHECKs
-- and RLS, and repairs databases built by the original ad-hoc migrations.
-- Running 1002 first fails with 42P01 (undefined_table).
--
-- What this adds / repairs:
--   1. Atomic daily order-number allocation (counter row + RPC), UTC-keyed.
--   2. Unique backstop index for daily ticket numbers, after repairing only
--      the genuinely broken rows (never a blanket renumber; DB-07/DB-09).
--   3. Idempotency support for order creation (order.client_ref).
--   4. Product sort_order for stable menu ordering.
--   5. Worker-table hardening (session_token, expires_at) + one-time invites,
--      including a fail-closed invite expiry (LIB-25).
--   6. Check constraints for money/quantity integrity, added NOT VALID so a
--      dirty legacy row cannot abort the migration (DB-12).
--   7. RLS lockdown (defense-in-depth; the app runs on the service role and
--      is unaffected by these policies, but direct anon-key access is), with
--      a name-independent sweep of leftover permissive policies (DB-06).
--   8. Menu image storage bucket + public-read policy.
--   9. Worker model alignment: drop the legacy FK to auth.users and relax
--      both role checks so worker inserts are accepted.
--  10. Primary-key defaults for the tables the app inserts without an id
--      (DB-13).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ATOMIC DAILY ORDER NUMBERS
-- ---------------------------------------------------------------------------
-- A counter row per (restaurant_id, day). The function below uses an atomic
-- UPSERT: one statement, an implicit row lock, and `last_number` is returned
-- already incremented. Safe under concurrency.
--
-- DB-08: the counter key MUST use the same definition of "day" as the unique
-- index in section 2 (UTC). The previous revision used the session-timezone
-- CURRENT_DATE here but UTC for `order_day`; on any server whose TimeZone is
-- not UTC the counter rolled over to a new day while the index still keyed
-- yesterday's UTC numbers, so the first order after local midnight raised
-- 23505, was retried 8 times, and returned 500 CREATE_ORDER.

CREATE TABLE IF NOT EXISTS public.sufra_daily_counters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day           date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  last_number   integer NOT NULL DEFAULT 1001,
  PRIMARY KEY (restaurant_id, day)
);

-- DB-08: repair databases where an earlier run created the table with the
-- local-time default. Setting a default twice is a no-op, so this re-runs.
ALTER TABLE public.sufra_daily_counters
  ALTER COLUMN day SET DEFAULT (now() AT TIME ZONE 'UTC')::date;

CREATE OR REPLACE FUNCTION public.sufra_next_order_number(p_restaurant uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
  INSERT INTO public.sufra_daily_counters AS c (restaurant_id, day, last_number)
  VALUES (p_restaurant, (now() AT TIME ZONE 'UTC')::date, 1001)
  ON CONFLICT (restaurant_id, day)
  DO UPDATE SET last_number = c.last_number + 1
  RETURNING c.last_number;
$$;

-- Allow the service-role app to call the function.
GRANT EXECUTE ON FUNCTION public.sufra_next_order_number(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. UNIQUE BACKSTOP + DEDUPE
-- ---------------------------------------------------------------------------
-- Re-number ONLY the orders that genuinely need it, so the unique index below
-- can be created even if earlier bugs produced duplicate or NULL daily
-- numbers.
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

-- Backfill the UTC day for rows written before the trigger existed.
-- Re-runnable: only NULL rows are touched, so a second run matches nothing.
UPDATE public.orders
SET order_day = (created_at AT TIME ZONE 'UTC')::date
WHERE order_day IS NULL;

-- DB-07 + DB-09: repair, not renumber.
--
-- The previous revision assigned `1000 + row_number()` to every row whose
-- number differed from that formula, on every run — silently rewriting ticket
-- numbers a kitchen had already printed (DB-07) — and it did so in
-- session-local partitions while the index keys on UTC (DB-09), which could
-- itself raise 23505 and abort the migration.
--
--   * daily_order_number IS NULL, or
--   * the same number already appears more than once inside one
--     (restaurant_id, UTC day) group.
-- Every other row keeps its historical number, gaps included.
--
-- DB-09: the partition below uses the very expression `order_day` is derived
-- from — `(COALESCE(created_at, now()) AT TIME ZONE 'UTC')::date` — so the
-- grouping agrees with the unique index instead of drifting with the session
-- TimeZone.
--
-- How the guard achieves idempotency: `same_number` is counted over the
-- (restaurant_id, UTC day, daily_order_number) key the unique index enforces.
-- After the first successful run no NULL remains and no group has
-- same_number > 1 (the index forbids it), so the `needs` CTE is empty, the
-- UPDATE matches zero rows, and every later run is a no-op. Repaired rows are
-- numbered `max(existing number in the partition) + row_number()`, i.e.
-- strictly above every number already present, so a repaired row can never
-- collide with an untouched one.
WITH part AS (
  SELECT
    id,
    restaurant_id,
    created_at,
    daily_order_number,
    (COALESCE(created_at, now()) AT TIME ZONE 'UTC')::date AS utc_day,
    count(*) OVER (
      PARTITION BY restaurant_id,
                   (COALESCE(created_at, now()) AT TIME ZONE 'UTC')::date,
                   daily_order_number
    ) AS same_number,
    max(daily_order_number) OVER (
      PARTITION BY restaurant_id,
                   (COALESCE(created_at, now()) AT TIME ZONE 'UTC')::date
    ) AS max_number
  FROM public.orders
),
needs AS (
  SELECT
    id,
    COALESCE(max_number, 1000) + row_number() OVER (
      PARTITION BY restaurant_id, utc_day
      ORDER BY created_at, id
    ) AS new_number
  FROM part
  WHERE daily_order_number IS NULL
     OR same_number > 1
)
UPDATE public.orders o
SET daily_order_number = needs.new_number
FROM needs
WHERE o.id = needs.id
  AND o.daily_order_number IS DISTINCT FROM needs.new_number;

-- The index is also what makes the repair above one-shot: once it exists,
-- no duplicate group can form again.
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

-- Backfill: existing products keep their insertion order. Only products still
-- sitting at the default 0 are (re)numbered, so this converges after one run.
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
--
-- DB-10: `ADD COLUMN IF NOT EXISTS session_token text UNIQUE` was a silent
-- no-op for the constraint — Postgres skips the ENTIRE clause, UNIQUE
-- included, when the column already exists, so a column created by an earlier
-- partial run (or by the legacy schema) never gained uniqueness and re-running
-- could not repair it. The column and its uniqueness are now two separate,
-- individually re-runnable statements.
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS session_token text;

-- Unique on the bearer credential: with two workers sharing a token,
-- lookupWorkerByToken()'s maybeSingle() returns null for both (logout loop).
CREATE UNIQUE INDEX IF NOT EXISTS workers_session_token_key
  ON public.workers (session_token);

-- DB-10: was a second, redundant index on the same column — pure write
-- amplification. Dropped so re-runs converge on one index.
DROP INDEX IF EXISTS public.workers_session_token_idx;

CREATE INDEX IF NOT EXISTS worker_invites_token_idx ON public.worker_invites (invite_token);
CREATE INDEX IF NOT EXISTS workers_restaurant_idx ON public.workers (restaurant_id);
-- NOTE (DB-11): the uniqueness contracts (restaurants.slug,
-- restaurant_tables (restaurant_id, qr_token) / (restaurant_id, table_number),
-- worker_invites.invite_token) are declared by 0001_init_schema.sql. This file
-- deliberately does not add a UNIQUE on invite_token here: on a legacy
-- database with existing duplicates that would abort the whole migration, and
-- the non-unique index above keeps the lookup fast either way.

-- LIB-25: fail closed on invite expiry. Both readers treated a NULL
-- expires_at as "never expires", which turns such a row into an eternal
-- credential. Backfill the NULLs, then give the column a default and NOT NULL.
-- Guarded on information_schema so a re-run is a no-op and so the block cannot
-- fail when the table or the column is absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_invites'
      AND column_name = 'expires_at'
  ) THEN
    UPDATE public.worker_invites
    SET expires_at = now() + interval '24 hours'
    WHERE expires_at IS NULL;

    ALTER TABLE public.worker_invites
      ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
    ALTER TABLE public.worker_invites
      ALTER COLUMN expires_at SET NOT NULL;
  ELSE
    RAISE NOTICE 'LIB-25: public.worker_invites.expires_at is absent - skipping expiry hardening';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. MONEY / QUANTITY CHECK CONSTRAINTS
-- ---------------------------------------------------------------------------
-- DB-12: each CHECK is added NOT VALID first and validated by the block below.
-- A plain ADD CONSTRAINT scans every existing row and raises 23514 on the
-- first dirty one (a negative price from an OCR import, a legacy
-- quantity = 0), which aborted the whole migration — the counter, RPC and
-- session columns would never land. NOT VALID enforces the rule for every NEW
-- insert/update immediately and leaves the historical rows to the validation
-- step, which reports them instead of aborting. A re-run drops and re-adds
-- each constraint (so historical rows are re-checked) and is safe.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_price_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_price_check CHECK (price >= 0 AND price <= 999999) NOT VALID;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_total_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_check CHECK (total >= 0 AND total <= 10000000) NOT VALID;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_quantity_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 1 AND quantity <= 500) NOT VALID;

-- Validate, but never abort: a 23514 here means the constraint stays NOT VALID
-- (still enforced for new writes) and the offending rows are reported for a
-- manual fix. Already-valid constraints are skipped, so re-runs do not rescan
-- the tables.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('public.products',    'products_price_check'),
      ('public.orders',      'orders_total_check'),
      ('public.order_items', 'order_items_quantity_check')
    ) AS t(tbl, con)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(c.tbl)
        AND conname = c.con
        AND NOT convalidated
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.con);
      EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'DB-12: % on % still has violating rows - left NOT VALID (enforced for new writes); fix the rows and re-run', c.con, c.tbl;
      END;
    END IF;
  END LOOP;
END $$;

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

-- Safeguard (DB-06): the migration must never leave `using (true)` policies
-- behind. The previous revision dropped only policies literally named
-- "public_read_all" on six tables — a name denylist. Any legacy permissive
-- policy under a different name survived, including on `workers` and
-- `worker_invites`, whose rows carry bearer credentials
-- (workers.session_token, worker_invites.invite_token); read over an exposed
-- anon key that is full worker impersonation.
--
-- This sweep is name-independent: it walks pg_policies for every table the app
-- owns and drops any PERMISSIVE policy whose USING expression is literally
-- `true` or whose WITH CHECK expression is literally `true`. Only the
-- policies this migration itself creates (the *_owner_all set and
-- menu_images_public_read) are exempt, and each drop is reported.
--
-- RLS here is pure defense-in-depth: the app talks to Postgres with the
-- SERVICE ROLE, which bypasses RLS entirely, so none of these policies affect
-- the product's own queries — they only close the anon-key door.
DO $$
DECLARE
  p record;
  keep_policies text[] := ARRAY[
    'restaurants_owner_all',
    'categories_owner_all',
    'products_owner_all',
    'restaurant_tables_owner_all',
    'orders_owner_all',
    'order_items_owner_all',
    'workers_owner_all',
    'worker_invites_owner_all',
    'menu_images_public_read'
  ];
  app_tables text[] := ARRAY[
    'restaurants', 'categories', 'products', 'restaurant_tables', 'orders',
    'order_items', 'workers', 'worker_invites', 'sufra_daily_counters'
  ];
BEGIN
  FOR p IN
    SELECT tablename::text AS tablename, policyname::text AS policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename::text = ANY (app_tables)
      AND permissive = 'PERMISSIVE'
      AND (
        lower(btrim(coalesce(qual, ''))) = 'true'
        OR lower(btrim(coalesce(with_check, ''))) = 'true'
      )
  LOOP
    IF p.policyname = ANY (keep_policies) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'DB-06: dropped permissive RLS policy % on public.% (using/with check true)', p.policyname, p.tablename;
  END LOOP;
END $$;

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

-- ---------------------------------------------------------------------------
-- 10. PRIMARY-KEY DEFAULTS FOR APP-INSERTED ROWS
-- ---------------------------------------------------------------------------
-- DB-13: the app inserts rows without supplying a primary key — restaurants
-- (src/app/api/menu/route.ts), orders and order_items
-- (src/app/api/orders/route.ts), worker_invites
-- (src/app/api/auth/worker/invite/route.ts). On a legacy schema whose PKs
-- carry no default, every one of those inserts fails with 23502
-- not_null_violation — that is the whole product, not one screen.
--
-- On a FRESH project 0001_init_schema.sql already declares
-- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` on every table, so this
-- block mainly repairs databases built by the original ad-hoc migrations.
-- gen_random_uuid() is core from PostgreSQL 13 (on older servers create the
-- pgcrypto extension first). Workers already get their default in section 9;
-- the app always supplies restaurants/categories/etc. ids for the other
-- tables, so they are left alone.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['restaurants', 'orders', 'order_items', 'worker_invites']
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name::text = tbl
         AND column_name = 'id'
       )
    THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', tbl);
    ELSE
      RAISE NOTICE 'DB-13: public.% has no id column (or does not exist) - skipping PK default', tbl;
    END IF;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 11. SERVICE-ROLE PRIVILEGES (repair)
-- ---------------------------------------------------------------------------
-- The app runs entirely on the service role, so it needs SELECT/INSERT/UPDATE/
-- DELETE on these tables. Creating a table does not grant access to it, and a
-- database built by an earlier revision of 0001_init_schema.sql came out with
-- only REFERENCES/TRIGGER/TRUNCATE, which makes every app query fail 42501
-- "permission denied for table ...". Verified against a real local Supabase
-- stack. GRANT is idempotent, so this is safe to re-run and safe on a database
-- that already has the privileges.
--
-- `anon` and `authenticated` are intentionally not granted: this product has no
-- anon or user-JWT database path. See 0001_init_schema.sql §7.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

DO $$
BEGIN
  RAISE NOTICE '1002: granted table/sequence/function access to service_role (the role the app runs as)';
END $$;
