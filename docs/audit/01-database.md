# Database Audit

**Branch:** `rag-option` · **Slice:** schema + migrations + every DB call site
**Scope read:** `src/lib/supabase-admin.ts`, `supabase/migrations/1002_production_readiness.sql`,
every `.ts`/`.tsx` under `src/` that touches `.from(` / `.rpc(` / `.storage.` / `.auth.`,
`.env.example`, `README.md` §2, `docker-compose.yml`, `.github/workflows/ci.yml`.
**Prior art (read, not trusted):** `FINAL-AGENT2-AUDIT.md`, `SECURITY-REPORT-ROUND-2.md`.
**Read-only:** no code or SQL was modified. Prior art's live-DB probes describe the *original
developer's* project; per the audit brief those credentials are unavailable to us, so every
claim below is derived from the repo tree and is marked `VERIFIED` (read directly in a file)
or `INFERENCE` (derived, not directly observed).

## Verdict

This slice does not work and cannot be made to work from the repository as shipped: there is
**no base schema anywhere in the repo**, and `1002_production_readiness.sql` is an incremental
patch that assumes eight tables already exist, so the very first statement (`REFERENCES
public.restaurants(id)`, `1002:28`) fails with `42P01` on a fresh Supabase project. Because the
base tables are lost, the *real* specification of this app's database is only recoverable from
code — which is why §"Schema inventory" below is exhaustive and column-by-column. On top of the
missing schema, `1002` has three classes of genuine defects: it is **not actually idempotent**
(its dedupe block renumbers already-issued tickets on every re-run, `1002:77-90`), its
**day boundary is defined twice** (local `CURRENT_DATE` for the counter vs UTC for the index,
`1002:29,68,96-97`), and its RLS "safeguard" is an incomplete name-based denylist that would
leave legacy permissive policies on `workers`/`worker_invites` in place (`1002:279-284`),
exposing `session_token`. Verdict for the database slice: **BROKEN — blocked by the missing
base schema (DB-01); the app's every DB call is one 42703 away from a silent or loud failure.**

## Required behaviour

