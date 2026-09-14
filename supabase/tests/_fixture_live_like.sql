-- ============================================================================
-- Live-like fixture: approximates the ORIGINAL DEVELOPER'S live schema shape.
-- ----------------------------------------------------------------------------
-- Purpose: rehearse the repository's migration set against a database that has
-- the SAME DEFECTS the live project was proven to have, so the "run these
-- migrations on your database" instruction is backed by a rehearsal rather than
-- an assumption.
--
-- Reproduced defects (each verified live against the real project):
--   * `workers.id` FK -> auth.users, `workers_role_check` lowercase-only,
--     no DEFAULT on `workers.id`         (live: 23514 / 23503 / 23502)
--   * a rogue `orders` trigger that overwrites daily_order_number with a
--     1-based per-day max+1              (live: inserted 9999, stored 1)
--   * a rogue `order_items` trigger that rewrites price_snapshot from the
--     product and NULLs it for a manual line (live: 23502 on a custom line)
--   * money columns at numeric(x,2)      (live: 4.755 stored as 4.76)
--   * no UNIQUE on restaurants.slug / (restaurant_id, qr_token) /
--     (restaurant_id, table_number) / worker_invites.invite_token
--   * extra live-only columns            (telegram_chat_id, tags, updated_at…)
--
-- The trigger NAMES are deliberately unlike anything in the repo, because the
-- real ones are unknown — that is precisely what 1003's procedural drop is for.
-- ============================================================================

-- Tables exactly as the live project has them: PKs WITHOUT defaults.
CREATE TABLE public.restaurants (
  id                uuid PRIMARY KEY,
  owner_id          uuid,
  name              text NOT NULL,
  slug              text NOT NULL,
  business_type     text,
  currency          text,
  logo_url          text,
  primary_color     text,
  cover_image       text,
  tagline           text,
  menu_layout_theme text,
  is_published      boolean DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz,
  telegram_chat_id  text
);

CREATE TABLE public.categories (
  id            uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  name          text NOT NULL,
  sort_order    integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE public.products (
  id            uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  category_id   uuid NOT NULL,
  name          text NOT NULL,
  description   text,
  price         numeric(10,2) NOT NULL,
  image_url     text,
  image_source  text,
  tags          text[],
  is_available  boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz,
  sort_order    integer DEFAULT 0
);

CREATE TABLE public.restaurant_tables (
  id            uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  table_number  integer NOT NULL,
  qr_token      text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE public.orders (
  id                 uuid PRIMARY KEY,
  restaurant_id      uuid NOT NULL,
  table_id           uuid,
  status             text DEFAULT 'pending',
  total              numeric(12,2) NOT NULL,
  daily_order_number integer NOT NULL,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz,
  is_paid            boolean DEFAULT false,
  paid_at            timestamptz,
  order_day          date,
  client_ref         uuid,
  accepted_by        uuid,
  accepted_by_name   text
);

CREATE TABLE public.order_items (
  id                    uuid PRIMARY KEY,
  order_id              uuid NOT NULL,
  product_id            uuid,
  product_name_snapshot text,
  price_snapshot        numeric(10,2),
  quantity              integer NOT NULL,
  created_at            timestamptz DEFAULT now()
);

-- Workers: id FK to auth.users, lowercase-only role check, NO id default.
CREATE TABLE public.workers (
  id            uuid PRIMARY KEY REFERENCES auth.users (id),
  restaurant_id uuid NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  session_token text,
  CONSTRAINT workers_role_check CHECK (role = ANY (ARRAY['cashier'::text, 'manager'::text]))
);

CREATE TABLE public.worker_invites (
  id            uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  invite_token  text NOT NULL,
  role          text NOT NULL,
  is_used       boolean DEFAULT false,
  used_by       uuid,
  expires_at    timestamptz,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT worker_invites_role_check CHECK (role = ANY (ARRAY['cashier'::text, 'manager'::text]))
);

-- Rogue trigger 1: racy 1-based per-day ticket numbering (stomps the RPC).
CREATE OR REPLACE FUNCTION public.zz_live_ticket_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT COALESCE(max(daily_order_number), 0) + 1
    INTO NEW.daily_order_number
    FROM public.orders
   WHERE restaurant_id = NEW.restaurant_id
     AND created_at::date = COALESCE(NEW.created_at, now())::date;
  RETURN NEW;
END $$;

CREATE TRIGGER zz_live_order_ticket
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.zz_live_ticket_number();

-- Rogue trigger 2: rewrites price_snapshot from products, NULLs manual lines.
CREATE OR REPLACE FUNCTION public.zz_live_price_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT price INTO NEW.price_snapshot FROM public.products WHERE id = NEW.product_id;
  ELSE
    NEW.price_snapshot := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER zz_live_item_price
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.zz_live_price_rewrite();

-- Representative data in the same SHAPE as the live database: 1 restaurant,
-- 6 tables, 1 historical order. The values are SYNTHETIC on purpose.
--
-- This fixture reproduces a schema's DEFECTS, not a project's data, so it must
-- never carry the real values: a live `qr_token` is the credential a guest uses
-- to open and order from a specific table, and a live `owner_id` identifies a
-- real account. Substituting fake ids and tokens keeps the schema shape exactly
-- (still uuid-typed, still 6 tables, still one restaurant) while making the file
-- safe to publish.
INSERT INTO public.restaurants (id, owner_id, name, slug, is_published, updated_at)
VALUES ('11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'Fixture Cafe', 'fixture-cafe', true, now());

INSERT INTO public.restaurant_tables (id, restaurant_id, table_number, qr_token)
SELECT gen_random_uuid(), '11111111-1111-4111-8111-111111111111', n,
       'fixturetoken' || n
FROM generate_series(1, 6) AS n;

INSERT INTO public.orders (id, restaurant_id, table_id, status, total,
                           daily_order_number, created_at, order_day)
SELECT 'cccccccc-0000-4000-8000-000000000001',
       '11111111-1111-4111-8111-111111111111',
       (SELECT id FROM public.restaurant_tables LIMIT 1),
       'pending', 9, 1001, '2026-09-08T00:00:00Z', '2026-09-08';
