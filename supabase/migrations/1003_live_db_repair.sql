-- ============================================================================
-- 1003_live_db_repair.sql — repair migration for the ORIGINAL DEVELOPER'S
--         EXISTING (live) Supabase database
-- ============================================================================
-- Purpose
-- -------
-- The original developer's live Cloud project (probed live on 2026-09-13; see
-- SECURITY-REPORT-ROUND-2.md) carries hand-made objects that the
-- app was never written against and that break the product in three places.
-- 0001_init_schema.sql describes a FRESH project; 1002_production_readiness.sql
-- is the incremental patch for it. Neither removes what is already there.
-- This file runs against the existing database, after 0001/1002 (or instead of
-- them where the schema already exists), and is the ONLY file that touches the
-- legacy objects listed below.
--
-- SCOPE (audit DB-17, DB-04, DB-11, DB-05)
--   1. Drop the rogue application triggers on public.orders / public.order_items.
--   2. Add the four unique constraints the app's .single()/.maybeSingle()
--      consumers require, guarded against pre-existing duplicates.
--   3. Add the four missing PK defaults (gen_random_uuid()).
--   4. Verify/repair the five foreign keys the PostgREST embeds need.
--   5. Verify the post-conditions.
--
-- WHY THE ROGUE TRIGGERS MUST GO (live proof, not inference)
-- --------------------------------------------------------
-- SECURITY-REPORT-ROUND-2.md C2/C3 recorded direct probes against the live DB:
--   * orders   — an app trigger rewrote `daily_order_number` with a racy
--                (max+1, 1-based) value. Insert with daily_order_number = 9999
--                was stored as 3. Every call to the atomic
--                public.sufra_next_order_number() RPC (this repo's allocator)
--                was therefore stomped, and the max+1 read races: under
--                concurrency two inserts can pick the same value and burn a
--                23505 retry (100-way concurrency held only by luck).
--                This trigger also defeated the "atomic daily order numbers"
--                contract the whole ticket flow is built on.
--   * order_items — an app trigger rewrote `price_snapshot` from
--                public.products and NULLed custom lines. A line inserted with
--                price_snapshot = 0.01 was stored as 5.50 (the current product
--                price); a custom line with product_id IS NULL aborted with
--                23502 NOT NULL on price_snapshot. Net effect: 100% of
--                worker-created manual/custom orders returned 500
--                CREATE_ITEMS (src/app/api/orders/route.ts:289-296).
-- The trigger DEFINITIONS were never obtained (the live console was not
-- reachable to the auditors), so the names cannot be hard-coded. Section 1
-- therefore discovers and drops them procedurally.
--
-- DELIBERATELY NOT DONE HERE
--   * No RLS policies: the app runs on the service role, which bypasses RLS.
--   * No triggers created: public.sufra_orders_set_day (on orders) is this
--     repo's own trigger and is preserved; public.order_items legitimately has
--     NO trigger in this repo.
--   * No tables/columns dropped.
--   * public.sufra_next_order_number, public.sufra_set_order_day and
--     public.sufra_is_owner are this repo's own objects and are not touched.
--   * The workers.id FK / role-check repairs (C1) belong to 1002 §9.
--
-- RE-RUN SAFETY
--   Every statement below is guarded and idempotent: the migration is meant to
--   be pasted into the Supabase SQL editor, where an earlier failure can leave
--   partial state behind. Running it twice changes nothing the second time.
-- ============================================================================


-- ============================================================================
-- 1. ROGUE TRIGGERS ON orders / order_items  (audit DB-17; evidence C2, C3)
-- ============================================================================
-- Iterate pg_trigger over the two relations, skip internal (FK-constraint)
-- triggers, and DROP every application trigger EXCEPT this repo's own
-- sufra_orders_set_day on public.orders. This repo defines NO trigger on
-- order_items at all, so every non-internal trigger there is rogue.
DO $$
DECLARE
  trg    record;
  v_dropped integer := 0;
BEGIN
  FOR trg IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           t.tgname  AS trigger_name
    FROM pg_trigger t
    JOIN pg_class     c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('orders', 'order_items')
      AND NOT t.tgisinternal
      AND NOT (c.relname = 'orders' AND t.tgname = 'sufra_orders_set_day')
    ORDER BY c.relname, t.tgname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                   trg.trigger_name, trg.schema_name, trg.table_name);
    RAISE NOTICE 'DB-17: dropped rogue trigger "%" on %.%',
                 trg.trigger_name, trg.schema_name, trg.table_name;
    v_dropped := v_dropped + 1;
  END LOOP;

  IF v_dropped = 0 THEN
    RAISE NOTICE 'DB-17: no rogue triggers found on public.orders / public.order_items (already clean)';
  ELSE
    RAISE NOTICE 'DB-17: dropped % rogue trigger(s); numbering now belongs to sufra_next_order_number + sufra_orders_set_day only',
                 v_dropped;
  END IF;