The app has exactly one DB client: `supabaseAdmin` built from
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/supabase-admin.ts:7-15`).
The browser never holds a Supabase key, so **every** requirement below is exercised through the
service role, which bypasses RLS. The base schema must therefore be recovered synthetically and
must satisfy: (a) the column contract in the inventory, (b) the uniqueness/FK contract that
several `.single()` / `maybeSingle()` / embedded-select call sites depend on, and (c) the DB-level
objects the app calls by name. The ordered runbook at the end is the minimal path from an empty
Supabase project to a working database.

### Schema inventory (required by the application)

Legend — **Type**: `uuid` where the app generates `crypto.randomUUID()` ids or compares against
`auth.uid()`, `numeric(p,2)` for money (see DB-14), `timestamptz` for ISO-8601 strings written by
the API. **Null**: `NN` = must be NOT NULL, `NN*` = app never supplies it so a DEFAULT is
mandatory, `NULL` = nullable. **1002** = does the migration create it. **R-READ** = listed in
README §2 "Live tables" (`README.md:90-100`). Money columns are typed `numeric(p,2)` by
`[INFERENCE]` from `lineTotal` 2-dp rounding (`src/lib/order-utils.ts:161-163`).

#### `restaurants`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN* | `gen_random_uuid()` | `src/app/api/menu/route.ts:56` (`select("id")`) — insert at `:193-205` omits it → 23502 without the default |
| `owner_id` | uuid | NULL | — | `src/app/api/menu/route.ts:57` (`.eq("owner_id", …)`); FK → `auth.users(id)` per `README.md:91` |
| `name` | text | NN | — | `src/app/api/menu/route.ts:178` (write) |
| `slug` | text | NN | — | `src/app/api/menu/route.ts:179` (write), `src/app/menu/[slug]/[token]/page.tsx:23` (`.eq("slug").single()`) |
| `tagline` | text | NN* | `''` | `src/app/api/menu/route.ts:180` |
| `business_type` | text | NN* | `'cafe'` | `src/app/api/menu/route.ts:181` |
| `currency` | text | NN* | `'TND'` | `src/app/api/menu/route.ts:198` (insert only) |
| `logo_url` | text | NULL | — | `src/app/api/menu/route.ts:182` |
| `cover_image` | text | NULL | — | `src/app/api/menu/route.ts:183` |
| `primary_color` | text | NN* | `'#D97706'` | `src/app/api/menu/route.ts:184` |
| `menu_layout_theme` | text | NN* | `'classic'` | `src/app/api/menu/route.ts:185`, read at `:105` |
| `is_published` | boolean | NN* | `false` | `src/app/api/menu/route.ts:186`, read at `:106` |
| `created_at` | timestamptz | NN* | `now()` | `src/app/api/menu/route.ts:58` (`.order("created_at")`) — never supplied by the app |
| `updated_at` | timestamptz | NN | — | `src/app/api/menu/route.ts:187` (app supplies ISO string) |

Constraints the app requires: PK on `id`; **UNIQUE on `slug`** (DB-04); `owner_id` nullable
(`auth/signup/route.ts:89` binds rows `where owner_id is null`).

#### `categories`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN | — | `src/app/api/menu/route.ts:267` (`upsert(rows, {onConflict:"id"})`) |
| `restaurant_id` | uuid | NN | — | `src/app/api/menu/route.ts:268`; RLS policy `1002:228` |
| `name` | text | NN | — | `src/app/api/menu/route.ts:269` |
| `sort_order` | integer | NN | `0` | `src/app/api/menu/route.ts:73` (`.order("sort_order")`), write at `:270`, read at `:111` and `page.tsx:54` |

**`categories.sort_order` is required by the app** (`menu/route.ts:73,270`; `page.tsx:34`) but
`1002` only adds `sort_order` to `products` (`1002:123-124`) — see DB-01/DB-02.

#### `products`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN | — | `src/app/api/menu/route.ts:316` |
| `restaurant_id` | uuid | NN | — | `src/app/api/menu/route.ts:317` |
| `category_id` | uuid | NN | — | `src/app/api/menu/route.ts:318`; FK → `categories(id)` (orphan cleanup at `:299-309`) |
| `name` | text | NN | — | `src/app/api/menu/route.ts:319` |
| `description` | text | NN* | `''` | `src/app/api/menu/route.ts:320` |
| `price` | numeric(10,2) | NN | — | `src/app/api/orders/route.ts:161` (`Number(p.price)`) |
| `image_url` | text | NULL | — | `src/app/api/menu/route.ts:322` |
| `image_source` | text | NN* | `'pending'` | `src/app/api/menu/route.ts:323` — **written on every save, read nowhere** |
| `is_available` | boolean | NN* | `true` | `src/app/menu/[slug]/[token]/page.tsx:39` (`.eq("is_available", true)`) |
| `created_at` | timestamptz | NN* | `now()` | `src/app/api/menu/route.ts:78` (`.order("created_at")`) — never supplied by the app |
| `updated_at` | timestamptz | NN | — | `src/app/api/menu/route.ts:325` (app supplies ISO string) |
| `sort_order` | integer | NN | `0` | **no application code reads or writes it** (DB-18) |

#### `restaurant_tables`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN | — | `src/app/api/menu/route.ts:357` |
| `restaurant_id` | uuid | NN | — | `src/app/api/menu/route.ts:358` |
| `table_number` | integer | NN | — | `src/app/api/orders/route.ts:239` (`.eq("table_number", …).single()`), order at `menu/route.ts:83` |
| `qr_token` | text | NN | — | `src/app/api/orders/route.ts:232` (`.eq("qr_token", …)`), `page.tsx:45` |

Required: `UNIQUE (restaurant_id, qr_token)` and `UNIQUE (restaurant_id, table_number)` — both
consumer paths use `.single()`/`.maybeSingle()` (DB-11).

#### `orders`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN* | `gen_random_uuid()` | `src/app/api/orders/route.ts:274-278` (insert omits `id`) |
| `restaurant_id` | uuid | NN | — | `src/app/api/orders/route.ts:265`; FK → `restaurants(id)` |
| `table_id` | uuid | NN | — | `src/app/api/orders/route.ts:266`; FK → `restaurant_tables(id)` **required for the embed at `:60`** (DB-05) |
| `status` | text | NN* | `'pending'` | `src/app/api/orders/route.ts:267` |
| `total` | numeric(12,2) | NN | — | `src/app/api/orders/route.ts:268` |
| `daily_order_number` | integer | NN | — | `src/app/api/orders/route.ts:269` |
| `is_paid` | boolean | NN* | `false` | `src/app/api/orders/route.ts:270` |
| `client_ref` | uuid | NULL | — | `src/app/api/orders/route.ts:272` (created by `1002:107`) |
| `created_at` | timestamptz | NN* | `now()` | `src/app/api/orders/route.ts:277` (`.select("… created_at")`) — never supplied by the app; consumed by the `1002` trigger at `1002:68` |
| `accepted_by` | uuid | NULL | — | `src/app/api/orders/route.ts:27` (read), `orders/[id]/route.ts:99` (write; created by `1002:116`) |
| `accepted_by_name` | text | NULL | — | `src/app/api/orders/route.ts:28`, write at `orders/[id]/route.ts:100` (`1002:118`) |
| `paid_at` | timestamptz | NULL | — | `src/app/api/orders/[id]/route.ts:92` (write, ISO string) |
| `order_day` | date | NN`[INFERENCE]` | — | `1002:61`; set by trigger `1002:63-75`; read only by the unique index `1002:96-97` |

Required: `CHECK (status IN ('pending','accepted'))` — the PATCH route states this invariant in a
comment (`src/app/api/orders/[id]/route.ts:84-85`) and never writes `'paid'`. `accepted_by`
must **not** be an FK to `auth.users` (prior art F1: workers are not auth users) and, if it is an
FK to `workers(id)`, it must be `ON DELETE SET NULL` or worker revocation breaks
(`src/app/api/workers/[id]/route.ts:47`).

#### `order_items`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN* | `gen_random_uuid()` | `src/app/api/orders/route.ts:289` (insert omits `id`) |
| `order_id` | uuid | NN | — | `src/app/api/orders/route.ts:282`; FK → `orders(id)` **required for the embed at `:60`** and for the RLS policy `1002:237-249` (DB-05) |
| `product_id` | uuid | NULL | — | `src/app/api/orders/route.ts:283` (`null` for worker manual lines) |
| `product_name_snapshot` | text | NN | — | `src/app/api/orders/route.ts:284` |
| `quantity` | integer | NN | — | `src/app/api/orders/route.ts:285` |
| `price_snapshot` | numeric(10,2) | NN | — | `src/app/api/orders/route.ts:286` |

`order_items` must have **no** trigger that rewrites `price_snapshot` or NULLs custom lines
(prior art C2, live-verified against the original project; `1002` does not address it — DB-17).

#### `workers`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | `src/lib/worker-auth.ts:67`; insert supplies it explicitly at `auth/worker/accept/route.ts:81` |
| `restaurant_id` | uuid | NN | — | `src/lib/worker-auth.ts:68`; FK → `restaurants(id)` |
| `full_name` | text | NN | — | `src/lib/worker-auth.ts:67`, insert at `accept/route.ts:83` |
| `role` | text | NN | — | `src/lib/worker-auth.ts:67`, insert at `accept/route.ts:84`; `CHECK (role IN ('Cashier','Manager',…))` at `1002:311-312` |
| `session_token` | text | NULL | — | `src/lib/worker-auth.ts:68` (created by `1002:149`) — **UNIQUE required** |
| `created_at` | timestamptz | NN* | `now()` | `src/app/api/workers/route.ts:34` (`.select("… created_at")`, order at `:36`) — never supplied by the app |

`workers.id` must **not** have an FK to `auth.users` (prior art F1; `1002:309` drops
`workers_id_fkey`). No `expires_at`: worker sessions have no DB-side expiry (7-day cookie only,
`src/lib/worker-auth.ts:20`).

#### `worker_invites`

| Column | Type | Null | Default | First real use |
|---|---|---|---|---|
| `id` | uuid | NN* | `gen_random_uuid()` | `src/app/api/auth/worker/accept/route.ts:59` (`.select("id …")`), `:107` (`.eq("id", …)`) |
| `restaurant_id` | uuid | NN | — | `src/app/api/auth/worker/invite/route.ts:54`; FK → `restaurants(id)` **required for the embed at `invite/[token]/route.ts:24`** (DB-05) |
| `invite_token` | text | NN | — | `src/app/api/auth/worker/accept/route.ts:60` (`.eq("invite_token", …).maybeSingle()`) — 32 hex chars (`src/lib/worker-invite.ts:8`) |
| `role` | text | NN | — | `src/app/api/auth/worker/invite/route.ts:56`; `CHECK` at `1002:315-316` |
| `is_used` | boolean | NN | `false` | `src/app/api/auth/worker/accept/route.ts:65` (read), `:106` (claim), `invite/route.ts:57` (insert) |
| `used_by` | uuid | NULL | — | `src/app/api/auth/worker/accept/route.ts:119` — **never mentioned in any `1002` statement** (DB-02) |
| `expires_at` | timestamptz | NN | — | `src/app/api/auth/worker/invite/route.ts:58` (insert, ISO), read at `accept/route.ts:66` |

Required: `UNIQUE (invite_token)` (DB-11). `used_by` must reference `workers(id)` **or** be a
plain `uuid` with no FK to `auth.users` — the accept route writes a worker id into it.

#### `sufra_daily_counters` (created by `1002:27-32`)

| Column | Type | Null | Default | Note |
|---|---|---|---|---|
| `restaurant_id` | uuid | NN | — | FK → `restaurants(id) ON DELETE CASCADE` (`1002:28`) |
| `day` | date | NN | `CURRENT_DATE` | local-day, see DB-08 |
| `last_number` | integer | NN | `1001` | PK is `(restaurant_id, day)` |

The app never touches this table directly — only through the RPC
(`src/app/api/orders/route.ts:103`).

### DB-level objects the app calls

| Object | Called from | Provided by |
|---|---|---|
| `public.sufra_next_order_number(uuid) RETURNS integer` | `src/app/api/orders/route.ts:103` (`.rpc("sufra_next_order_number", { p_restaurant })`) | `1002:34-44`; falls back to a max+1 query if the RPC errors (`orders/route.ts:108-116`) |
| `public.sufra_set_order_day()` trigger `sufra_orders_set_day` on `orders` | implicit (sets `orders.order_day`, the unique-index key) | `1002:63-75` |
| `public.sufra_is_owner(uuid)` | RLS policies `1002:228,241,248,261,270` | `1002:194-203`; requires `auth.uid()` and `restaurants.owner_id` |
| Storage bucket `menu-images` (public read) | `src/app/api/upload/route.ts:8,20,26,93,101` | `1002:291-293`; the route also self-heals via `storage.getBucket`/`createBucket` (`upload/route.ts:17-31`) |
| `auth.users` / `auth.uid()` | `restaurants.owner_id` (`README.md:91`), `1002:201`, all of `src/app/api/auth/*` (GoTrue) | Supabase Auth (not in repo) |
| roles `service_role`, `authenticated` | `1002:47,205-206,214,228,236,260,269` | Supabase-specific roles |

Application **reads environment**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
(`src/lib/supabase-admin.ts:7-8`), `SUFRA_PLACEHOLDER_OWNER_EMAIL` (`src/app/api/auth/signup/route.ts:21`).
`supabaseAdmin` is `null` when URL or key is missing, and **every route then degrades to
`cloud:false` 503 / empty data** rather than erroring (`supabase-admin.ts:10-15`,
`api/menu/route.ts:46`, `api/menu/[slug]/…/page.tsx:16-18`) — which is why a missing DB looks
like an empty product.

### `1002` assumption map — statements that ERROR without the base schema

All line numbers are `supabase/migrations/1002_production_readiness.sql`. Error codes are
PostgreSQL SQLSTATEs. Because the SQL editor submits the whole buffer as one implicit
transaction, the **first** error aborts and rolls back the remainder.

| Lines | Statement requires | Fails with if absent |
|---|---|---|
| 28 | `public.restaurants(id)` + PK | `42P01` undefined_table — **the first failure on a fresh project** |
| 47 | role `service_role` | `42704` undefined_object |
| 60-61 | `public.orders` | `42P01` |
| 63-75 | `orders.created_at` (plpgsql body — created without semantic validation, fails **at insert time**) | `42703` on every order insert (`[INFERENCE]` on plpgsql lazy validation) |
| 77-90 | `orders.restaurant_id`, `orders.created_at`, `orders.daily_order_number`, `orders.id` | `42703` — aborts the migration here |
| 92-94 | `orders.created_at`, `orders.order_day` | `42703` |
| 96-97 | `orders(restaurant_id, order_day, daily_order_number)` | `42703`; `23505` if the renumber step collided (DB-09) |
| 106-118 | `public.orders` | `42P01` |
| 123-124 | `public.products` | `42P01` |
| 127-140 | `products.restaurant_id`, `products.created_at`, `products.id`, `products.sort_order` | `42703` — **`products.created_at` is not created by this file** |
| 148-153 | `public.workers`, `public.worker_invites(invite_token)`, `workers.restaurant_id` | `42P01` / `42703` |
| 158-171 | `products.price`, `orders.total`, `order_items.quantity` | `42703`; `23514` if existing rows violate the new CHECK (DB-12) |
| 183-191 | the 8 base tables + `sufra_daily_counters` | `42P01` |
| 194-203 | `restaurants.owner_id`, `auth.uid()` | `42703` / `42883` undefined_function |
| 205-206 | roles `authenticated`, `service_role` | `42704` |
| 210-271 | `restaurants.owner_id`; `categories/products/restaurant_tables/orders.restaurant_id`; `order_items.order_id`; `orders.id`, `orders.restaurant_id`; `workers.restaurant_id`; `worker_invites.restaurant_id` | `42703`/`42P01` (and `42704` for the role in every `TO authenticated`) |
| 279-284 | policies named `public_read_all` on 6 tables | no-op if absent (safe) |
| 291-299 | `storage.buckets(id,name,public)`, `storage.objects.bucket_id` | `42P01` — Supabase-only schemas |
| 309-313 | `public.workers.id`, constraint `workers_id_fkey` | `42703` (the `DROP … IF EXISTS` parts are safe) |
| 314-316 | `worker_invites.role` | `42703` |

Columns the app requires that **no statement in `1002` ever mentions** (silently assumed):
`restaurants` → `name, slug, tagline, business_type, currency, logo_url, cover_image,
primary_color, menu_layout_theme, is_published, created_at, updated_at`;
`categories` → `id, restaurant_id, name, sort_order`;
`products` → `name, description, category_id, image_url, image_source, is_available, updated_at`;
`restaurant_tables` → `id, restaurant_id, table_number, qr_token`;
`orders` → `table_id, status, is_paid, paid_at`;
`order_items` → `id, order_id, product_id, product_name_snapshot, price_snapshot`;
`workers` → `full_name, created_at`;
`worker_invites` → `id, restaurant_id, is_used, used_by, expires_at`.

### What a fresh project needs, in order

1. **CLI config first.** `supabase/config.toml` **does not exist in the repo** — `supabase/`
   contains only `migrations/1002_production_readiness.sql` (`glob supabase/**/*`), and
   `config.toml` is not gitignored, so it was never committed. `README.md:1-38` and
   `docker-compose.yml:5` both tell the developer to run `supabase start`; that command fails
   without `supabase init` first (`[INFERENCE]` on the exact message). Run `supabase init`
   (or create a hosted project — then skip 2).
2. **Provision Postgres with `auth`, `storage` schemas and the `anon`/`authenticated`/
   `service_role` roles.** A hosted Supabase project or `supabase start` provides all of them;
   a vanilla Postgres does not (DB-15).
3. **Author and run `supabase/migrations/0001_init_schema.sql`** (owned by the base-schema
   slice, not this one). It must create, in this FK order — `restaurants` → `categories` →
   `products` → `restaurant_tables` → `orders` → `order_items` → `workers` → `worker_invites` —
   every column in the inventory above, with the defaults, PKs, the four uniqueness rules from
   DB-11, the FKs from DB-05, `orders.status` CHECK, and `restaurants.owner_id → auth.users(id)`.
4. **Run `1002_production_readiness.sql`** (adds counters/RPC, `order_day` + trigger,
   `client_ref`, `accepted_by(_name)`, `products.sort_order`, `session_token`, CHECKs, RLS,
   bucket row).
5. **Drop the legacy triggers** if the target is an existing project rather than a fresh one:
   list them with
   `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid IN ('public.orders'::regclass,'public.order_items'::regclass) AND NOT tgisinternal;`
   then drop everything except `sufra_orders_set_day` (DB-17).
6. **Verify the post-conditions** (all must return the stated result):
   `SELECT public.sufra_next_order_number('<restaurant-uuid>');` → integer, starts at `1001`;
   `SELECT count(*) FROM storage.buckets WHERE id='menu-images';` → `1`;
   `SELECT tgname FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal;`
   → exactly `sufra_orders_set_day`;
   `SELECT policyname FROM pg_policies WHERE schemaname='public';` → only the owner policies
   from `1002:210-271` (no `using(true)` survivors, DB-06).
7. **`.env.local`** with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_APP_URL`; `SUFRA_PLACEHOLDER_OWNER_EMAIL` is read by signup but documented
   nowhere (DB-21).
