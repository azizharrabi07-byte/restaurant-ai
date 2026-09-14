-- ============================================================================
-- 1004_session_hardening.sql — Sufra / restaurant-ai
-- ============================================================================
-- WHAT THIS FILE IS FOR
--   The schema support required by three lib-core audit findings whose code
--   fixes land in this same change set:
--     * LIB-02 — worker sessions never expired server-side. The code fix makes
--       `lookupWorkerByToken` require `session_expires_at > now()`, stamps the
--       column when a session is minted (POST /api/auth/worker/accept) and
--       NULLs `session_token` + `session_expires_at` on worker logout.
--       -> SECTION 1 adds `workers.session_expires_at`.
--     * LIB-25 — the invite readers treated a NULL `expires_at` as "never
--       expires" (fail-open TTL). The code fix rejects a NULL expiry in BOTH
--       readers (accept + invite preview); SECTION 2 makes the schema honest
--       so the column can never be NULL again.
--       -> SECTION 2 backfills NULLs and makes `worker_invites.expires_at`
--          `NOT NULL DEFAULT now() + interval '24 hours'`.
--     * LIB-12 — `products.sort_order` was added by 1002 §4 but only ever
--       half-wired. This file re-asserts the column/population so the menu
--       ordering contract holds on every database, without renumbering rows
--       the owner has deliberately ordered.
--       -> SECTION 3.
--
-- IDEMPOTENT / RE-RUNNABLE
--   Every statement is guarded: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF
--   NOT EXISTS`, `SET DEFAULT` / `SET NOT NULL` (no-ops when already applied),
--   and `DO` blocks that test `to_regclass` + `information_schema.columns`
--   before touching anything. Running it twice changes nothing; running it on a
--   database that is missing a table prints a NOTICE and skips that section.
--
-- SAFE ON BOTH DATABASES
--   * A FRESH Supabase project: run AFTER 0001_init_schema.sql (which creates
--     workers / worker_invites / products) and after 1002 / 1003.
--   * The ORIGINAL developer's existing database: the guards tolerate the
--     pre-existing ad-hoc schema (e.g. `worker_invites` there has a different
--     column set), and nothing here is dropped or rewritten destructively.
--
-- DELIBERATELY NOT HERE
--   * No RLS policies — the app has one DB client (`supabaseAdmin`, service
--     role) which bypasses RLS; 1002 owns the defense-in-depth policies.
--   * No trigger touching `orders.daily_order_number` or
--     `order_items.price_snapshot` — a prior audit proved those triggers break
--     the product.
--   * No `DROP` of any kind.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — WORKER SESSION EXPIRY  (fixes LIB-02)
-- ============================================================================
-- `session_expires_at` is nullable on purpose:
--   * NULL means "no active session" (logout NULLs both token and expiry), and
--   * a row that never signed in simply has both columns NULL.
-- The app stamps it at session mint time from WORKER_SESSION_MAX_AGE (7 days),
-- and `lookupWorkerByToken` now filters on `session_expires_at > now()`.
--
-- No extra index is added: the lookup is `WHERE session_token = $1`, and that
-- column already carries the UNIQUE constraint `workers_session_token_key`
-- (0001 §3, mirrored by 1002 §5), which provides the btree index the lookup
-- needs. A second index on the same single column would only add write cost.

DO $session_expiry$
BEGIN
  IF to_regclass('public.workers') IS NULL THEN
    RAISE NOTICE '1004: public.workers not found — skipping session_expires_at (LIB-02)';
    RETURN;
  END IF;

  ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;

  RAISE NOTICE '1004: workers.session_expires_at ensured (LIB-02)';
END
$session_expiry$;


-- ============================================================================
-- SECTION 2 — INVITE EXPIRY CANNOT BE NULL  (fixes LIB-25)
-- ============================================================================
-- A NULL `expires_at` used to read as "valid forever" because both readers
-- tested `invite.expires_at && new Date(...) < Date.now()`. The code fix
-- rejects NULL outright; this section makes the column non-NULL so a future
-- writer that omits it cannot create an immortal credential.
--
-- Backfill value: `created_at + interval '24 hours'` when the table carries
-- `created_at` (the original developer's DB does), i.e. the same 24 h TTL the
-- app applies at mint time. A stale invite therefore backfills to an ALREADY
-- EXPIRED timestamp — the fail-closed direction. Where `created_at` is absent
-- (the fresh 0001 schema) the fallback is `now() + interval '24 hours'`.
-- `worker_invites` has no `created_at` column in 0001, so both branches exist.

DO $invite_expiry$
DECLARE
  v_has_created_at boolean;
BEGIN
  IF to_regclass('public.worker_invites') IS NULL THEN
    RAISE NOTICE '1004: public.worker_invites not found — skipping expiry hardening (LIB-25)';
    RETURN;
  END IF;

  -- Add the column if a pre-existing database somehow lacks it, nullable first
  -- so the backfill below can populate the existing rows.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_invites'
      AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE public.worker_invites ADD COLUMN expires_at timestamptz;
    RAISE NOTICE '1004: added missing worker_invites.expires_at';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_invites'
      AND column_name = 'created_at'
  ) INTO v_has_created_at;

  -- Backfill: only rows that are actually NULL, so a re-run is a no-op.
  IF v_has_created_at THEN
    EXECUTE $sql$
      UPDATE public.worker_invites
      SET expires_at = COALESCE(created_at, now()) + interval '24 hours'
      WHERE expires_at IS NULL
    $sql$;
  ELSE
    UPDATE public.worker_invites
    SET expires_at = now() + interval '24 hours'
    WHERE expires_at IS NULL;
  END IF;

  -- Make NULL impossible going forward. Both statements are idempotent: SET
  -- DEFAULT overwrites the same value, and SET NOT NULL is a no-op once the
  -- column is already NOT NULL.
  ALTER TABLE public.worker_invites
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
  ALTER TABLE public.worker_invites
    ALTER COLUMN expires_at SET NOT NULL;

  RAISE NOTICE '1004: worker_invites.expires_at backfilled, NOT NULL, default +24h (LIB-25)';
END
$invite_expiry$;


-- ============================================================================
-- SECTION 3 — PRODUCT ORDERING SUPPORT  (fixes LIB-12)
-- ============================================================================
-- 1002 §4 already adds `products.sort_order integer NOT NULL DEFAULT 0` and
-- backfills it; the code fix now writes `sort_order` from the sync payload and
-- both readers order by it. This section is the guarded no-op-on-a-healthy-DB
-- re-assertion: it creates the column if a database predates 1002, repairs a
-- pre-existing nullable/default-less variant, and backfills ONLY rows still at
-- `sort_order = 0` (never renumbering rows the owner has deliberately ordered).

DO $products_order$
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE NOTICE '1004: public.products not found — skipping sort_order (LIB-12)';
    RETURN;
  END IF;

  ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

  -- Repair a pre-existing column that is nullable or has no default.
  ALTER TABLE public.products
    ALTER COLUMN sort_order SET DEFAULT 0;
  UPDATE public.products SET sort_order = 0 WHERE sort_order IS NULL;
  ALTER TABLE public.products
    ALTER COLUMN sort_order SET NOT NULL;

  -- Backfill insertion order, per restaurant, only for the untouched rows.
  UPDATE public.products p
  SET sort_order = seq.rn
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY restaurant_id ORDER BY created_at, id
      ) - 1 AS rn
    FROM public.products
  ) AS seq
  WHERE p.id = seq.id
    AND p.sort_order = 0;

  CREATE INDEX IF NOT EXISTS products_menu_order
    ON public.products (restaurant_id, sort_order, created_at);

  RAISE NOTICE '1004: products.sort_order ensured + backfilled where 0 (LIB-12)';
END
$products_order$;


-- ============================================================================
-- SECTION 4 — VERIFICATION
-- ============================================================================
-- Confirms the post-conditions of the three sections above. It emits NOTICEs
-- and WARNINGs; it never throws, so a re-run always completes. It is also safe
-- when a table is missing (each statement is only planned once its guarded
-- branch actually executes).
DO $verify$
DECLARE
  v_count bigint;
BEGIN
  -- (1) LIB-02: the session expiry column exists.
  IF to_regclass('public.workers') IS NULL THEN
    RAISE WARNING '1004 verify: public.workers is MISSING';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workers'
      AND column_name = 'session_expires_at'
  ) THEN
    RAISE NOTICE '1004 verify OK: workers.session_expires_at exists';
  ELSE
    RAISE WARNING '1004 verify: workers.session_expires_at is MISSING';
  END IF;

  -- (2) LIB-25: no NULL invite expiry remains and the column is NOT NULL.
  IF to_regclass('public.worker_invites') IS NULL THEN
    RAISE WARNING '1004 verify: public.worker_invites is MISSING';
  ELSE
    SELECT count(*) INTO v_count
    FROM public.worker_invites
    WHERE expires_at IS NULL;

    IF v_count = 0 THEN
      RAISE NOTICE '1004 verify OK: worker_invites.expires_at has no NULL rows';
    ELSE
      RAISE WARNING '1004 verify: % worker_invites row(s) still have NULL expires_at', v_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'worker_invites'
        AND column_name = 'expires_at' AND is_nullable = 'NO'
    ) THEN
      RAISE NOTICE '1004 verify OK: worker_invites.expires_at is NOT NULL';
    ELSE
      RAISE WARNING '1004 verify: worker_invites.expires_at is still NULLABLE';
    END IF;
  END IF;

  -- (3) LIB-12: sort_order exists, is NOT NULL, and is populated.
  IF to_regclass('public.products') IS NULL THEN
    RAISE WARNING '1004 verify: public.products is MISSING';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'sort_order'
  ) THEN
    RAISE WARNING '1004 verify: products.sort_order is MISSING';
  ELSE
    SELECT count(*) INTO v_count
    FROM public.products
    WHERE sort_order IS NULL;

    IF v_count = 0 THEN
      RAISE NOTICE '1004 verify OK: products.sort_order is populated on every row';
    ELSE
      RAISE WARNING '1004 verify: % products row(s) still have NULL sort_order', v_count;
    END IF;
  END IF;
END
$verify$;

-- Optional manual inspection (run by hand; nothing below executes on migrate):
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (
--            ('workers', 'session_expires_at'),
--            ('worker_invites', 'expires_at'),
--            ('products', 'sort_order')
--          )
--    ORDER BY table_name, column_name;
--
--   SELECT count(*) AS null_invite_expiries
--     FROM public.worker_invites WHERE expires_at IS NULL;   -- expect 0
--
--   SELECT restaurant_id, count(*) AS products,
--          count(*) FILTER (WHERE sort_order = 0) AS at_zero
--     FROM public.products
--    GROUP BY restaurant_id
--    ORDER BY restaurant_id;
