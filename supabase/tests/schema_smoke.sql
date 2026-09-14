-- ============================================================================
-- Schema smoke test — proves the migrated database supports what the app does.
-- ----------------------------------------------------------------------------
-- Run AFTER the migration chain:
--   _shim_storage.sql, 0001_init_schema.sql, 1002_production_readiness.sql,
--   1003_live_db_repair.sql, 1004_session_hardening.sql
--
-- Each check asserts a contract that a CODE path depends on, so a failure here
-- is a real app-breaking defect, not a style nit. The `check(...)` helper
-- raises on the first failure, so run with `psql -v ON_ERROR_STOP=1`.
--
-- The whole file runs inside ONE transaction that is ROLLED BACK at the end, so
-- it leaves NO residue behind: it inserts disposable rows (a `cafe-smoke`
-- restaurant, its products, tables, orders, workers) and exercises
-- `sufra_next_order_number`, all of which are undone. This matters — a leftover
-- restaurant row would be auto-claimed by the next signup and must never reach a
-- real database. Safe to run against a live project; still RUN IT ON A SCRATCH
-- DATABASE first, because a FAILURE aborts with the transaction left open.
--
-- Assertions are derived from the column/constraint/uniqueness inventory in
-- docs/audit/01-database.md and the call sites it cites.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;


-- Helper: assert a boolean, and report the running total at the end.
CREATE TEMP TABLE IF NOT EXISTS smoke_results (name text, passed boolean);
TRUNCATE smoke_results;