8. **First-run ownership:** create exactly one `restaurants` row with `owner_id IS NULL`, then
   `POST /api/auth/signup` binds it (`src/app/api/auth/signup/route.ts:88-89`); any restaurant
   already owned by a non-placeholder user makes signup return `OWNER_EXISTS` (`:60-62`).

**What `supabase start` alone still leaves missing:** (a) it cannot start at all —
`config.toml` is absent; (b) no base tables — 1002 is incremental; (c) no rows in
`restaurants`, so every owner-scoped query returns empty and `authBypassEnabled()`'s dev
sessions resolve to `null` (`src/lib/owner-auth.ts:52-53`, `src/lib/worker-auth.ts:109-110`);
(d) storage bucket — created by `1002:291-293` (the local stack does include the `storage`
schema, so this one step works); (e) email flows (`recover`/`reset`) need the local mail
catcher and a `config.toml` `[auth]` section that does not exist in the repo.

## Findings

### DB-01 · Critical · migrations/base-schema · VERIFIED
- **Evidence:** `supabase/` contains exactly one file, `migrations/1002_production_readiness.sql`
  (`glob supabase/**/*`). Its own header (`1002:5-7`) states it "assumes the tables created by
  earlier (ad-hoc) migrations exist"; the first executable statement is
  `REFERENCES public.restaurants(id)` (`1002:28`). No `CREATE TABLE` for any of the eight base
  tables exists anywhere in the repo (`grep -r "CREATE TABLE"` → only `sufra_daily_counters`).
  `README.md:74` says "the schema lives in versioned SQL, not in this README" — that is false:
  only the *incremental* migration lives in SQL.