END $$;


-- ============================================================================
-- 2. UNIQUENESS required by .single() / .maybeSingle() consumers
--    (audit DB-04, DB-11)
-- ============================================================================
-- Each rule is LOAD-BEARING. Without it a duplicate row makes the PostgREST
-- lookup return PGRST116 (or >1 row), the caller destructures `data` only, and
-- the feature silently degrades to a 404 / permanently empty view:
--
--   restaurants.slug UNIQUE                      (DB-04, DB-11)
--     Guest menu: .eq("slug", slug).single()
--     (src/app/menu/[slug]/[token]/page.tsx:20-26). Two owners may persist the
--     same slug (the in-app pre-check at src/app/api/menu/route.ts:221-232 is
--     racy); from then on EVERY scan of that slug 404s forever. The app maps
--     23505 to SLUG_TAKEN (menu/route.ts:208-210).
--
--   restaurant_tables (restaurant_id, qr_token) UNIQUE   (DB-11)
--     Stand resolution: .eq("qr_token", ...).maybeSingle()
--     (src/app/api/orders/route.ts:228-233).
--
--   restaurant_tables (restaurant_id, table_number) UNIQUE  (DB-11)
--     Table-number resolution: .eq("table_number", ...).single()
--     (src/app/api/orders/route.ts:234-240).
--
--   worker_invites.invite_token UNIQUE                   (DB-11)
--     Invite redemption: .eq("invite_token", token).maybeSingle()
--     (src/app/api/auth/worker/accept/route.ts:57-61). A duplicate makes every
--     valid invite link 404.
--
-- The existing database may ALREADY contain the duplicates that produced the
-- live failures, so each add is guarded: duplicates are counted first and, if
-- any exist, the migration aborts with the table, the count and a suggested
-- cleanup query instead of a bare 23505 from ADD CONSTRAINT.
DO $$
DECLARE
  spec      record;
  v_covered boolean;
  v_dups    bigint;
  v_notnull text;
  v_cols    text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('restaurants', ARRAY['slug']::text[], 'restaurants_slug_key',
       'Inspect: SELECT slug, count(*) FROM public.restaurants GROUP BY slug HAVING count(*) > 1;  Then keep the oldest and re-slug the rest: UPDATE public.restaurants SET slug = slug || ''-'' || left(id::text, 8) WHERE id NOT IN (SELECT DISTINCT ON (slug) id FROM public.restaurants ORDER BY slug, created_at, id);'),
      ('restaurant_tables', ARRAY['restaurant_id','qr_token']::text[], 'restaurant_tables_restaurant_id_qr_token_key',
       'Inspect: SELECT restaurant_id, qr_token, count(*) FROM public.restaurant_tables GROUP BY 1,2 HAVING count(*) > 1;  Then mint a fresh 32-hex token for all but one: UPDATE public.restaurant_tables SET qr_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY restaurant_id, qr_token ORDER BY id) rn FROM public.restaurant_tables) d WHERE rn > 1);'),
      ('restaurant_tables', ARRAY['restaurant_id','table_number']::text[], 'restaurant_tables_restaurant_id_table_number_key',
       'Inspect: SELECT restaurant_id, table_number, count(*) FROM public.restaurant_tables GROUP BY 1,2 HAVING count(*) > 1;  Then delete the extra stand (destructive: its orders cascade) or renumber it with UPDATE public.restaurant_tables SET table_number = table_number + 1000 WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY restaurant_id, table_number ORDER BY id) rn FROM public.restaurant_tables) d WHERE rn > 1);'),
      ('worker_invites', ARRAY['invite_token']::text[], 'worker_invites_invite_token_key',
       'Inspect: SELECT invite_token, count(*) FROM public.worker_invites GROUP BY invite_token HAVING count(*) > 1;  Then mint a fresh 32-hex token for all but the newest: UPDATE public.worker_invites SET invite_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY invite_token ORDER BY created_at DESC, id) rn FROM public.worker_invites) d WHERE rn > 1);')
    ) AS v(tbl, cols, cname, cleanup)
  LOOP
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL THEN
      RAISE WARNING 'DB-11: table public.% does not exist; skipping UNIQUE (%). Run 0001_init_schema.sql first.',
                    spec.tbl, array_to_string(spec.cols, ', ');
      CONTINUE;
    END IF;

    -- Already enforced? Accept any valid, non-partial unique index that covers
    -- exactly these columns (a legacy constraint/index under another name is
    -- just as good — re-adding would only duplicate storage).
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class     c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = spec.tbl
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND (
          SELECT array_agg(a.attname::text ORDER BY a.attname)
          FROM pg_attribute a
          WHERE a.attrelid = i.indrelid
            AND a.attnum = ANY (i.indkey::int2[])
        ) = (SELECT array_agg(x ORDER BY x) FROM unnest(spec.cols) AS x)
    ) INTO v_covered;

    IF v_covered THEN
      RAISE NOTICE 'DB-11: UNIQUE (%) on public.% already enforced; skipping',
                   array_to_string(spec.cols, ', '), spec.tbl;
      CONTINUE;
    END IF;

    -- Duplicate guard. NULLs are distinct in a unique index, so rows whose
    -- constrained columns contain NULL are excluded from the count.
    SELECT string_agg(format('%I IS NOT NULL', col), ' AND '),
           string_agg(format('%I', col), ', ')
    INTO v_notnull, v_cols
    FROM unnest(spec.cols) AS col;

    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE %s GROUP BY %s HAVING count(*) > 1) AS d',
      spec.tbl, v_notnull, v_cols
    ) INTO v_dups;

    IF v_dups > 0 THEN
      RAISE EXCEPTION
        'DB-11: refused to add UNIQUE (%) on public.% — % duplicate value group(s) already exist. The app lookup would keep returning an error until they are resolved (see HINT), then re-run 1003.',
        array_to_string(spec.cols, ', '), spec.tbl, v_dups
        USING HINT = spec.cleanup;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)',
                   spec.tbl, spec.cname, v_cols);
    RAISE NOTICE 'DB-11: added UNIQUE (%) on public.% as constraint %',
                 array_to_string(spec.cols, ', '), spec.tbl, spec.cname;
  END LOOP;
