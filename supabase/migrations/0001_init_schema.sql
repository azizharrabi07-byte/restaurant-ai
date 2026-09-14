-- ============================================================================
-- 0001_init_schema.sql — Sufra / restaurant-ai BASE SCHEMA (recovered)
-- ============================================================================
-- WHAT THIS IS
--   The missing base schema. The original developer's base tables were never
--   committed: the repo shipped only supabase/migrations/
--   1002_production_readiness.sql, an INCREMENTAL patch whose first statement
--   (`REFERENCES public.restaurants(id)`) fails with 42P01 on a fresh project.
--   This file restores the base from the column-by-column inventory in
--   docs/audit/01-database.md, which is the authoritative contract (every
--   column below is required by at least one call site under src/).
--
-- WHEN TO RUN IT
--   FRESH Supabase projects (or any Postgres with the substitutions below),
--   and ALWAYS BEFORE 1002_production_readiness.sql:
--       1. 0001_init_schema.sql            <- this file
--       2. 1002_production_readiness.sql   (RLS lockdown, dedupe + unique
--          backstop, column backfills, worker/invite CHECKs, bucket row)
--   It is safe to re-run: tables use IF NOT EXISTS, functions are
--   CREATE OR REPLACE, constraints are dropped before being added, indexes use
--   IF NOT EXISTS, and the trigger is dropped before it is recreated.
--
-- SUPABASE-SPECIFIC OBJECTS (substitute these on vanilla PostgreSQL)
--   auth.users        -> your own user table     (restaurants.owner_id FK)
--   auth.uid()        -> your own current-user id (public.sufra_is_owner)
--   role service_role -> your API/server role (bypasses RLS)
--   role authenticated-> your authenticated role
--   storage.buckets, storage.objects -> Supabase Storage only; on plain
--                       Postgres skip the whole STORAGE section at the bottom
--                       (the app calls storage.from("menu-images") directly, so
--                       the app itself does require Supabase Storage).
--   gen_random_uuid() is core PostgreSQL 13+; on older servers install
--   `CREATE EXTENSION pgcrypto;` first.
--
-- DELIBERATELY ABSENT (regressions — do not add)
--   * No trigger on order_items: the original live DB had triggers that
--     rewrote price_snapshot and NULLed custom (manual) lines, which makes
--     every worker manual order fail (src/app/api/orders/route.ts:289-296).
--   * No trigger that rewrites orders.daily_order_number: the original live DB
--     had a racy 1-based max+1 trigger that stomps the atomic RPC below.
--   * No updated_at auto-update trigger: the app writes updated_at itself
--     (src/app/api/menu/route.ts:187 for restaurants, :325 for products), so
--     those columns are plain `timestamptz NOT NULL DEFAULT now()`.
--
-- RLS is NOT set up here — 1002_production_readiness.sql owns it (the app has a
-- single DB client, supabaseAdmin with the service role, which bypasses RLS;
-- the policies are defense-in-depth only).
-- ============================================================================


-- ============================================================================
-- 1. TABLES (FK order: referenced tables first; cross-table FKs in section 2)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- restaurants — the tenant root.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid,                          -- FK -> auth.users (section 2)
  name              text NOT NULL,
  slug              text NOT NULL,                 -- UNIQUE (section 3)
  tagline           text NOT NULL DEFAULT '',
  business_type     text NOT NULL DEFAULT 'cafe',
  currency          text NOT NULL DEFAULT 'TND',
  logo_url          text,
  cover_image       text,
  primary_color     text NOT NULL DEFAULT '#D97706',
  menu_layout_theme text NOT NULL DEFAULT 'classic',
  is_published      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- categories — menu sections, ordered by sort_order. The app always supplies
-- id (upsert onConflict id, src/app/api/menu/route.ts:266-276).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name          text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- products — menu items. price is app-supplied on every write
-- (src/app/api/menu/route.ts:321) and MUST be numeric, never integer/real:
-- a fractional price would be silently rounded and the ticket total would stop
-- matching the lines the guest was shown (src/lib/order-utils.ts:161-163).
--
-- SCALE 3, not 2: the currency is the Tunisian dinar, which is millime-based
-- (1 DT = 1000 millimes). `formatDT` renders 3 decimals (src/lib/format.ts),
-- the OCR import and the scan parser both round to 3
-- (src/lib/menu-import.ts, src/lib/menu-scan.ts), and `lineTotal` /
-- `computeOrderTotal` round at 3 (src/lib/order-utils.ts). A numeric(x,2)
-- column silently rounds on INSERT — verified live: a product written at
-- 4.755 DT read back as 4.76, so the stored price stopped matching the price
-- the guest was charged. 10,3 still holds any plausible menu price.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  category_id   uuid NOT NULL,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  price         numeric(10,3) NOT NULL,
  image_url     text,
  image_source  text NOT NULL DEFAULT 'pending',
  is_available  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- restaurant_tables — QR stands. Both lookups below are `.single()` /