- **Impact:** Nobody can stand the app up from the repo. A single-provider/contractor handoff
  loses the database; every route degrades to `cloud:false`/`EMPTY` (`src/app/api/menu/route.ts:46`)
  which presents as "the product is empty" rather than "the database is missing".
- **Fix:** The inventory in this report is the specification; the base-schema slice must author
  `supabase/migrations/0001_init_schema.sql` from it before `1002` can run.

### DB-02 · Critical · schema contract · VERIFIED
- **Evidence:** the app writes columns that neither `1002` nor the README 'live tables' list
  (`README.md:90-100`) accounts for: `products.updated_at` (`src/app/api/menu/route.ts:325`),
  `restaurants.updated_at` (`:187`), `orders.table_id` (`src/app/api/orders/route.ts:266`),
  `worker_invites.used_by` (`src/app/api/auth/worker/accept/route.ts:119`),
  `workers.created_at` (`src/app/api/workers/route.ts:34`), `restaurant_tables.id`
  (`src/app/api/menu/route.ts:357`), `orders.restaurant_id` used by the index at `1002:97`.
  A developer rebuilding from README+1002 would omit them.
- **Impact:** `42P03`/`42703` at runtime: menu PUT returns `500 UPSERT_PRODUCTS`
  (`src/app/api/menu/route.ts:332-334`) because `updated_at` is in the upsert row; the worker
  list returns `500 LIST_WORKERS` (`src/app/api/workers/route.ts:37-39`); order insertion fails
  `42703` on `table_id` (`orders/route.ts:410-413`). All are silent schema bugs, not logic bugs.
- **Fix:** Treat §"Schema inventory" as normative; every column there is required by at least one
  call site cited in the table.

### DB-03 · High · `PUT /api/menu` · VERIFIED
- **Evidence:** `src/app/api/menu/route.ts:175-189` awaits
  `.from("restaurants").update({… updated_at …}).eq("id", restaurantId)` and never inspects the
  returned `error`; the handler returns `{cloud:true}` at `:387-390`. Contrast `:277-279`,
  `:332-334`, `:366-368` where upsert errors *are* checked.
- **Impact:** Any failure of the restaurant update (missing column, RLS, oversized value) is
  reported to the user as a successful save while name/slug/tagline/theme/logo/cover are all
  discarded. The owner sees "Saved" and the guest menu keeps the old branding.
- **Fix:** destructure `{ error }` and return `500 UPDATE_RESTAURANT` when set, matching the
  neighbouring upsert paths.