END $$;


-- ============================================================================
-- 3. MISSING PRIMARY-KEY DEFAULTS  (audit DB-13; evidence SECURITY-REPORT C1)
-- ============================================================================
-- The live schema has uuid PKs with NO default. Every insert that omits `id`
-- fails 23502 — live proof: POST /api/auth/worker/invite returned
-- 500 CREATE_INVITE for that reason, and the accept route inserts ids
-- explicitly only because of it. This repo's REST paths omit `id` on
-- restaurants / orders / order_items / worker_invites, so each needs
-- DEFAULT gen_random_uuid(). Guarded via information_schema: a re-run is a
-- no-op, and a column that already has any default is left alone.
DO $$
DECLARE
  spec record;
  v_type text;
  v_default text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('restaurants',    'id'),
      ('orders',         'id'),
      ('order_items',    'id'),
      ('worker_invites', 'id')
    ) AS v(tbl, col)
  LOOP
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL THEN
      RAISE WARNING 'DB-13: table public.% does not exist; skipping DEFAULT on %.%',
                    spec.tbl, spec.tbl, spec.col;
      CONTINUE;
    END IF;

    SELECT c.data_type, c.column_default
    INTO v_type, v_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name  = spec.tbl
      AND c.column_name = spec.col;

    IF v_type IS NULL THEN
      RAISE WARNING 'DB-13: public.%.% not found; skipping', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    IF v_default IS NOT NULL THEN
      RAISE NOTICE 'DB-13: public.%.% already has DEFAULT %; skipping',
                   spec.tbl, spec.col, v_default;
      CONTINUE;
    END IF;

    IF v_type <> 'uuid' THEN
      RAISE WARNING 'DB-13: public.%.% is % (not uuid); gen_random_uuid() would not apply — fix the column type manually',
                    spec.tbl, spec.col, v_type;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
                   spec.tbl, spec.col);
    RAISE NOTICE 'DB-13: set DEFAULT gen_random_uuid() on public.%.%', spec.tbl, spec.col;
  END LOOP;