CREATE OR REPLACE FUNCTION pg_temp.check(p_name text, p_ok boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO smoke_results (name, passed) VALUES (p_name, p_ok);
  IF NOT p_ok THEN
    RAISE EXCEPTION 'SMOKE FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'ok — %', p_name;
END $$;

DO $$
DECLARE
  v_restaurant  uuid;
  v_category    uuid;
  v_product     uuid;
  v_table       uuid;
  v_order       uuid;
  v_worker      uuid;
  v_n1          integer;
  v_n2          integer;
  v_cnt         integer;
  v_val         numeric;
  v_day         date;
  v_token       text;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. The app inserts a restaurant WITHOUT an id and WITHOUT created_at.
  --    restaurants.id must therefore have a DEFAULT (audit DB-13).
  -- -------------------------------------------------------------------------
  INSERT INTO public.restaurants (name, slug, tagline, business_type, currency,
                                  primary_color, menu_layout_theme, is_published,
                                  updated_at)
  VALUES ('Café Smoke', 'cafe-smoke', 'test', 'cafe', 'TND',
          '#D97706', 'classic', false, now())
  RETURNING id INTO v_restaurant;
  PERFORM pg_temp.check('restaurants.id defaults on insert (DB-13)', v_restaurant IS NOT NULL);

  -- -------------------------------------------------------------------------
  -- 2. restaurants.created_at must also default — src/app/api/menu/route.ts
  --    orders by it and never supplies it.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_cnt FROM public.restaurants
   WHERE id = v_restaurant AND created_at IS NOT NULL;
  PERFORM pg_temp.check('restaurants.created_at defaults (menu/route.ts:58)', v_cnt = 1);

  -- -------------------------------------------------------------------------
  -- 3. UNIQUE(restaurants.slug) — the guest page resolves by slug with
  --    .single(); a duplicate makes BOTH menus 404 (audit DB-04).
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.restaurants (name, slug) VALUES ('Dupe', 'cafe-smoke');
    PERFORM pg_temp.check('restaurants.slug is UNIQUE (DB-04)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('restaurants.slug is UNIQUE (DB-04)', true);
  END;

  -- -------------------------------------------------------------------------
  -- 4. categories + products round trip, incl. sort_order (audit LIB-12).
  -- -------------------------------------------------------------------------
  INSERT INTO public.categories (restaurant_id, name, sort_order)
  VALUES (v_restaurant, 'Coffee', 0) RETURNING id INTO v_category;

  INSERT INTO public.products (restaurant_id, category_id, name, description,
                               price, is_available, sort_order)
  VALUES (v_restaurant, v_category, 'Espresso', '', 4.500, true, 0)
  RETURNING id INTO v_product;
  PERFORM pg_temp.check('products insert with sort_order (LIB-12)', v_product IS NOT NULL);

  -- Money must keep millime precision — order-utils rounds to 3 decimals
  -- (audit LIB-04) and the OCR import writes 3-decimal prices.
  SELECT price INTO v_val FROM public.products WHERE id = v_product;
  PERFORM pg_temp.check('products.price is numeric(10,2) >= 2dp (DB-14)', v_val = 4.500);

  -- -------------------------------------------------------------------------
  -- 5. products.price CHECK rejects a negative (migration 6).
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.products (restaurant_id, category_id, name, price)
    VALUES (v_restaurant, v_category, 'Bad', -1);
    PERFORM pg_temp.check('products.price >= 0 enforced', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.check('products.price >= 0 enforced', true);
  END;

  -- -------------------------------------------------------------------------
  -- 6. restaurant_tables uniqueness — both consumers use .single()/.maybeSingle()
  --    so a duplicate token makes EVERY order from those tables 404 (LIB-10).
  -- -------------------------------------------------------------------------
  INSERT INTO public.restaurant_tables (restaurant_id, table_number, qr_token)
  VALUES (v_restaurant, 1, 'tok-alpha') RETURNING id INTO v_table;

  BEGIN
    INSERT INTO public.restaurant_tables (restaurant_id, table_number, qr_token)
    VALUES (v_restaurant, 1, 'tok-beta');
    PERFORM pg_temp.check('(restaurant_id, table_number) UNIQUE (DB-11)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('(restaurant_id, table_number) UNIQUE (DB-11)', true);
  END;

  BEGIN
    INSERT INTO public.restaurant_tables (restaurant_id, table_number, qr_token)
    VALUES (v_restaurant, 2, 'tok-alpha');
    PERFORM pg_temp.check('(restaurant_id, qr_token) UNIQUE (DB-11)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('(restaurant_id, qr_token) UNIQUE (DB-11)', true);
  END;

  -- -------------------------------------------------------------------------
  -- 7. Atomic ticket allocation: first number of the day is 1001 and the
  --    counter advances contiguously (the designed contract).
  -- -------------------------------------------------------------------------
  SELECT public.sufra_next_order_number(v_restaurant) INTO v_n1;
  SELECT public.sufra_next_order_number(v_restaurant) INTO v_n2;
  PERFORM pg_temp.check('sufra_next_order_number starts at 1001', v_n1 = 1001);
  PERFORM pg_temp.check('sufra_next_order_number increments by 1', v_n2 = 1002);

  -- -------------------------------------------------------------------------
  -- 8. Order insert: the app omits id, relies on order_day being auto-set by
  --    the trigger, and relies on the transaction keeping the RPC number.
  --    There must be NO trigger overriding daily_order_number (prior C3).
  -- -------------------------------------------------------------------------
  INSERT INTO public.orders (restaurant_id, table_id, status, total,
                             daily_order_number, is_paid, client_ref)
  VALUES (v_restaurant, v_table, 'pending', 9.000, v_n2, false,
          '11111111-1111-4111-8111-111111111111')
  RETURNING id, order_day INTO v_order, v_day;

  PERFORM pg_temp.check('orders.id defaults on insert (DB-13)', v_order IS NOT NULL);
  PERFORM pg_temp.check('orders.order_day auto-populated by trigger (1002 §2)',
                        v_day = (now() AT TIME ZONE 'UTC')::date);
  SELECT daily_order_number INTO v_val FROM public.orders WHERE id = v_order;
  PERFORM pg_temp.check('no trigger stomps daily_order_number (prior C3)', v_val = v_n2);

  -- -------------------------------------------------------------------------
  -- 9. order_items: a CATALOG line and a WORKER MANUAL line (product_id NULL).
  --    The manual line is the one a rogue trigger used to NULL out (prior C2).
  -- -------------------------------------------------------------------------
  INSERT INTO public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, price_snapshot)
  VALUES (v_order, v_product, 'Espresso', 2, 4.500);

  INSERT INTO public.order_items (order_id, product_id, product_name_snapshot,
                                  quantity, price_snapshot)
  VALUES (v_order, NULL, 'Off-menu pastry', 1, 0.010);

  -- The price the API wrote must survive verbatim: the trigger used to rewrite
  -- 0.01 to the product price, which is what broke all manual orders.
  SELECT price_snapshot INTO v_val FROM public.order_items
   WHERE order_id = v_order AND product_id IS NULL;
  PERFORM pg_temp.check('custom-line price_snapshot preserved (prior C2)', v_val = 0.010);

  -- -------------------------------------------------------------------------
  -- 10. order_items.quantity CHECK 1..500.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, product_name_snapshot,
                                    quantity, price_snapshot)
    VALUES (v_order, NULL, 'Too many', 501, 1.000);
    PERFORM pg_temp.check('order_items.quantity <= 500 enforced', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.check('order_items.quantity <= 500 enforced', true);
  END;

  -- -------------------------------------------------------------------------
  -- 11. client_ref idempotency: the partial unique index must reject a repeat
  --     for the same restaurant so the API's 23505 -> fetch-existing path works.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.orders (restaurant_id, table_id, status, total,
                               daily_order_number, client_ref)
    VALUES (v_restaurant, v_table, 'pending', 1.000, v_n1,
            '11111111-1111-4111-8111-111111111111');
    PERFORM pg_temp.check('client_ref idempotency index (1002 §3)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('client_ref idempotency index (1002 §3)', true);
  END;

  -- A NULL client_ref must NOT collide (the index is partial) — guest orders
  -- sent without the field still work.
  INSERT INTO public.orders (restaurant_id, table_id, status, total, daily_order_number)
  VALUES (v_restaurant, v_table, 'pending', 2.000, v_n1) RETURNING id INTO v_order;
  PERFORM pg_temp.check('client_ref index is PARTIAL (NULL allowed)', v_order IS NOT NULL);

  -- -------------------------------------------------------------------------
  -- 12. Daily-number uniqueness backstop on (restaurant_id, order_day, number).
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.orders (restaurant_id, table_id, status, total, daily_order_number)
    VALUES (v_restaurant, v_table, 'pending', 3.000, v_n2);
    PERFORM pg_temp.check('(restaurant_id, order_day, daily_order_number) UNIQUE', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('(restaurant_id, order_day, daily_order_number) UNIQUE', true);
  END;

  -- -------------------------------------------------------------------------
  -- 13. orders.status CHECK — the PATCH route states this invariant inline.
  -- -------------------------------------------------------------------------
  BEGIN
    UPDATE public.orders SET status = 'paid' WHERE id = v_order;
    PERFORM pg_temp.check('orders.status IN (pending, accepted) enforced', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.check('orders.status IN (pending, accepted) enforced', true);
  END;

  -- -------------------------------------------------------------------------
  -- 14. WORKER CREATION — the single biggest live blocker (prior C1). The
  --     legacy DB required workers.id to be a Supabase auth user and rejected
  --     the role 'Cashier'. Both must now be gone.
  -- -------------------------------------------------------------------------
  INSERT INTO public.workers (restaurant_id, full_name, role, session_token,
                              session_expires_at)
  VALUES (v_restaurant, 'Smoke Cashier', 'Cashier', 'sess-token-alpha',
          now() + interval '7 days')
  RETURNING id INTO v_worker;
  PERFORM pg_temp.check('workers insert with role=Cashier, no auth FK (prior C1)',
                        v_worker IS NOT NULL);

  BEGIN
    INSERT INTO public.workers (restaurant_id, full_name, role)
    VALUES (v_restaurant, 'Bad Role', 'Owner');
    PERFORM pg_temp.check('workers.role CHECK rejects unknown roles', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.check('workers.role CHECK rejects unknown roles', true);
  END;

  -- worker session_token must be UNIQUE and session_expires_at must exist for
  -- the server-side expiry check (audit LIB-02 / migration 1004 §1).
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workers'
     AND column_name = 'session_expires_at';
  PERFORM pg_temp.check('workers.session_expires_at exists (LIB-02)', v_cnt = 1);

  BEGIN
    INSERT INTO public.workers (restaurant_id, full_name, role, session_token)
    VALUES (v_restaurant, 'Dupe Session', 'Manager', 'sess-token-alpha');
    PERFORM pg_temp.check('workers.session_token UNIQUE (1002 §5)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('workers.session_token UNIQUE (1002 §5)', true);
  END;

  -- -------------------------------------------------------------------------
  -- 15. WORKER INVITE — must be mintable, its token unique, and expires_at
  --     must be NOT NULL so it cannot become a credential with no lifetime
  --     (audit LIB-25 / migration 1004 §2).
  -- -------------------------------------------------------------------------
  INSERT INTO public.worker_invites (restaurant_id, invite_token, role, is_used)
  VALUES (v_restaurant, 'invite-token-alpha', 'Cashier', false);
  PERFORM pg_temp.check('worker_invites insert with role=Cashier (prior C1)', true);

  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'worker_invites'
     AND column_name = 'expires_at' AND is_nullable = 'NO';
  PERFORM pg_temp.check('worker_invites.expires_at is NOT NULL (LIB-25)', v_cnt = 1);

  BEGIN
    INSERT INTO public.worker_invites (restaurant_id, invite_token, role)
    VALUES (v_restaurant, 'invite-token-alpha', 'Manager');
    PERFORM pg_temp.check('worker_invites.invite_token UNIQUE (DB-11)', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.check('worker_invites.invite_token UNIQUE (DB-11)', true);
  END;

  -- The accept route writes the claiming worker's id into used_by; that column
  -- must accept a workers.id (NOT an auth.users id) — prior C1's other half.
  UPDATE public.worker_invites SET is_used = true, used_by = v_worker
   WHERE invite_token = 'invite-token-alpha';
  PERFORM pg_temp.check('worker_invites.used_by accepts a workers.id (prior C1)', true);

  -- -------------------------------------------------------------------------
  -- 16. orders.accepted_by accepts a workers.id — worker attribution.
  -- -------------------------------------------------------------------------
  UPDATE public.orders SET accepted_by = v_worker, accepted_by_name = 'Smoke Cashier'
   WHERE id = v_order;
  PERFORM pg_temp.check('orders.accepted_by accepts a workers.id', true);

  -- -------------------------------------------------------------------------
  -- 17. FK-backed PostgREST embeds. The dashboard selects orders with their
  --     order_items and their table, and the invite lookup embeds the
  --     restaurant; a missing FK makes PostgREST return ZERO rows (audit
  --     DB-05), so prove the joins resolve.
  -- -------------------------------------------------------------------------
  -- Two orders exist at this point; only the first has line items, so the join
  -- yields exactly its 2 lines.
  SELECT count(*) INTO v_cnt
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.restaurant_tables t ON t.id = o.table_id
   WHERE o.restaurant_id = v_restaurant;
  PERFORM pg_temp.check('orders -> order_items + tables embed returns rows (DB-05)',
                        v_cnt = 2);

  SELECT count(*) INTO v_cnt
    FROM public.worker_invites wi
    JOIN public.restaurants r ON r.id = wi.restaurant_id
   WHERE wi.invite_token = 'invite-token-alpha';
  PERFORM pg_temp.check('worker_invites -> restaurants embed returns rows (DB-05)',
                        v_cnt = 1);

  -- -------------------------------------------------------------------------
  -- 18. The guest menu read path: slug + qr_token must resolve exactly one row
  --     each (the page uses .single() and 404s on anything else).
  -- -------------------------------------------------------------------------
  SELECT r.id, t.id INTO v_restaurant, v_table
    FROM public.restaurants r
    JOIN public.restaurant_tables t ON t.restaurant_id = r.id
   WHERE r.slug = 'cafe-smoke' AND t.qr_token = 'tok-alpha';
  PERFORM pg_temp.check('guest slug + qr_token resolves one table', v_table IS NOT NULL);

  SELECT count(*) INTO v_cnt
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id
   WHERE p.restaurant_id = v_restaurant AND p.is_available = true;
  PERFORM pg_temp.check('guest menu product query returns the available product', v_cnt = 1);

  -- -------------------------------------------------------------------------
  -- 19. products.sort_order must be present and populated (migration 1004 §3).
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products'
     AND column_name = 'sort_order' AND is_nullable = 'NO';
  PERFORM pg_temp.check('products.sort_order NOT NULL (LIB-12)', v_cnt = 1);

  -- -------------------------------------------------------------------------
  -- 20. The menu-images storage bucket must exist and be publicly readable,
  --     with the size/MIME limits matching the upload route's own caps.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_cnt FROM information_schema.tables
   WHERE table_schema = 'storage' AND table_name = 'buckets';
  IF v_cnt = 1 THEN
    SELECT count(*) INTO v_cnt FROM storage.buckets WHERE id = 'menu-images' AND public;
    PERFORM pg_temp.check('menu-images bucket exists and is public (1002 §8)', v_cnt = 1);
  ELSE
    RAISE NOTICE 'skip — storage schema not present on this server';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ALL SCHEMA SMOKE CHECKS PASSED';
  RAISE NOTICE '========================================';
END $$;

-- Undo every fixture this file created. The assertions above have already been
-- reported; this leaves the database exactly as it was found.
ROLLBACK;