### DB-04 · High · `restaurants.slug` · VERIFIED
- **Evidence:** `src/app/api/menu/route.ts:221-232` performs an in-app slug-clash check with the
  comment "in-app uniqueness; DB lacks a constraint"; the race between the check at `:223` and
  the insert at `:191-207` is unguarded. The guest page resolves a restaurant with
  `.eq("slug", slug).single()` (`src/app/menu/[slug]/[token]/page.tsx:20-26`), and `validateSyncPayload`
  even accepts an **empty** slug (`SLUG_RE = /^[a-z0-9-]{0,63}$/`, `src/lib/menu-sync-guard.ts:80,167`).
- **Impact:** Two owners (or one owner with two restaurants) can persist the same slug; from then
  on `.single()` returns a `PGRST116` error for every guest scan of that slug, `data` is `null`
  and the public menu 404s permanently (`page.tsx:26`). An empty slug makes
  `/menu/`+`/token` collide for every such restaurant.
- **Fix:** add `UNIQUE (slug)` (or a partial unique index `WHERE slug <> ''`) in the base schema
  and map `23505` to the existing `SLUG_TAKEN` 409 at `menu/route.ts:208-210`; keep the pre-check
  only for a friendly message.

### DB-05 · High · PostgREST embeds / FKs · VERIFIED
- **Evidence:** three queries rely on FK-backed embedding: `orders` +
  `order_items(*)` + `table: restaurant_tables(table_number)`
  (`src/app/api/orders/route.ts:58-63`), and
  `worker_invites … restaurant: restaurants(name, primary_color)`
  (`src/app/api/auth/worker/invite/[token]/route.ts:22-27`). Neither `1002` nor the README
  declares `order_items.order_id → orders.id`, `orders.table_id → restaurant_tables.id`, or
  `worker_invites.restaurant_id → restaurants.id` as app requirements. Both call sites ignore the
  error (`orders/route.ts:58` destructures only `data`; `invite/[token]/route.ts:22` likewise).
- **Impact:** without the FKs PostgREST returns `PGRST200`, `data` is `null`, and the dashboard
  shows **zero orders while orders exist in the table**, and every valid worker invite link 404s.
  Silent, total feature failure.
- **Fix:** declare the three FKs in the base schema; additionally check `error` in
  `orders/route.ts:58` so a schema regression surfaces as 500 rather than as an empty list.

### DB-06 · High · `1002` §7 RLS · VERIFIED (code) / INFERENCE (live exposure)
- **Evidence:** the safeguard block drops only the literal policy name `public_read_all`, and only
  on six tables (`1002:279-284`) — `workers` and `worker_invites` are omitted, and **no**
  legacy policy with a different name is removed. The file itself asserts "the migration must
  never leave `using (true)` policies behind". Nothing verifies that afterwards; there is no
  `pg_policies` assertion, and the base schema (which created those policies) is lost.
- **Impact:** if the pre-existing schema had a permissive read policy on `workers` or
  `worker_invites` — e.g. `FOR SELECT USING (true)` — it survives, and the public anon key can
  then read `workers.session_token` (a 7-day bearer credential, `worker-auth.ts:20`) and
  `worker_invites.invite_token` (a reusable invite, `accept/route.ts:57-69`). That is full worker
  impersonation with only a public key. `[INFERENCE]` on whether such a policy exists — it cannot
  be observed without the DB, which is exactly why the migration must not depend on the name.
- **Fix:** replace the name denylist with a dynamic sweep executed *after* the owner policies are
  created, e.g. drop every policy on the eight tables whose `qual` is `true`/`USING (true)`
  (query `pg_policies` and `EXECUTE format('DROP POLICY %I ON public.%I', policyname, tablename)`),
  or at minimum extend the explicit drops to `workers` and `worker_invites`.

### DB-07 · Medium · `1002:77-90` dedupe renumbering · VERIFIED
- **Evidence:** `1002:77-90` unconditionally rewrites `daily_order_number = 1000 + row_number()`
  for every row whose value differs from that formula, and the file header (`1002:4`) claims it is
  "idempotent and safe to re-run". The RPC counter advances on every attempt even when the order
  insert later fails (`1002:39-43` returns the incremented value; `orders/route.ts:261-278`
  discards it on error), and the unique-violation retry path burns numbers too
  (`orders/route.ts:368-408`). Deleted orders also collapse the ranking.
- **Impact:** a re-run silently renumbers tickets that were already printed/served — two different
  orders end up sharing/shifting the numbers a kitchen already saw. The "safe to re-run" promise
  is false for any live day with gaps.
- **Fix:** make the renumbering conditional on an actual duplicate, i.e. only rewrite rows whose
  `daily_order_number` collides within `(restaurant_id, order_day)` (use `count(*) over` and touch
  only `cnt > 1` groups), or gate the whole block behind an explicit
  `IF to_regclass('public.orders_daily_number_unique') IS NULL`.

### DB-08 · Medium · `1002` day boundary · VERIFIED (code) / INFERENCE (impact on non-UTC servers)
- **Evidence:** the counter row is keyed on `CURRENT_DATE` (`1002:29-40`), i.e. the **server's
  TimeZone**, while the unique key is `order_day` derived from
  `(created_at AT TIME ZONE 'UTC')::date` (`1002:68,96-97`). On Supabase-hosted Postgres (UTC)
  the two agree; on any stack whose server timezone is not UTC they diverge at the day boundary.
- **Impact:** after local midnight while the UTC day is still the same, the counter restarts at
  `1001` while the index still holds yesterday's-UTC-day numbers `1001..` — the insert is rejected
  `23505` and `orders/route.ts:261-415` retries 8 times (each retry incrementing the counter,
  still colliding) then returns `500 CREATE_ORDER`. No orders can be placed for that window.
- **Fix:** use one definition of "day" for both — derive both from UTC
  (`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date` in the RPC/table default), or make the index key
  the same local day the counter uses.

### DB-09 · Medium · `1002:81` vs `1002:96-97` · VERIFIED (code) / INFERENCE (timezone-dependent)
- **Evidence:** the renumber partitions by `created_at::date` (`1002:81`, session-timezone
  dependent, `STABLE`), while the unique index and the `order_day` backfill use UTC
  (`1002:93,96-97`). The comment at `1002:55-58` shows the author was aware of the
  cast-TZ problem for the *index* but left the *renumber* partition in session-local time.
- **Impact:** with a session TimeZone ≠ UTC, two rows in different local-day partitions can be
  assigned the same `1000+rn` while sharing the same UTC `order_day`; `CREATE UNIQUE INDEX` then
  fails with `23505` and, because the script runs as one implicit transaction
  (`[INFERENCE]`), the whole migration rolls back — including the `order_day` column and trigger
  it just added.