END $$;


-- ============================================================================
-- 3b. MONEY PRECISION — millimes, not centimes  (found by LIVE testing)
-- ============================================================================
-- The currency is the Tunisian dinar, which is MILLIME-based: 1 DT = 1000
-- millimes. Every layer except the column already works at 3 decimals:
--   * src/lib/format.ts        renders 3 decimals ("4.755 DT")
--   * src/lib/menu-import.ts   rounds OCR prices to 3
--   * src/lib/menu-scan.ts     the scan parser rounds to 3
--   * src/lib/order-utils.ts   lineTotal/computeOrderTotal round at 3
-- but the live columns are numeric(x,2), so Postgres ROUNDS ON INSERT.
--
-- Verified live against this project: a product written at 4.755 DT read back
-- as 4.76, so the stored price no longer matched the price the guest was
-- charged, and an OCR-imported 3-decimal price is silently altered.
--
-- Widening scale is non-destructive (no value can be lost going 2 -> 3) and
-- guarded on the current scale, so a re-run is a no-op. This only ever widens:
-- a column that is already scale >= 3 is left exactly as it is.
DO $$
DECLARE
  spec   record;
  v_scale integer;
  v_prec  integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('products',    'price',          'numeric(10,3)'),
      ('orders',      'total',          'numeric(12,3)'),
      ('order_items', 'price_snapshot', 'numeric(10,3)')
    ) AS v(tbl, col, want_type)
  LOOP
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL THEN
      RAISE WARNING 'money: table public.% does not exist; skipping %.%',
                    spec.tbl, spec.tbl, spec.col;
      CONTINUE;
    END IF;

    SELECT c.numeric_precision, c.numeric_scale
    INTO v_prec, v_scale
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name  = spec.tbl
      AND c.column_name = spec.col;

    IF v_scale IS NULL THEN
      -- Not a numeric column (integer/real would round MONEY TO WHOLE UNITS).
      RAISE WARNING 'money: public.%.% is not numeric (found scale=%) — prices will be rounded. Change it to % manually.',
                    spec.tbl, spec.col, v_scale, spec.want_type;
      CONTINUE;
    END IF;

    IF v_scale >= 3 THEN
      RAISE NOTICE 'money: public.%.% already scale % (>= 3); skipping',
                   spec.tbl, spec.col, v_scale;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE %s',
                   spec.tbl, spec.col, spec.want_type);
    RAISE NOTICE 'money: widened public.%.% from scale % to 3 (millimes)',
                 spec.tbl, spec.col, v_scale;
  END LOOP;
END $$;