-- `.maybeSingle()` consumers, so the two UNIQUE constraints in section 3 are
-- load-bearing: without them a duplicate 404s the guest menu and ordering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  table_number  integer NOT NULL,
  qr_token      text NOT NULL
);

-- ---------------------------------------------------------------------------
-- orders — one ticket per table order. The app never supplies id, created_at
-- or order_day: id/created_at default here, and order_day is set by the
-- BEFORE INSERT trigger in section 5.
-- `accepted_by` is a WORKER id, not an auth user (workers are not Supabase
-- Auth accounts); its FK is added in section 2 with ON DELETE SET NULL so
-- revoking a worker does not break their historical orders
-- (src/app/api/workers/[id]/route.ts:47).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL,
  table_id           uuid NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  total              numeric(12,3) NOT NULL,   -- millimes; see products.price
  daily_order_number integer NOT NULL,
  is_paid            boolean NOT NULL DEFAULT false,
  client_ref         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_by        uuid,
  accepted_by_name   text,
  paid_at            timestamptz,
  order_day          date NOT NULL
);

-- ---------------------------------------------------------------------------
-- order_items — ticket lines. `product_id` is NULL for worker manual lines and
-- the snapshot columns are the source of truth for what was ordered/charged.
-- Nothing in this schema (or 1002) may add a trigger to this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL,
  product_id            uuid,
  product_name_snapshot text NOT NULL,
  quantity              integer NOT NULL,
  price_snapshot        numeric(10,3) NOT NULL   -- millimes; see products.price
);

-- ---------------------------------------------------------------------------
-- workers — staff accounts. Authenticated by opaque server-side session tokens
-- (7-day cookie, src/lib/worker-auth.ts:20), NOT by Supabase Auth: there must
-- be NO FK from workers.id to auth.users, and no expires_at column.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL,
  session_token text,                              -- UNIQUE (section 3)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- worker_invites — single-use invite links. used_by holds a workers.id
-- (src/app/api/auth/worker/accept/route.ts:119), not an auth user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  invite_token  text NOT NULL,                     -- UNIQUE (section 3)
  role          text NOT NULL,
  is_used       boolean NOT NULL DEFAULT false,
  used_by       uuid,
  expires_at    timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- sufra_daily_counters — one counter row per (restaurant, day), used only
-- through public.sufra_next_order_number(). Shape copied from
-- 1002_production_readiness.sql:27-32 so the RPC's ON CONFLICT target exists,
-- with ONE deliberate difference: `day` is the UTC day, not the session-local
-- day (audit DB-08). The unique backstop on `orders` keys on the UTC
-- `order_day`, so a local-day counter would advance for one day while the index
-- keyed on another and collide with 23505 at the day boundary on any non-UTC
-- server. 1002 re-asserts the same UTC expression, so a database that has run
-- both files agrees; this file must not be run alone and then left un-upgraded.
CREATE TABLE IF NOT EXISTS public.sufra_daily_counters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day           date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  last_number   integer NOT NULL DEFAULT 1001,
  PRIMARY KEY (restaurant_id, day)
);


-- ============================================================================
-- 2. FOREIGN KEYS
-- ============================================================================
-- These are not decoration: PostgREST embedded selects are resolved through
-- FKs. Without orders.table_id -> restaurant_tables, order_items.order_id ->
-- orders and worker_invites.restaurant_id -> restaurants the dashboard shows
-- ZERO orders while rows exist, and every valid invite link 404s
-- (PGRST200 at src/app/api/orders/route.ts:58-63 and
-- src/app/api/auth/worker/invite/[token]/route.ts:22-27 — both sites ignore
-- the error, so the failure is silent).