- **Fix:** partition the renumber by the same key the index uses:
  `PARTITION BY restaurant_id, (created_at AT TIME ZONE 'UTC')::date`.

### DB-10 · Medium · `1002:148-153` · VERIFIED
- **Evidence:** `ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS session_token text UNIQUE`
  (`1002:148-149`). PostgreSQL skips the **entire** clause — including the `UNIQUE` constraint —
  when the column already exists, so a column created by an earlier partial run (or by the legacy
  schema) never gains its constraint, and re-running cannot repair it. Line `152` then creates a
  second, redundant index on the same column.
- **Impact:** uniqueness of a bearer credential silently depends on the order in which the schema
  was built; two workers could share a token and `lookupWorkerByToken`'s `maybeSingle()`
  (`src/lib/worker-auth.ts:65-71`) would then return `null` for both — a confusing logout loop.
  The duplicate index is pure write amplification on every worker insert/update.
- **Fix:** split it — `ADD COLUMN IF NOT EXISTS session_token text;` then
  `CREATE UNIQUE INDEX IF NOT EXISTS workers_session_token_key ON public.workers (session_token);`
  and drop the redundant `workers_session_token_idx` at `1002:152`.

### DB-11 · Medium · uniqueness contract · VERIFIED
- **Evidence:** four lookups depend on DB-level uniqueness but `1002` creates none of them, and the
  base schema is lost:
  `restaurants.slug` — `.single()` (`src/app/menu/[slug]/[token]/page.tsx:24`);
  `restaurant_tables.qr_token` — `.maybeSingle()` (`src/app/api/orders/route.ts:228-233`) and
  `.single()` (`page.tsx:41-46`);
  `restaurant_tables.table_number` (per restaurant) — `.single()`
  (`src/app/api/orders/route.ts:234-240`);
  `worker_invites.invite_token` — `.maybeSingle()` (`src/app/api/auth/worker/accept/route.ts:57-61`).
  `1002:151` creates a **non-unique** index on `invite_token`, which reads like enforcement but is
  not.
- **Impact:** a duplicate makes the corresponding lookup return a PostgREST error with no message
  the user can act on: the guest menu 404s (`page.tsx:26`), guest ordering returns 404
  `BAD_TABLE`, invite acceptance returns 404 `NOT_FOUND`. Nothing in the UI can repair the state.
- **Fix:** declare in the base schema: `UNIQUE (slug)` on `restaurants`,
  `UNIQUE (restaurant_id, qr_token)` and `UNIQUE (restaurant_id, table_number)` on
  `restaurant_tables`, and `UNIQUE (invite_token)` on `worker_invites`.

### DB-12 · Medium · `1002:158-171` CHECK constraints · VERIFIED
- **Evidence:** each CHECK is added with a plain `ALTER TABLE … ADD CONSTRAINT` after a
  `DROP CONSTRAINT IF EXISTS` (`1002:158-171`). No `NOT VALID`, no pre-flight cleanup, and the
  bounds are far narrower than anything the schema previously enforced (`products.price <= 999999`,
  `orders.total <= 10000000`, `order_items.quantity 1..500`).
- **Impact:** on any pre-existing project with one out-of-range row — a negative price from an OCR
  import, a legacy `quantity = 0` line — the `ADD CONSTRAINT` raises `23514` and aborts the whole
  migration, so the counter/RPC/session columns never land either. The failure is all-or-nothing
  and reported as a raw SQL error.
- **Fix:** add the constraints `NOT VALID` and validate them in a separate, optional step, or
  normalise offending rows first (`UPDATE … SET price = 0 WHERE price < 0` etc.) inside the
  migration's own transaction.

### DB-13 · Medium · required defaults · VERIFIED
- **Evidence:** the app inserts rows without supplying a primary key: `restaurants`
  (`src/app/api/menu/route.ts:191-207`), `orders` (`src/app/api/orders/route.ts:264-278`),
  `order_items` (`:281-289`), `worker_invites` (`src/app/api/auth/worker/invite/route.ts:53-59`).
  `1002:313` adds `DEFAULT gen_random_uuid()` for `workers.id` only; no other PK default is
  created anywhere in the repo.
- **Impact:** on a base schema whose PKs lack defaults, every restaurant/order/line/invite insert
  fails `23502 not_null_violation` — the whole product, not one screen.