-- ============================================================================
-- 4. FOREIGN KEYS required by PostgREST embeds  (audit DB-05)
-- ============================================================================
-- PostgREST can only resolve an embedded resource (`order_items(*)`,
-- `table:restaurant_tables(table_number)`, `restaurant: restaurants(...)`)
-- through a real FK. The audited call sites ignore the error, so a missing FK
-- shows up as total, silent feature failure:
--   * src/app/api/orders/route.ts:58-63  → dashboard shows ZERO orders while
--     rows exist in public.orders.
--   * src/app/api/auth/worker/invite/[token]/route.ts:22-27 → every valid
--     invite link 404s.
-- Each FK is checked against information_schema and added only when absent, so
-- re-running is a no-op. When a FK is missing, orphan rows are counted first:
-- ADD CONSTRAINT would otherwise abort with a bare 23503.
DO $$
DECLARE
  spec     record;
  v_exists boolean;
  v_orphans bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('orders',         'restaurant_id', 'restaurants',       'id', 'orders_restaurant_id_fkey',         'CASCADE'),
      -- RESTRICT, not CASCADE: deleting a table must not silently delete that
      -- table's order history (DB-16). Matches 0001_init_schema.sql.
      ('orders',         'table_id',      'restaurant_tables', 'id', 'orders_table_id_fkey',              'RESTRICT'),
      ('order_items',    'order_id',      'orders',            'id', 'order_items_order_id_fkey',         'CASCADE'),
      ('order_items',    'product_id',    'products',          'id', 'order_items_product_id_fkey',       'SET NULL'),
      ('worker_invites', 'restaurant_id', 'restaurants',       'id', 'worker_invites_restaurant_id_fkey', 'CASCADE')
    ) AS v(tbl, col, ref_tbl, ref_col, cname, on_delete)
  LOOP
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL
       OR to_regclass(format('public.%I', spec.ref_tbl)) IS NULL THEN
      RAISE WARNING 'DB-05: public.% or public.% missing; skipping FK public.%.% -> public.%.%',
                    spec.tbl, spec.ref_tbl, spec.tbl, spec.col, spec.ref_tbl, spec.ref_col;
      CONTINUE;
    END IF;

    -- Any FK from this column to that table/column counts, whatever its name.
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name   = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name   = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type  = 'FOREIGN KEY'
        AND tc.table_schema     = 'public'
        AND tc.table_name       = spec.tbl
        AND kcu.column_name     = spec.col
        AND ccu.table_schema    = 'public'
        AND ccu.table_name      = spec.ref_tbl
        AND ccu.column_name     = spec.ref_col
    ) INTO v_exists;

    IF v_exists THEN
      RAISE NOTICE 'DB-05: FK public.%.% -> public.%.(%) already present; skipping',
                   spec.tbl, spec.col, spec.ref_tbl, spec.ref_col;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I c LEFT JOIN public.%I r ON c.%I = r.%I WHERE c.%I IS NOT NULL AND r.%I IS NULL',
      spec.tbl, spec.ref_tbl, spec.col, spec.ref_col, spec.col, spec.ref_col
    ) INTO v_orphans;

    IF v_orphans > 0 THEN
      RAISE EXCEPTION
        'DB-05: cannot add FK public.%.% -> public.%.(%) — % orphan row(s) reference values that do not exist. Repair or delete them first (see HINT), then re-run 1003.',
        spec.tbl, spec.col, spec.ref_tbl, spec.ref_col, v_orphans
        USING HINT = format(
          'Inspect: SELECT c.%I, count(*) FROM public.%I c LEFT JOIN public.%I r ON c.%I = r.%I WHERE c.%I IS NOT NULL AND r.%I IS NULL GROUP BY 1;  Then either delete the orphan rows (DELETE FROM public.%I WHERE %I NOT IN (SELECT %I FROM public.%I);) or, if the column is nullable, clear them (UPDATE public.%I SET %I = NULL WHERE ...).',
          spec.col, spec.tbl, spec.ref_tbl, spec.col, spec.ref_col, spec.col, spec.ref_col,
          spec.tbl, spec.col, spec.ref_col, spec.ref_tbl, spec.tbl, spec.col);
    END IF;

    -- The canonical name may be held by a wrong/legacy definition; replace it.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   spec.tbl, spec.cname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s',
                   spec.tbl, spec.cname, spec.col, spec.ref_tbl, spec.ref_col, spec.on_delete);
    RAISE NOTICE 'DB-05: added FK % on public.%.% -> public.%.(%) ON DELETE %',
                 spec.cname, spec.tbl, spec.col, spec.ref_tbl, spec.ref_col, spec.on_delete;
  END LOOP;