-- Owner binding. restaurants.owner_id -> auth.users(id) is Supabase-specific,
-- so it is added only when that table exists (vanilla Postgres: substitute your
-- own users table). SET NULL, not CASCADE: deleting an auth user must not
-- delete the restaurant (first-run signup deliberately binds a restaurant row
-- whose owner_id IS NULL, src/app/api/auth/signup/route.ts:88-89).
DO $owner_fk$
DECLARE
  v_orphans bigint;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users not found: skipping restaurants.owner_id FK (non-Supabase server)';
    RETURN;
  END IF;

  -- Orphan guard. ADD CONSTRAINT validates EVERY existing row, so a single
  -- restaurants.owner_id that is not in auth.users raises 23503 and aborts the
  -- entire schema migration — taking every later table, index and function with
  -- it. (Found by rehearsing this file against a live-shaped fixture.) The
  -- column is nullable and the app tolerates a NULL owner (first-run signup
  -- deliberately binds an owner_id IS NULL row), so a bad value is surfaced
  -- loudly and skipped rather than allowed to block everything else.
  SELECT count(*) INTO v_orphans
  FROM public.restaurants r
  LEFT JOIN auth.users u ON u.id = r.owner_id
  WHERE r.owner_id IS NOT NULL AND u.id IS NULL;

  IF v_orphans > 0 THEN
    RAISE WARNING
      'restaurants.owner_id has % orphan row(s) not present in auth.users — skipping the FK. Inspect: SELECT id, name, owner_id FROM public.restaurants WHERE owner_id IS NOT NULL AND owner_id NOT IN (SELECT id FROM auth.users); Then either repoint them (UPDATE public.restaurants SET owner_id = <a real auth user id> WHERE id = ...) or clear them (SET owner_id = NULL). Re-run this file afterwards to add the constraint.',
      v_orphans;
    RETURN;
  END IF;

  ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_owner_id_fkey;
  ALTER TABLE public.restaurants
    ADD CONSTRAINT restaurants_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END
$owner_fk$;

-- categories
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_restaurant_id_fkey;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- products
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_restaurant_id_fkey;
ALTER TABLE public.products
  ADD CONSTRAINT products_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
ALTER TABLE public.products
  ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

-- restaurant_tables
ALTER TABLE public.restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_restaurant_id_fkey;
ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_restaurant_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- orders.table_id is RESTRICT, not CASCADE: deleting a table from the editor
-- must not silently delete that table's order history (audit DB-16 — this was
-- an open product decision). Order history is the owner's revenue record, so a
-- delete that would destroy it now fails loudly instead, and PUT /api/menu
-- surfaces the DB error rather than reporting a reconciliated success.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_table_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_table_id_fkey
  FOREIGN KEY (table_id) REFERENCES public.restaurant_tables(id) ON DELETE RESTRICT;

-- order_items. `product_id` survives product deletion: historical tickets must
-- keep their snapshot lines when a product leaves the menu (SET NULL).
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- workers
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_restaurant_id_fkey;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- worker_invites
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_restaurant_id_fkey;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- worker_invites.used_by -> workers(id), SET NULL: revoking a worker must not
-- delete the invite audit row.
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_used_by_fkey;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES public.workers(id) ON DELETE SET NULL;

-- orders.accepted_by -> workers(id), SET NULL, declared after workers exists.
-- This FK must NOT point at auth.users (workers are not auth users) and must
-- not cascade: deleting a worker used to break order history.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_accepted_by_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_accepted_by_fkey
  FOREIGN KEY (accepted_by) REFERENCES public.workers(id) ON DELETE SET NULL;


-- ============================================================================
-- 3. UNIQUENESS (required by `.single()` / `.maybeSingle()` consumers)
-- ============================================================================

-- Guest menu resolution: .eq("slug", slug).single()
-- (src/app/menu/[slug]/[token]/page.tsx:20-26). A duplicate makes the menu 404
-- permanently. The app maps 23505 to SLUG_TAKEN (src/app/api/menu/route.ts:208).
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_slug_key;
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_slug_key UNIQUE (slug);

-- QR token resolution: maybeSingle() (src/app/api/orders/route.ts:228-233).
ALTER TABLE public.restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_restaurant_id_qr_token_key;
ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_restaurant_id_qr_token_key UNIQUE (restaurant_id, qr_token);

-- Table-number resolution: single() (src/app/api/orders/route.ts:234-240).
ALTER TABLE public.restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_restaurant_id_table_number_key;
ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_restaurant_id_table_number_key UNIQUE (restaurant_id, table_number);

-- Invite redemption: .eq("invite_token", token).maybeSingle()
-- (src/app/api/auth/worker/accept/route.ts:57-61).
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_invite_token_key;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_invite_token_key UNIQUE (invite_token);

-- Worker session lookup: .eq("session_token", token).maybeSingle()
-- (src/lib/worker-auth.ts:65-71). A duplicated bearer token logs out both
-- workers. Declared here (not as a column-UNIQUE like 1002:149) so it survives
-- re-runs and pre-existing columns.
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_session_token_key;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_session_token_key UNIQUE (session_token);

-- Backstop for daily ticket numbers. order_day is a real column set by the
-- trigger in section 5: an index expression on (created_at AT TIME ZONE ...)
-- is not IMMUTABLE and is rejected with 42P17.
CREATE UNIQUE INDEX IF NOT EXISTS orders_daily_number_unique
  ON public.orders (restaurant_id, order_day, daily_order_number);