- **Fix:** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` on all eight tables (PG13+ core;
  `pgcrypto` needed only on PG < 13).

### DB-14 · Medium · `products.price` / `orders.total` column types · INFERENCE
- **Evidence:** `lineTotal` rounds to 2 decimals and `MAX_ITEM_PRICE = 999_999.99`
  (`src/lib/order-utils.ts:13-17,161-163`); `validateSyncPayload` accepts any finite price in
  `[0, 999_999]` including fractions (`src/lib/menu-sync-guard.ts:139-145`); the app writes those
  values directly (`menu/route.ts:321`, `orders/route.ts:268,286`). No `CREATE TABLE` in the repo
  fixes the type.
- **Impact:** if `price`/`total` are declared `integer` or `real`, PostgreSQL silently rounds
  fractional prices on assignment — a 2.50 TND item becomes 3.00, and the ticket total no longer
  matches the sum of the lines the guest was shown. `[INFERENCE]` on the current legacy type
  (not observable from the repo).
- **Fix:** declare `numeric(10,2)` for `products.price` / `order_items.price_snapshot` and
  `numeric(12,2)` for `orders.total` in the base schema.

### DB-15 · Medium · Supabase coupling · VERIFIED
- **Evidence:** `1002` references `auth.uid()` (`1002:201`), embeds RLS by role
  `TO authenticated` (`1002:214,228,236,260,269`), `GRANT … TO service_role / authenticated`
  (`1002:47,205-206`), and writes `storage.buckets` / `storage.objects`
  (`1002:291-299`). None of the three schemas (`auth`, `storage`) or the three roles exist on a
  vanilla PostgreSQL server.
- **Impact:** the migration is Supabase-only; a developer who follows the README onto RDS/Neon/
  docker-postgres gets `42883` at `1002:194-203` and `42P01` at `1002:291`.
- **Fix:** state the Supabase requirement explicitly in `README.md:72-88` (the file currently only
  says "run this in the Supabase SQL editor", `README.md:77`), and keep every RLS/storage
  statement in a clearly separated, skippable section. Genuine cross-DB support is out of scope —
  the app calls `supabaseAdmin.storage` and GoTrue directly (`src/app/api/upload/route.ts:20-101`,
  `src/app/api/auth/*`).

### DB-16 · Medium · `PUT /api/menu` deletes · VERIFIED
- **Evidence:** the three deletion branches discard the result:
  `categories` (`src/app/api/menu/route.ts:294-298`), orphan products (`:305-308`), `products`
  (`:346-350`), `restaurant_tables` (`:379-384`). No `error` is read, and the request still
  returns `{cloud:true}` (`:387-390`).
- **Impact:** when a delete is rejected by a FK from `orders.table_id` (or any other constraint),
  the row survives while the client's payload says it is gone; the next `GET /api/menu` re-adds it
  (`:67-84`) and the owner sees a table/product they deliberately deleted reappear, with no error
  shown. Silent partial-sync.
- **Fix:** check each delete's `error` and return `500 RECONCILE_*` (or drop the FK to
  `ON DELETE CASCADE` deliberately, which is a product decision — cascading would delete order
  history).

### DB-17 · Medium · legacy triggers · INFERENCE (repo) + prior art (live)
- **Evidence:** `1002:72-75` installs `sufra_orders_set_day` without auditing existing triggers on
  the same table. Prior art (`SECURITY-REPORT-ROUND-2.md:30-31,48-52`, `FINAL-AGENT2-AUDIT.md:57-62`)
  recorded two live triggers on the original project that (a) overwrote `orders.daily_order_number`
  with a racy 1-based max+1 and (b) rewrote `order_items.price_snapshot` and NULLed custom lines.
  Neither is dropped anywhere in the repo.
- **Impact:** on that project — and on any project inheriting the same ad-hoc schema — running
  `1002` does not deliver what the file claims (§1 "atomic daily order numbers"): the rogue trigger
  still stomps the number, and every worker manual order still fails `500 CREATE_ITEMS`
  (`src/app/api/orders/route.ts:289-296`). The migration presents itself as production readiness
  while `FINAL-AGENT2-AUDIT.md:23-24` still classifies the project NOT READY for exactly these two
  triggers.
- **Fix:** add a trigger-audit step to `1002` (drop any non-`sufra_orders_set_day` trigger on
  `orders`; drop any non-internal trigger on `order_items`) and a post-condition asserting
  `pg_trigger` contains only the expected entries.

### DB-18 · Medium · `products.sort_order` · VERIFIED
- **Evidence:** `1002:123-140` adds `products.sort_order`, backfills it with a window function and
  creates `products_menu_order`. Nothing in `src/` reads or writes it: the only `sort_order`
  references are for **categories** (`src/app/api/menu/route.ts:73,111,270`;
  `src/app/menu/[slug]/[token]/page.tsx:34,54`), and product order comes from
  `.order("created_at")` (`menu/route.ts:78`, `page.tsx:40`). `README.md:83` advertises
  "`products.sort_order` — stable menu ordering" and `menuPayloadFromState` has no position field
  for products (`src/lib/menu-mapping.ts:114-122`).
- **Impact:** the documented capability does not exist. An owner cannot control product order
  beyond creation order, and the migration+index cost is paid for nothing. Worse for a re-importer:
  the backfill rewrites `sort_order` on every run (`1002:127-137`) — harmless only because nothing
  reads it.
- **Fix:** either wire it (send a product position from the menu payload and order the guest query
  by `sort_order, created_at`), or drop it from `1002` and from `README.md:83`. Do not ship a column
  that only one of the schema and the code knows about.

### DB-19 · Low · `orders.order_day` nullability · VERIFIED
- **Evidence:** `1002:61` adds `order_day date` (nullable) and `1002:96-97` indexes it without a
  predicate. The trigger `1002:63-75` only fires on INSERT/UPDATE; any path that bypasses triggers
  (`ALTER TABLE … DISABLE TRIGGER`, `COPY`, a restored dump) leaves `order_day` NULL.
- **Impact:** in a plain unique index NULLs are distinct, so the "unique backstop for daily ticket
  numbers" (`README.md:81`) silently does not constrain rows with a NULL `order_day` — duplicates
  can coexist indefinitely.
- **Fix:** add `NOT NULL` to `order_day` (possible with the backfill at `1002:92-94` already
  present) or add `WHERE order_day IS NOT NULL` plus a `CHECK (order_day IS NOT NULL)` when the
  base schema supplies `created_at` for all rows.

### DB-20 · Low · worker role vocabulary · VERIFIED
- **Evidence:** `1002:311-312,315-316` legitimise four spellings
  (`'Cashier','Manager','cashier','manager'`), but the permission matrix only understands the
  capitalised pair plus `'Owner'` (`src/lib/worker-permissions.ts:8-13`), and
  `src/app/api/orders/[id]/route.ts:75` coerces an unrecognised role to `"Cashier"`.
- **Impact:** a row with `role='manager'` (accepted by the DB) is silently downgraded to Cashier at
  order-PATCH time, so a manager gets `403 FORBIDDEN` when marking an order paid and has no way to
  understand why. Nothing in the app ever writes lowercase, so this is a latent trap created by the
  migration's widening.
- **Fix:** keep the CHECK to the canonical `('Cashier','Manager')` (the widening was only needed to
  stop rejecting the app's values — see prior art F1), or normalise with
  `lower(role)` in `normalizeStaffRole`.

### DB-21 · Low · configuration surface · VERIFIED
- **Evidence:** `src/app/api/auth/signup/route.ts:21` reads `SUFRA_PLACEHOLDER_OWNER_EMAIL`, which is
  absent from `.env.example` (which documents only the Supabase, Mistral, rate-limit and
  auth-bypass variables, `.env.example:1-44`); the route silently falls back to the hardcoded
  legacy address `owner@sufra.app` (`:48`). Separately, `.env.example:4` and `docker-compose.yml:5`
  instruct the developer to run `supabase start`, but `supabase/config.toml` is absent from the
  repo.
- **Impact:** the documented local-setup path fails at the first step (no config → no stack), and
  the first-run ownership transfer depends on an undocumented variable whose default is a stale
  address from the original developer's project.
- **Fix:** add `SUFRA_PLACEHOLDER_OWNER_EMAIL=` to `.env.example` with a comment, and either commit
  `supabase/config.toml` (the CLI's own file, safe to commit) or change `README.md:1-38` /
  `docker-compose.yml:5` to say `supabase init` && `supabase start`.

### DB-22 · Low · `allocateOrderNumber` fallback · VERIFIED
- **Evidence:** when the RPC is unavailable, the fallback computes the next number from a window
  that starts at **local** midnight (`dayStartIso()` uses `getFullYear/getMonth/getDate`, i.e. the
  Node process timezone — `src/app/api/orders/route.ts:89-92`) filtered on `created_at`
  (`:112`), then `+1` (`:116`). The uniqueness key it must not collide with is `order_day`, a
  **UTC** date (`1002:68,96-97`).
- **Impact:** while the two windows disagree (the local/UTC day boundary) the fallback can compute a
  number that already exists in the UTC-day group; the insert is rejected `23505` and the loop at
  `:261-415` re-derives the same value up to 8 times before returning `500 CREATE_ORDER`. Only
  reachable pre-migration or if the RPC is dropped, hence Low.
- **Fix:** filter the fallback on `order_day = <utc today>` (now that `1002` provides it) instead of
  a local-midnight `created_at` window.

### DB-23 · Low · dead columns · VERIFIED
- **Evidence:** `restaurants.currency` is written `'TND'` on restaurant creation
  (`src/app/api/menu/route.ts:198`) and read nowhere; `products.image_source` is written `"pending"`
  on every menu save (`:323`) and read nowhere; `restaurants.is_published` is written from the
  payload (`:186,204`, always `true` — `src/lib/menu-mapping.ts:107`) and the guest page never
  filters on it (`src/app/menu/[slug]/[token]/page.tsx:20-26` — a restaurant with
  `is_published = false` still serves its full menu publicly).
- **Impact:** three columns are required by the schema but carry no behaviour: publication is not a
  real control (an unpublished menu is still public and unauthenticated), and `currency` can never
  be changed from TND even though TND is hardcoded in one insert path only.
- **Fix:** either enforce `is_published` in the guest page and the QR path, or remove the flag and
  the field from the payload contract; drop `image_source` or populate it meaningfully
  (`'upload'` vs `'scan'`).

### DB-24 · Low · storage bucket creation · VERIFIED
- **Evidence:** `1002:291-293` inserts the bucket row directly (`id`, `name`, `public`) with no
  `file_size_limit` / `allowed_mime_types`, while the app enforces 5 MB and a 3-type allowlist in
  its own handler (`src/app/api/upload/route.ts:9-15,83-85`) and also self-heals the bucket through
  the Storage API with `{public:true}` only (`:26`).
- **Impact:** the bucket accepts any size and any content type for anything holding a service key
  or an authenticated Storage session; the only guard is the TypeScript handler. The 5 MB contract
  is a property of the route, not of the database.
- **Fix:** set the limits where the bucket is defined — either in `1002`'s INSERT
  (`file_size_limit`, `allowed_mime_types`) or in the `createBucket` call at
  `src/app/api/upload/route.ts:26`.

## Verified-working

- `src/lib/supabase-admin.ts:7-18` — single server-only client, `persistSession:false`,
  `autoRefreshToken:false`, and `hasBackend()` gating; no client component imports it (grep over
  `src/` shows only server routes/libs).
- Order pricing is server-side and restaurant-scoped: `products` are fetched with
  `.eq("restaurant_id", …)` (`src/app/api/orders/route.ts:138-145`), custom lines require a worker
  session (`src/lib/order-utils.ts:132-142`), and the total is recomputed
  (`order-utils.ts:166-181`).
- Idempotency design is correct at the DB level: partial unique index on
  `(restaurant_id, client_ref)` (`1002:109-111`) plus a targeted `23505`-on-`client_ref` recovery
  branch (`src/app/api/orders/route.ts:368-405`).
- Invite redemption is race-safe by construction: conditional claim
  `.eq("is_used", false)` + orphan cleanup (`src/app/api/auth/worker/accept/route.ts:103-114`), and
  the worker row is inserted **before** the claim so a failure cannot burn the invite.
- Worker attribution can only come from a DB-verified session
  (`src/app/api/orders/[id]/route.ts:97-112`) and the pre-migration `42703` fallback is narrowed to
  the missing-column case (`:14-19,120-132`).
- Ownership scoping is correct on every owner path (`restaurants.owner_id` filters at
  `menu/route.ts:57,168`, `orders/route.ts:47`, `orders/[id]/route.ts:60-65`,
  `workers/route.ts:21`, `workers/[id]/route.ts:29-45`, `upload/route.ts:60`), and menu PUT
  re-checks foreign-row ownership before writing (`menu/route.ts:234-262`).
- `1002`'s atomic counter design is sound: a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`
  with a PK on `(restaurant_id, day)` (`1002:27-44`) is race-free under concurrency.
- `1002:60-61` correctly avoids the non-IMMUTABLE index expression (`created_at::date`) that the
  comment at `1002:55-58` explains — the `order_day` column + trigger is the right shape.
- The bucket name is consistent everywhere (`menu-images`: `1002:292`, `src/app/api/upload/route.ts:8`).
- `supabase/migrations/` is the only SQL in the repo and all migrations are named with a numeric
  prefix, so a `0001_*` base migration will sort before `1002_*`.
- No code reads or writes Supabase tables from a client component; no `.env` value is referenced in
  any tracked file (`.env.example` holds placeholders only).

## Open questions

1. Does the original project still hold a `pg_policies` / `pg_get_triggerdef` listing? Prior art
   never obtained one (`SECURITY-REPORT-ROUND-2.md:121`), so DB-06 and DB-17 stay unverifiable from
   here. If it exists, it should be pasted into the base-schema slice as evidence.
2. What are the legacy column types for `products.price`, `orders.total`, `order_items.quantity`
   (DB-14) and the legacy defaults on every PK (DB-13)? Without a dump these remain `[INFERENCE]`;
   the migration must work either way.
3. `README.md:90` calls its table list "columns the app actually uses" — should it be treated as a
   contract or replaced by generated documentation? DB-02/DB-18 show it disagrees with both the code
   and the migration.
4. Cross-slice: `docker-compose.yml:45` health-checks `/api/health`, which does not exist in
   `src/app/api/` (19 routes listed; no `health`). Infra slice's call, noted here only so it is not
   lost.
5. Cross-slice: `validateSyncPayload` accepts non-UUID ids (`src/lib/menu-sync-guard.ts:119-124`)
   and an empty slug (`:80,167`) before they reach `uuid`/`text` columns; the 22P02/duplicate
   handling belongs to the API-routes slice, but the base schema must keep `id` columns `uuid` for
   DB-11's uniqueness rules to mean anything.