END $$;


-- ============================================================================
-- 5. POST-CONDITION VERIFICATION
-- ============================================================================
-- Re-run these any time; they only read the catalogue. The DO block below emits
-- NOTICE ... OK for every satisfied post-condition and WARNING ... FAIL for
-- every unmet one (warnings do not abort, so the editor keeps the rest of the
-- script's output visible).

-- (a) No application triggers remain on orders/order_items except
--     sufra_orders_set_day on orders:
-- SELECT c.relname AS table_name, t.tgname AS trigger_name
-- FROM pg_trigger t
-- JOIN pg_class     c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('orders', 'order_items')
--   AND NOT t.tgisinternal
-- ORDER BY 1, 2;   -- expected: exactly one row: orders | sufra_orders_set_day

-- (b) The four unique rules exist:
-- SELECT c.conname, pg_get_constraintdef(c.oid)
-- FROM pg_constraint c
-- JOIN pg_class     t ON t.oid = c.conrelid
-- JOIN pg_namespace n ON n.oid = t.relnamespace
-- WHERE n.nspname = 'public' AND c.contype = 'u'
--   AND t.relname IN ('restaurants', 'restaurant_tables', 'worker_invites')
-- ORDER BY 1;

-- (c) The four PK defaults are set:
-- SELECT table_name, column_name, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND ((table_name = 'restaurants'    AND column_name = 'id')
--     OR (table_name = 'orders'         AND column_name = 'id')
--     OR (table_name = 'order_items'    AND column_name = 'id')
--     OR (table_name = 'worker_invites' AND column_name = 'id'))
-- ORDER BY 1;

-- (d) The five FKs exist:
-- SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
-- JOIN information_schema.constraint_column_usage ccu
--   ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
-- WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
-- ORDER BY 1, 2;

DO $$
DECLARE
  v_rogue    bigint;
  v_names    text;
  spec       record;
  v_covered  boolean;
  v_default  text;
  v_exists   boolean;
  v_scale    integer;
BEGIN
  ----------------------------------------------------------------------------
  -- (a) triggers
  ----------------------------------------------------------------------------
  SELECT count(*) INTO v_rogue
  FROM pg_trigger t
  JOIN pg_class     c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('orders', 'order_items')
    AND NOT t.tgisinternal
    AND NOT (c.relname = 'orders' AND t.tgname = 'sufra_orders_set_day');

  IF v_rogue = 0 THEN
    RAISE NOTICE 'VERIFY OK  DB-17: only sufra_orders_set_day remains on public.orders; no application triggers on public.order_items';
  ELSE
    SELECT string_agg(format('%s.%s', c.relname, t.tgname), ', ')
    INTO v_names
    FROM pg_trigger t
    JOIN pg_class     c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('orders', 'order_items')
      AND NOT t.tgisinternal
      AND NOT (c.relname = 'orders' AND t.tgname = 'sufra_orders_set_day');
    RAISE WARNING 'VERIFY FAIL DB-17: % rogue trigger(s) still present: %', v_rogue, v_names;
  END IF;

  ----------------------------------------------------------------------------
  -- (b) unique rules
  ----------------------------------------------------------------------------
  FOR spec IN
    SELECT * FROM (VALUES
      ('restaurants',       ARRAY['slug']::text[]),
      ('restaurant_tables', ARRAY['restaurant_id','qr_token']::text[]),
      ('restaurant_tables', ARRAY['restaurant_id','table_number']::text[]),
      ('worker_invites',    ARRAY['invite_token']::text[])
    ) AS v(tbl, cols)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class     c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = spec.tbl
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND (
          SELECT array_agg(a.attname::text ORDER BY a.attname)
          FROM pg_attribute a
          WHERE a.attrelid = i.indrelid
            AND a.attnum = ANY (i.indkey::int2[])
        ) = (SELECT array_agg(x ORDER BY x) FROM unnest(spec.cols) AS x)
    ) INTO v_covered;

    IF v_covered THEN
      RAISE NOTICE 'VERIFY OK  DB-11: UNIQUE (%) on public.% is enforced',
                   array_to_string(spec.cols, ', '), spec.tbl;
    ELSE
      RAISE WARNING 'VERIFY FAIL DB-11: UNIQUE (%) on public.% is MISSING',
                    array_to_string(spec.cols, ', '), spec.tbl;
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- (c) PK defaults
  ----------------------------------------------------------------------------
  FOR spec IN
    SELECT * FROM (VALUES
      ('restaurants',    'id'),
      ('orders',         'id'),
      ('order_items',    'id'),
      ('worker_invites', 'id')
    ) AS v(tbl, col)
  LOOP
    SELECT c.column_default INTO v_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name  = spec.tbl
      AND c.column_name = spec.col;

    IF v_default IS NOT NULL THEN
      RAISE NOTICE 'VERIFY OK  DB-13: public.%.% DEFAULT = %', spec.tbl, spec.col, v_default;
    ELSE
      RAISE WARNING 'VERIFY FAIL DB-13: public.%.% has NO default', spec.tbl, spec.col;
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- (d) foreign keys
  ----------------------------------------------------------------------------
  FOR spec IN
    SELECT * FROM (VALUES
      ('orders',         'restaurant_id', 'restaurants'),
      ('orders',         'table_id',      'restaurant_tables'),
      ('order_items',    'order_id',      'orders'),
      ('order_items',    'product_id',    'products'),
      ('worker_invites', 'restaurant_id', 'restaurants')
    ) AS v(tbl, col, ref_tbl)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name   = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name   = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema    = 'public'
        AND tc.table_name      = spec.tbl
        AND kcu.column_name    = spec.col
        AND ccu.table_schema   = 'public'
        AND ccu.table_name     = spec.ref_tbl
    ) INTO v_exists;

    IF v_exists THEN
      RAISE NOTICE 'VERIFY OK  DB-05: FK public.%.% -> public.% is present',
                   spec.tbl, spec.col, spec.ref_tbl;
    ELSE
      RAISE WARNING 'VERIFY FAIL DB-05: FK public.%.% -> public.% is MISSING (embeds will return PGRST200)',
                    spec.tbl, spec.col, spec.ref_tbl;
    END IF;
  END LOOP;

  ----------------------------------------------------------------------------
  -- (e) money precision
  ----------------------------------------------------------------------------
  FOR spec IN
    SELECT * FROM (VALUES
      ('products',    'price'),
      ('orders',      'total'),
      ('order_items', 'price_snapshot')
    ) AS v(tbl, col)
  LOOP
    SELECT c.numeric_scale INTO v_scale
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name  = spec.tbl
      AND c.column_name = spec.col;

    IF v_scale IS NOT NULL AND v_scale >= 3 THEN
      RAISE NOTICE 'VERIFY OK  money: public.%.% stores scale % (millimes)', spec.tbl, spec.col, v_scale;
    ELSE
      RAISE WARNING 'VERIFY FAIL money: public.%.% scale is % — prices will be rounded on write (need >= 3)', spec.tbl, spec.col, COALESCE(v_scale::text, 'not numeric');
    END IF;
  END LOOP;

  RAISE NOTICE '1003_live_db_repair.sql complete — review any VERIFY FAIL warnings above.';
END $$;