-- Idempotency for duplicate clicks/retries: one order per client_ref per
-- restaurant (recovery branch at src/app/api/orders/route.ts:368-405).
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_ref_unique
  ON public.orders (restaurant_id, client_ref)
  WHERE client_ref IS NOT NULL;


-- ============================================================================
-- 4. CHECK CONSTRAINTS
-- ============================================================================
-- Names are the ones 1002_production_readiness.sql drops/re-adds, so a re-run
-- of 1002 replaces rather than duplicates these.

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_price_check CHECK (price >= 0);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_total_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_check CHECK (total >= 0);

-- The PATCH route states this invariant in its own comment and never writes
-- 'paid' (src/app/api/orders/[id]/route.ts:84-85).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'accepted'));

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 1 AND quantity <= 500);

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_role_check CHECK (role IN ('Cashier', 'Manager', 'cashier', 'manager'));

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_role_check;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_role_check CHECK (role IN ('Cashier', 'Manager', 'cashier', 'manager'));


-- ============================================================================
-- 5. DB OBJECTS THE APP CALLS BY NAME
-- ============================================================================
-- Bodies copied verbatim from 1002_production_readiness.sql (lines 34-44,
-- 63-75, 194-203) — they are correct as written; only their location moved.

-- Atomic daily ticket numbers. One INSERT ... ON CONFLICT ... RETURNING (an
-- implicit row lock) so concurrent orders cannot collide; starts at 1001.
-- Called as .rpc("sufra_next_order_number", { p_restaurant })
-- (src/app/api/orders/route.ts:103).
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

-- Keeps orders.order_day in sync with the UTC day of created_at. It is the
-- only trigger allowed on public.orders (the unique backstop in section 3 and
-- the LIKE 'sufra_orders_set_day' assertion in the audit depend on it).
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

-- RLS helper used by the owner policies in 1002 (1002:228,241,248,261,270).
-- Requires Supabase Auth's auth.uid() (vanilla Postgres: substitute your own
-- current-user function on the line marked below).
CREATE OR REPLACE FUNCTION public.sufra_is_owner(p_restaurant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE id = p_restaurant AND owner_id = auth.uid()   -- auth.uid(): Supabase Auth
  );
$$;

GRANT EXECUTE ON FUNCTION public.sufra_is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sufra_is_owner(uuid) TO service_role;


-- ============================================================================
-- 6. MENU IMAGE STORAGE (Supabase Storage)
-- ============================================================================
-- Persistent menu images live in the `menu-images` bucket as files; the DB
-- stores only their public URLs (src/app/api/upload/route.ts:8,91-102).
-- Limits mirror the upload route's own guard: 5 MB and JPEG/PNG/WebP only
-- (UPLOAD_MAX_BYTES and ALLOWED_MIME, src/app/api/upload/route.ts:9-15).
-- ON CONFLICT DO UPDATE (rather than 1002's DO NOTHING) so re-running also
-- backfills the limits onto a bucket the route self-healed via createBucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  5242880,                                          -- 5 MB, matches UPLOAD_MAX_BYTES
  ARRAY['image/jpeg', 'image/png', 'image/webp']    -- matches ALLOWED_MIME
)
ON CONFLICT (id) DO UPDATE
  SET "public"           = EXCLUDED."public",
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for the guest menu. (Writes stay service-role only.)
DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
CREATE POLICY "menu_images_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'menu-images');


-- ============================================================================
-- 7. PRIVILEGES — REQUIRED, and easy to miss
-- ============================================================================
-- The app runs ENTIRELY on the service role: every API route reads and writes
-- these tables through `supabaseAdmin` (src/lib/supabase-admin.ts) and there is
-- no anon client. Creating a table does NOT grant access to it — the creator
-- owns it and that is all — so without the GRANTs below the role the app
-- actually uses is denied on every table.
--
-- This was found by running the app against a real local Supabase stack: the
-- tables came out with only REFERENCES/TRIGGER/TRUNCATE for `service_role`, and
-- every query failed with
--   42501 permission denied for table restaurants
-- which the signup route swallowed into a generic 500. A rehearsal against
-- plain Postgres does NOT catch this, because it connects as the superuser,
-- which bypasses privilege checks entirely.
--
-- `anon` and `authenticated` are deliberately NOT granted here. This product
-- has no anon or user-JWT database path, so leaving them unauthorised is
-- strictly safer than granting access that RLS would then have to contain. If
-- an anon or user-scoped client is ever added, grant it explicitly here AND
-- give it a policy in 1002 — do not grant it "just in case".

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future objects created by this migration's role inherit the same access, so
-- a later migration that adds a table does not silently reintroduce the 42501.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO service_role;
