-- ============================================================================
-- Test-only shim: the minimal Supabase-hosted objects the app's migrations
-- reference, recreated on a plain Postgres.
-- ----------------------------------------------------------------------------
-- `supabase/migrations/0001_init_schema.sql` and `1002_production_readiness.sql`
-- target a Supabase project, so they reference objects Supabase provides but
-- vanilla Postgres does not:
--   * the `auth` schema, `auth.users` (the FK target for restaurants.owner_id)
--     and `auth.uid()` (used by the RLS helper `sufra_is_owner`)
--   * the `storage` schema with `storage.buckets` / `storage.objects`
--     (the `menu-images` bucket and its read policy)
--   * the roles `service_role`, `authenticated`, `anon` (GRANT / POLICY targets)
--
-- The `supabase/postgres` image ships the roles and part of `auth`, but this
-- file is written to be self-sufficient on ANY Postgres so the migration chain
-- can be exercised in CI without pulling the whole Supabase stack.
--
-- NOT part of the deployable schema. Never run this against a Supabase project.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE
);

-- Supabase defines auth.uid() by reading the request JWT claim. On a plain
-- Postgres there is no request context, so the stand-in returns NULL. That is
-- sufficient for the migrations: they only CALL it inside policy definitions,
-- which are never evaluated during DDL.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id),
  name      text
);
