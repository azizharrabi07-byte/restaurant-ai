# Sufra — Operator Runbook

**Who this is for:** someone who has never seen this repository and needs to get it
running and prove it works. No prior Supabase, Docker or Next.js experience assumed.
Every command here is copy-pasteable, and every step says what you should see.

**What the app is:** a QR-menu and table-ordering platform. An owner builds a menu on
the owner dashboard, prints one QR code per table, and guests scan to browse and order.
Orders land on the dashboard within 3 seconds.

```text
Owner browser  ──► /dashboard/*        ┐
Worker phone   ──► /worker/*           ├──► Next.js API routes ──► Supabase (Postgres + Auth + Storage)
Guest phone    ──► /menu/<slug>/<token>┘         (one client: supabaseAdmin, service role)
```

There is exactly **one** database client: `supabaseAdmin`, built with the service-role key
(`src/lib/supabase-admin.ts:7-15`). The browser never talks to Supabase directly — there is
no anon client and no browser-side DB access. Row Level Security exists only as
defense-in-depth (`supabase/migrations/1002_production_readiness.sql`, §7).

---

## Read this first: three facts that surprise everyone

1. **The build needs no environment variables.** `npm run build` and `docker build` both
   succeed with zero config. A missing Supabase URL is not a build error — it silently
   makes every data path return empty. Details in [§3.1](#31-what-degraded-mode-looks-like).
2. **The app will happily run in a degraded, local-only mode.** Without the Supabase pair
   the UI still renders, the onboarding wizard still works, and everything saves to
   `localStorage` instead of the database. It *looks* fine. If your dashboard shows zero
   orders, check [§10](#10-troubleshooting) row 5 before you debug anything else.
3. **Which SQL files you run depends on which database you are pointing at.** There are
   three starting states and they are not interchangeable — see [§4](#4-set-up-the-database).

---

## 1. Prerequisites

| Tool | Needed for | Minimum | Check with |
| --- | --- | --- | --- |
| Node.js | everything | **20 or newer** (CI and the Docker image pin 20; development used 24.18 locally) | `node --version` |
| npm | everything | 10 or newer (11.16 was used locally) | `npm --version` |
| git | getting the code | any recent | `git --version` |
| Docker + Compose | only the container path in [§5.2](#52-docker) | Compose ≥ 2.24 (the compose file uses long-form `env_file` with `required:`) | `docker --version` / `docker compose version` |
| Supabase CLI | only the local-database path in [§4C](#4c-local-database-supabase-start) and `npm run db:push` | 2.x | `supabase --version` |

Run them all at once:

```bash
node --version
npm --version
git --version
docker --version          # optional
docker compose version    # optional
supabase --version        # optional
```

Expected:

```text
v20.x.x        (or newer — v24.18.0 is what the app was developed on)
10.x.x         (or 11.x.x)
git version 2.x
Docker version 2x.x.x
Docker Compose version v2.x.x
2.x.x          (Supabase CLI)
```

Notes and traps:

- **Node 20 is the reference runtime.** CI runs `node-version: 20`
  (`.github/workflows/ci.yml:16`) and the image is built `FROM node:20-alpine`
  (`Dockerfile:3`). `package.json` declares no `engines` field, so an older Node will not
  stop you — it will just fail somewhere unpredictable. Stay on 20+.
- Node 22 has a built-in `fetch`, which the healthchecks rely on
  (`docker-compose.yml:48` and `Dockerfile:50-51`). Node 20 also has it.
- If `docker` is not installed, skip [§5.2](#52-docker) entirely. Nothing else needs it.

---

## 2. Get the code and install

```bash
git clone <repository-url> sufra
cd sufra
npm ci
```

Expected — a few hundred packages, no errors, roughly like:

```text
added 493 packages, and audited 494 packages in 30s
found 0 vulnerabilities
```

**Use `npm ci`, not `npm install`.** The committed lockfile is in sync and is the
reproducible path that CI (`.github/workflows/ci.yml:19`) and the Docker image
(`Dockerfile:11`) both use. `npm install` can rewrite `package-lock.json` and drift you away
from what ships.

There is **no `.env.local` in the repository** — it is gitignored (`.gitignore:27`) and you
must create it in the next step. If you skip that, the app runs in the degraded mode
described below.

---

## 3. Configuration: create `.env.local`

```bash
cp .env.example .env.local
```

Windows PowerShell / cmd:

```powershell
Copy-Item .env.example .env.local
```

Now open `.env.local` in an editor and fill in the values from the table below.

### 3.0 Every variable

| Variable | Required? | Where to get it | What breaks without it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes, for any real use** | Hosted: Supabase dashboard → **Project Settings → API → Project URL**, e.g. `https://abcdefgh.supabase.co`. Local: `supabase start` prints `API URL: http://127.0.0.1:54321`. | `supabaseAdmin` is `null` (`src/lib/supabase-admin.ts:7-15`), `hasBackend()` is false, and the app runs in degraded mode ([§3.1](#31-what-degraded-mode-looks-like)). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes, for any real use** | Same page → **service_role** secret (hosted), or the `service_role key` printed by `supabase start`. | Same as above. **Server-only** — never paste it into anything the browser can read, never commit it. |
| `MISTRAL_API_KEY` | Only for the AI menu scan | https://console.mistral.ai → API keys. | `POST /api/menu/scan` fails fast with `503 {"ok":false,"error":"NO_KEY"}` before reading any file (`src/app/api/menu/scan/route.ts:78-81`). Everything else works. |
| `MISTRAL_OCR_MODEL` | No | Leave as shipped. | Defaults to `mistral-ocr-latest` (`src/lib/menu-scan.ts:100`). |
| `NEXT_PUBLIC_APP_URL` | No — **leave it commented out** (it is commented out in `.env.example`) | Only set it when the printed/accepted links must use a canonical domain that is **not** the origin the user actually reached (e.g. a reverse proxy that rewrites `Host` internally). | When unset, QR codes, worker invites and password-recovery links all derive from the origin the request came through (`appBaseUrl()` — `src/lib/utils.ts:45-62`). **Trap:** a hard-coded `http://localhost:3000` is worse than no value — it pins every printed QR code to localhost even when you are serving through ngrok, so a phone cannot open it. See [§8](#8-expose-it-to-a-phone-tunnel). |
| `SUFRA_RATE_LIMIT_DISABLED` | No — dev/tests only | Set to `1` (or `true`) to disable the in-memory rate limiter. | Rate limits stay on: 10 logins / 10 min, 60 orders / min, 10 scans / min. The env read is `src/lib/rate-limit.ts:63`; the per-route limits are declared at each call site (e.g. `src/app/api/menu/scan/route.ts:69`). |
| `SUFRA_AUTH_DISABLED` | No — **dev escape hatch, see the warning below** | Set to `1`. | Login walls stay up (the normal, safe state). |
| `SUFRA_PLACEHOLDER_OWNER_EMAIL` | No | Only relevant for first-run ownership transfer. | Signup matches the placeholder owner by this value, and also accepts the legacy default `owner@sufra.app` (`src/app/api/auth/signup/route.ts:21-23,56-59`). |
| `NODE_ENV` | **Never set this in `.env.local`** | Managed by Next.js — `next dev` sets `development`, `next build` / `next start` set `production`. | A value here overrides Next's own. It controls two security-relevant behaviours: it hard-disables `SUFRA_AUTH_DISABLED` (`src/lib/owner-auth.ts:30`) and switches the session cookies to `secure` (`src/lib/owner-auth.ts:218,240`). Setting it to `production` locally makes the cookies `secure`, and a plain-`http://localhost` browser then drops them — you appear to be logged out on every request. (`.env.example:39-45` carries the same warning.) |

> ### ⚠️ `SUFRA_AUTH_DISABLED=1` — read before using
>
> It opens **every** login wall: the owner dashboard, the worker terminal, and all
> protected APIs, for anyone who can reach the server. It is respected **only** on a
> non-production build (`process.env.NODE_ENV !== "production"` —
> `src/lib/owner-auth.ts:28-38`), so a production container ignores it even if the
> variable leaks into the environment.
>
> **Never set it anywhere that is reachable from the internet** — not on a deployed
> server, not on a machine you have tunnelled with ngrok ([§8](#8-expose-it-to-a-phone-tunnel)),
> not in a shared `.env.local`. Use it only on `localhost` on your own machine, and unset it
> (or delete the line) when you are done. The server prints a warning on first use:
> `[sufra] SUFRA_AUTH_DISABLED=1 — all login walls are OPEN. Dev only; restore auth by
> unsetting the variable.`

A minimal working file looks like this — the rest can stay commented out:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your-service-role-key...
MISTRAL_API_KEY=your-mistral-key
MISTRAL_OCR_MODEL=mistral-ocr-latest
# NEXT_PUBLIC_APP_URL=
```

### 3.1 What "degraded mode" looks like

`supabaseAdmin` is `null` when *either* Supabase variable is empty
(`src/lib/supabase-admin.ts:7-15`), and `hasBackend()` is simply `Boolean(supabaseAdmin)`
(`:17-19`). Nothing throws. Instead:

| Where | What you see with no Supabase config |
| --- | --- |
| `GET /api/health` | `200 {"ok":true,"backend":false,"ocr":<bool>,"version":"0.1.0"}` — this probe never touches the DB by design (`src/app/api/health/route.ts:14-29`). |
| 16 protected API routes | `503 {"cloud":false,"error":"NO_BACKEND"}` (e.g. `src/app/api/auth/login/route.ts:13-15`, `src/app/api/workers/route.ts:10-12`, `src/app/api/upload/route.ts:38-40`). |
| `GET /api/menu` | `200` with an **empty** menu payload (`src/app/api/menu/route.ts:46`). |
| `PUT /api/menu` | `200 {"cloud":false,"error":"NO_OWNER"}` and the store falls back to `localStorage` (`src/app/api/menu/route.ts:135-138`). |
| `GET /api/orders` | `200 {"cloud":false,"orders":[]}` (`src/app/api/orders/route.ts:34-36`). |
| `POST /api/orders` | `503 {"cloud":false,"error":"NO_OWNER","message":"Ordering isn't live yet on this device."}` (`src/app/api/orders/route.ts:187-192`). |
| `/dashboard/*` | Redirects to `/auth/login` — the guard resolves no session (`src/app/(owner)/dashboard/layout.tsx`). |
| `/menu/<slug>/<token>` | `200`, rendering the "This menu isn't live yet" placeholder rather than a 404 (`src/app/menu/[slug]/[token]/page.tsx:16-18`; copy is the `g_notliveTitle` / `g_notliveDesc` keys in `src/lib/i18n.tsx`). |
| Onboarding wizard | Works and autosaves — but only to `localStorage`. The save badge reads **"Saved locally"** (`save_local`) / **"Sign in to save your menu"** (`save_signIn`) instead of **"All changes saved"** (`save_saved`). |

Consequence worth internalising: **an unconfigured app looks like a working app with no
data.** If the guest menu says "The owner hasn't published their menu yet", check
`/api/health` → `"backend"` before you look at the database.

---

## 4. Set up the database

### 4.0 The four SQL files, and which ones you run

All migrations live in `supabase/migrations/` and are **plain SQL**. You run them either in
the Supabase SQL editor (hosted) or with the Supabase CLI (local / `npm run db:push`). Each
file is guarded and idempotent — re-running is safe.

| File | What it is | Covers |
| --- | --- | --- |
| `0001_init_schema.sql` | **The base schema.** Creates all nine relations (the eight application tables plus `sufra_daily_counters`), defaults, FKs, uniqueness, CHECKs, the RPC, the trigger and the storage bucket. | **Fresh projects only.** |
| `1002_production_readiness.sql` | Incremental patch: atomic daily order numbers, `order_day` + trigger, `client_ref` idempotency, `products.sort_order`, worker sessions/invites, money CHECKs, RLS lockdown, storage bucket, PK defaults. | Every database, **after** `0001` on a fresh one. |
| `1003_live_db_repair.sql` | Repair for **the original developer's existing database**. Procedurally drops rogue triggers on `orders`/`order_items`, adds the four missing unique constraints, the missing PK defaults, repairs the FKs the embedded selects need, and widens the money columns to millime precision (`numeric(10,3)`/`numeric(12,3)`). | **Existing legacy databases only.** A no-op on a fresh project. |
| `1004_session_hardening.sql` | Adds `workers.session_expires_at`, makes `worker_invites.expires_at` `NOT NULL DEFAULT now() + interval '24 hours'`, re-asserts `products.sort_order`. | Every database, last. |

### 4.1 Pick your track

Answer one question: **does this database already contain the original developer's tables?**

| Starting state | Track | Run, in this order |
| --- | --- | --- |
| A brand-new Supabase project, empty database | **A** | `0001` → `1002` → `1004` |
| The original developer's live database, or any DB that already has `public.restaurants` and the other seven tables | **B** | `0001` (safe — it uses `IF NOT EXISTS`) → `1002` → **`1003`** → `1004` |
| A local Supabase stack for development | **C** | same as **A** (a local stack starts empty) |

Running `0001` on a database that already has the tables is safe: it uses
`CREATE TABLE IF NOT EXISTS`, `DROP … IF EXISTS` before every constraint, and
`CREATE OR REPLACE` for functions (`0001_init_schema.sql:19-21`). Running `1002` *first* on
an empty database is **not** safe — its first statement references `public.restaurants(id)`
and fails with `42P01` (`1002_production_readiness.sql:16-20`).

---

### 4A. Fresh hosted Supabase project

**1. Create the project.** Go to https://supabase.com → **New project**. Pick a name, a
strong database password (save it), and the region closest to you. Wait for provisioning
(~2 minutes).

**2. Copy the credentials** into `.env.local` from **Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` ← *Project URL*
- `SUPABASE_SERVICE_ROLE_KEY` ← *service_role* secret (not the `anon` key)

**3. Run the SQL**, in order. For each file: open **SQL Editor → New query**, paste the
**entire** file, and press **Run**.

```text
1. supabase/migrations/0001_init_schema.sql
2. supabase/migrations/1002_production_readiness.sql
3. supabase/migrations/1004_session_hardening.sql
```

Expected: each query ends with `Success. No rows returned` (the files end with `DO` blocks
that emit `NOTICE` lines — expand the notices panel to read them). Any red error means the
migration stopped there; the whole file is submitted as one implicit transaction, so a
single failure rolls back the rest. See [§10](#10-troubleshooting) rows 3 and 4.

**4. Verify.** Paste this into the SQL editor and run it:

```sql
-- 1. All eight base tables exist. Expect 8 rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('restaurants','categories','products','restaurant_tables',
                     'orders','order_items','workers','worker_invites')
ORDER BY table_name;

-- 2. Exactly ONE application trigger on orders, and NONE on order_items.
--    Expect exactly one row: orders | sufra_orders_set_day
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN ('orders','order_items');

-- 3. The unique constraints the app's .single() lookups depend on. Expect 5 rows:
--    restaurants_slug_key, restaurant_tables_restaurant_id_qr_token_key,
--    restaurant_tables_restaurant_id_table_number_key,
--    worker_invites_invite_token_key, workers_session_token_key
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint
WHERE contype = 'u'
  AND connamespace = 'public'::regnamespace
  AND conname IN ('restaurants_slug_key',
                  'restaurant_tables_restaurant_id_qr_token_key',
                  'restaurant_tables_restaurant_id_table_number_key',
                  'worker_invites_invite_token_key',
                  'workers_session_token_key')
ORDER BY conname;

-- 4. The public menu-image bucket, with the app's own limits applied.
--    Expect: menu-images | true | 5242880 | {image/jpeg,image/png,image/webp}
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'menu-images';

-- 5. No leftover permissive policies. Expect only the *_owner_all policies
--    created by 1002 (a row with USING (true) here would be a security hole).
SELECT tablename, policyname, permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**5. Create the first restaurant row, then claim it with signup.** The app has no
"create restaurant" screen — signup *binds* an existing row to your new account
(`src/app/api/auth/signup/route.ts:63-73,96-122`). On a fresh project there are no rows at all, so
the wizard is what creates one — but doing it in this order avoids ambiguity:

- Easiest path: start the app ([§5](#5-run-the-app)), sign up at `/auth/signup`, then open
  `/onboarding` and complete the wizard. The first autosave creates the restaurant row and
  binds it to your account. This is the path the [§6 checklist](#6-verify-it-works-end-to-end)
  walks.
- Or pre-seed a row in SQL (`INSERT INTO public.restaurants (name, slug) VALUES ('My Café',
  'my-cafe');`) and let signup claim it — that is what the
  `SUFRA_PLACEHOLDER_OWNER_EMAIL` override is for.

**6. Confirm the backend is reachable** once the app is running:

```bash
curl -s http://localhost:3000/api/health
```

Expect `{"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}`. `backend:false` means the
env pair is wrong or the app was not restarted after you edited `.env.local`.

---

### 4B. Existing database with the original developer's legacy objects

Use this track when you are pointing at a database that **already contains**
`public.restaurants` and friends — typically the original developer's live project. It has
hand-made triggers and constraints that this repository was never written against, and they
break the product in ways that look like application bugs.

Run in order, each file in full:

```text
1. supabase/migrations/0001_init_schema.sql             -- safe: IF NOT EXISTS everywhere
2. supabase/migrations/1002_production_readiness.sql    -- incremental patch + repairs
3. supabase/migrations/1003_live_db_repair.sql          -- the legacy-object repair
4. supabase/migrations/1004_session_hardening.sql
```

**Why `1003` matters here and nowhere else.** The live database carries:
- a trigger on `orders` that rewrites `daily_order_number` with a racy 1-based `max+1`
  value, stomping the atomic allocator (`1003_live_db_repair.sql:26-35`);
- a trigger on `order_items` that rewrites `price_snapshot` from `products` and NULLs custom
  lines, which makes **100% of worker manual orders fail** (`1003:36-42`).

The trigger definitions were never obtained from the live console, so `1003` discovers and
drops them procedurally rather than by name (`1003:43-45`). It preserves this repo's own
`sufra_orders_set_day` on `orders` and creates no triggers (`1003:47-55`).

Expected: `1003` prints a series of `NOTICE` / `WARNING` lines. Read all of them. The final
line is:

```text
NOTICE: 1003_live_db_repair.sql complete — review any VERIFY FAIL warnings above.
```

Every check it performs prints either `VERIFY OK  <finding>: …` or
`VERIFY FAIL <finding>: …`. **Any `VERIFY FAIL` is actionable** — the message names the
object (`1003_live_db_repair.sql:365-549`). Typical ones:

| `VERIFY FAIL` mentions | What it means |
| --- | --- |
| `DB-17: … rogue trigger(s) still present: …` | A trigger on `orders`/`order_items` survived. It names them; drop them by hand and re-run. |
| `DB-11: UNIQUE (…) on public.<table> is MISSING` | Pre-existing duplicate rows blocked the constraint. Deduplicate the named table, then re-run. |
| `DB-13: public.<table>.<col> has NO default` | `gen_random_uuid()` could not be applied — usually the table or column does not exist. |
| `DB-05: FK public.<table>.<col> -> public.<ref> is MISSING` | PostgREST embedded selects will fail with `PGRST200`; the dashboard order list is what breaks. |

Then re-run the verification SQL from [§4A step 4](#4a-fresh-hosted-supabase-project) — all
five checks must pass on this database too.

> **Do not skip `1003` on a legacy database.** `0001` and `1002` add what is missing; neither
> removes what is already there (`1003_live_db_repair.sql:10-14`).

> **This exact track has been rehearsed, and the live preconditions were checked.** A fixture
> reproducing this database's shape — PKs with no defaults, the lowercase-only role check, a
> `workers.id` FK to `auth.users`, two rogue triggers whose names appear nowhere in this repo,
> `numeric(x,2)` money, no uniqueness, and the extra live-only columns — was migrated with all
> four files in this order: every file exited 0 with no error, and afterwards only
> `sufra_orders_set_day` remained on `orders`, an inserted `9999` stayed `9999`, a manual
> line's `0.010` price survived, a `Cashier` worker inserted and got a generated id, all four
> UNIQUE constraints existed, the money columns were scale 3, `workers.session_expires_at`
> existed, and the original data was intact. See `docs/LIVE-VERIFICATION.md` §8.
>
> Against the live project itself, the two things that could have blocked this run were
> confirmed absent: the restaurant's `owner_id` **does** exist in `auth.users` (so
> `0001`'s owner FK applies, with no orphan warning) and there are **zero duplicate rows**
> on all four new UNIQUE rules (so none of them can raise).

---

### 4C. Local database (`supabase start`)

This gives you a complete Postgres + Auth + Storage + Studio stack on your machine, with
`EDITOR` access to the data. It is the best option for iterating on the schema.

```bash
cd sufra
supabase start
```

(The repository ships `supabase/config.toml`. If your checkout does not contain it,
`supabase start` fails with `Cannot find project config` — run `supabase init` once to
recreate it, but do not run `supabase init` when the file is already there.)

First run downloads several images and takes a few minutes. Expected output ends with
something like:

```text
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
         DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
     Studio URL: http://127.0.0.1:54323
   Inbucket URL: http://127.0.0.1:54324
```

Copy the printed **API URL** and **service_role key** into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from the supabase start output>
```

Then apply the schema. A local stack starts empty, so this is the **fresh** track:

```bash
# Option 1 — push the migrations with the CLI
npm run db:push

# Option 2 — apply them with psql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/0001_init_schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/1002_production_readiness.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/1004_session_hardening.sql
```

Expected: no errors. `-v ON_ERROR_STOP=1` makes `psql` exit non-zero at the first failure
instead of continuing — always use it when scripting.

Then run the [§4A step 4 verification SQL](#4a-fresh-hosted-supabase-project) against the
local database:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Useful local details:

| Thing | Where |
| --- | --- |
| Studio (browse rows, run SQL) | http://127.0.0.1:54323 |
| Email catcher (password reset, invites) | http://127.0.0.1:54324 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Stop the stack | `supabase stop` (add `--no-backup` to also drop the data) |

---

## 5. Run the app

### 5.1 Dev server

```bash
npm run dev
```

Expected:

```text
   ▲ Next.js 15.x.x (turbo)
   - Local:        http://localhost:3000
   - Environments: .env.local

 ✓ Ready in 1.2s
```

Open http://localhost:3000. You should get the Sufra landing page (dark, English by default,
with EN/FR/AR and $/€ switchers).

Sanity-check the backend before going further:

```bash
curl -s http://localhost:3000/api/health
# {"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}
curl -s http://localhost:3000/api/auth/session
# {"cloud":true,"user":null}   when signed out
```

Restart the server after **any** change to `.env.local` — Next only reads it at boot.

### 5.2 Docker

The compose stack builds and serves the production standalone bundle on port 3000.

```bash
# docker-compose.yml reads .env.local (optional — the stack starts without it)
docker compose up --build
```

Expected tail:

```text
✔ Container restaurant-ai-web  Started
...
web-1  |    ▲ Next.js 15.x.x
web-1  |    - Local:        http://localhost:3000
web-1  |  ✓ Ready
```

Then:

```bash
docker compose ps
# NAME                 STATUS
# restaurant-ai-web    Up ... (healthy)

curl -s http://localhost:3000/api/health
```

Notes:

- `.env.local` is **optional** for compose (`env_file` is declared with `required: false`,
  `docker-compose.yml:38-41`) — the first build works before you have configured anything.
  Runtime configuration comes from that file; the standalone server does not read
  `.env.local` on its own, which is why compose passes it in explicitly.
- The image is built with **no** environment variables, by design (`Dockerfile:20-24`).
  Never "fix" a build failure by injecting placeholder keys.
- The healthcheck is a liveness probe only: `/api/health` takes no env vars and never touches
  the database, so a container with an unreachable database is still *healthy*
  (`docker-compose.yml:46-52`, mirrored by the image's own `HEALTHCHECK` at
  `Dockerfile:50-51`). `backend:false` in that endpoint's body is what tells you the
  config is missing. `Up (unhealthy)` means the Next server itself is not answering — see
  [§10](#10-troubleshooting) row 1.

To exercise the exact production artefact without Docker:

```bash
npm run build
npm run start:standalone   # node .next/standalone/server.js
```

---

## 6. Verify it works end to end

This is the acceptance test. Do it in order, on a configured app (Supabase pair present,
schema applied, signup done). Each step says what should appear, and how to look at the
database if it does not.

**Before you start:** `curl -s http://localhost:3000/api/health` must report `"backend":true`.

### Step 1 — Sign up as the owner

| | |
| --- | --- |
| **Go to** | http://localhost:3000/auth/signup |
| **Do** | Fill **Email**, **Password** (at least 8 characters), optional **Name**. Click **Create account**. |
| **Should appear** | You are redirected to `/dashboard` (or to `?next=…` if you were bounced here from a protected page) — signup signs you in automatically (`src/components/auth-form.tsx:37,64`, session cookie set at `src/app/api/auth/signup/route.ts:139-143`). No email confirmation step. |
| **If it fails** | `409 OWNER_EXISTS` → the database already has a restaurant owned by a real (non-placeholder) user; signup is designed to refuse that (`src/app/api/auth/signup/route.ts:71-73`). `409 EMAIL_TAKEN` → use another email (`:88`). `429 RATE_LIMITED` → signup is throttled to 5 attempts per 10 minutes (`:32-38`); wait it out. `500 SESSION` → the account was created but no session came back (`:130-137`); sign in at `/auth/login` instead of retrying signup. `500 PROVISION_FAILED` → the account was created but the restaurant could not be linked (`:116-121`); sign in and continue. `503 NO_BACKEND` → the Supabase pair is wrong. |

Check the DB (Studio SQL editor, or `psql`):

```sql
-- After signup + a wizard save (step 2), expect one row owned by your new user.
SELECT id, name, slug, owner_id, is_published FROM public.restaurants;
-- And the auth account itself:
SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 1;
```

> **Note:** signup asks for **no restaurant name**, and on its own it lands you on
> `/dashboard` — not in the wizard. The landing page's **Open the Platform** button
> (`src/app/page.tsx:117`) links straight to `/onboarding`, which **requires an owner
> session** and redirects an anonymous visitor to `/auth/signup?next=/onboarding`
> (`src/app/onboarding/page.tsx:13-15`). That `next` parameter brings you back to the wizard
> automatically once the account exists (`src/components/auth-form.tsx:37,64`). So either
> order works, and doing step 1 first is what the redirect chain expects.

### Step 2 — Complete onboarding

| | |
| --- | --- |
| **Go to** | http://localhost:3000/onboarding — from the landing page's **Open the Platform** button (`src/app/page.tsx:117`) or the hero **Start Free Setup** (`:169`). If you are not signed in you are redirected to signup and returned here afterwards (`src/app/onboarding/page.tsx:13-15`). |
| **Do** | Five steps: **Identity** → **Branding** → **Categories** → **Products** → **Live Preview**. Step 1 wants **Establishment Name \*** (this becomes the URL slug). Step 3 needs **Add Category**. **Continue** stays disabled until step 1 has a name and step 3 has at least one category (`src/app/onboarding/wizard.tsx:36-42,97`). |
| **Should appear** | The stepper ticks off each tab. On step 5, **Finish Setup** asks the server to save first and only then shows the toast *"Setup complete!"*; on a failed save it shows the error instead (`src/components/onboarding/step-preview.tsx:84-104`). |
| **Check it saved** | The wizard autosaves — 900 ms after any change it calls `saveNow()`, which sends `PUT /api/menu` (`src/lib/onboarding-store.tsx:413,492-500`). The top-bar badge tells you which state you reached: **"All changes saved"** (`save_saved`) means the server confirmed it; **"Saved locally"** (`save_local`) or **"Sign in to save your menu"** (`save_signIn`) means it never reached the database (`src/lib/onboarding-store.tsx:470-479`); **"Sync failed"** (`save_failed`) carries the server's own reason (`lastSaveError`, `src/lib/onboarding-store.tsx:62-63`). Only `save_saved` counts as success. |

Expected DB state after this step:

```sql
SELECT name, slug, is_published FROM public.restaurants;   -- 1 row, is_published = true
SELECT count(*) FROM public.categories;                     -- >= 1
SELECT count(*) FROM public.products;                       -- >= 1
```

> **The "Scan Link" on step 5 is the real guest URL** — this app's own origin plus
> `/menu/<slug>/<token>`, with a token that actually exists
> (`src/components/onboarding/step-preview.tsx:55-60`). It only appears once the menu has been
> saved to the server **and** at least one table exists; before that the panel says
> **"Not live yet"** with the hint that the link appears after saving and generating the table
> codes (`prv_notLive` / `prv_scanPending`). If you see "Not live yet", go back to the
> **Check it saved** row above — the menu never reached the database.

### Step 3 — Add a category and a product from the dashboard

| | |
| --- | --- |
| **Go to** | http://localhost:3000/dashboard/menu |
| **Do** | Tab **Categories** → **Add Category** → name it → **Create Category**. Then tab **Products** → **Add Product** → name, **Price (DT) \***, category, availability → **Add Product**. |
| **Should appear** | The item appears in the list immediately; the page header notes *"Changes autosave as you edit."* |

```sql
SELECT c.name AS category, p.name AS product, p.price, p.is_available
FROM public.products p JOIN public.categories c ON c.id = p.category_id
ORDER BY p.created_at DESC LIMIT 5;
```

### Step 4 — Generate a table QR code

| | |
| --- | --- |
| **Go to** | http://localhost:3000/dashboard/tables |
| **Do** | Set the **Tables** count (default 6, clamped 1–40) → **Generate Tables**. Then **Download All** or a single **Download QR**. |
| **Should appear** | One card per table, each showing a QR image and its URL. The URL shape is `${origin}/menu/${slug}/${token}` (`src/app/(owner)/dashboard/tables/page.tsx:33-34`). |

```sql
SELECT table_number, qr_token FROM public.restaurant_tables ORDER BY table_number;
-- Slug must match the URL you are about to open:
SELECT slug FROM public.restaurants;
```

### Step 5 — Open the guest menu

| | |
| --- | --- |
| **Go to** | The URL from step 4, e.g. `http://localhost:3000/menu/my-cafe/a1b2c3d4e5f60718` |
| **Should appear** | The guest menu with a badge like *"Dine-in · Table 1"*, a search box, category pills, and an **Add** button on each dish. |
| **If it 404s** | Both halves must match or the page calls `notFound()`: a `restaurants` row with that exact **slug** (`src/app/menu/[slug]/[token]/page.tsx:20-26`) *and* a `restaurant_tables` row with that exact **qr_token** (`:41-49`). Use the SQL above to compare. A "This menu isn't live yet" page instead of a 404 means the opposite problem — no Supabase config at all. |

### Step 6 — Place an order as a guest

| | |
| --- | --- |
| **Do** | Tap **Add** on a dish, open the cart bar, tap **Send Order to Kitchen**. |
| **Should appear** | A full-screen confirmation: **Order #N**, "Your order for … is with the kitchen…", and **Back to menu** (`src/components/guest-menu.tsx:711-721`). The number is the daily ticket number, starting at **#1001** for the first order of the day. The POST body is `{ slug, tableToken, clientRef, items }` (`src/components/guest-menu.tsx:208-218`), where `clientRef` makes a double-tap idempotent. |
| **If it fails** | `503 NO_OWNER` → no Supabase config. `404 NOT_FOUND` → the slug is wrong. `404 BAD_TABLE` → the table token is wrong. `404 PRODUCT_NOT_FOUND` / `409 PRODUCT_UNAVAILABLE` → the dish was deleted or hidden after you added it to the cart. |

```sql
SELECT o.daily_order_number, o.status, o.total, o.is_paid, o.order_day,
       t.table_number,
       (SELECT count(*) FROM public.order_items i WHERE i.order_id = o.id) AS lines
FROM public.orders o
JOIN public.restaurant_tables t ON t.id = o.table_id
ORDER BY o.created_at DESC LIMIT 5;
-- Expect: the new order with status = 'pending', is_paid = false,
--         order_day = today (UTC), and the correct number of lines.
```

### Step 7 — See it on the dashboard

| | |
| --- | --- |
| **Go to** | http://localhost:3000/dashboard/orders |
| **Should appear** | The order in the **Pending** column within ~3 seconds. The board polls `GET /api/orders` every 3 000 ms (`POLL_INTERVAL_MS`, `src/lib/use-orders.ts:28,118`) and also refreshes when the tab becomes visible again (`:119-122`). Each card shows the table number, items and total. |
| **If the list is empty** | (a) Are you signed in as the owner who owns this restaurant? `GET /api/orders` resolves the restaurant from `restaurants.owner_id` and returns `{"cloud":false,"orders":[]}` when it finds nothing (`src/app/api/orders/route.ts:44-57`). (b) Does the SQL in step 6 show the order? If yes, the write worked and this is a read/auth problem. (c) The board distinguishes "no orders" from "no connection" with a stale flag (`src/lib/use-orders.ts:107-111`) — if it is showing, the network is the problem, not the data. |

Accept it: click **Accept** on the card. Then **Mark Paid** (a Manager can; a Cashier cannot).

```sql
SELECT daily_order_number, status, is_paid, paid_at, accepted_by_name
FROM public.orders ORDER BY created_at DESC LIMIT 1;
-- After Accept:      status = 'accepted', accepted_by_name = <your worker/owner label>
-- After Mark Paid:   is_paid = true, paid_at = <timestamp>, status = 'paid'
```

### Step 8 — Mint a worker invite

| | |
| --- | --- |
| **Go to** | http://localhost:3000/dashboard/workers |
| **Do** | **Invite Worker** → choose **Cashier** or **Manager** → **Generate Invite**. |
| **Should appear** | An *"Invite ready"* panel with a QR code (`src/components/dashboard/invite-dialog.tsx:188`), a copyable link of the form `${origin}/worker/invite/<token>` (`:54-59`), and a note that it expires in 24 hours (`:171,211`). |

```sql
SELECT invite_token, role, is_used, used_by, expires_at
FROM public.worker_invites ORDER BY expires_at DESC LIMIT 3;
-- Expect: is_used = false, expires_at ≈ now + 24 hours
```

### Step 9 — Accept the invite as the worker

| | |
| --- | --- |
| **Go to** | The invite link from step 8, e.g. `http://localhost:3000/worker/invite/<token>` |
| **Do** | Type **Your name** → **Accept Invite**. |
| **Should appear** | The toast *"Welcome aboard!"* and an automatic redirect to `/worker/dashboard` after ~900 ms. The worker terminal shows three columns: **New Orders** / **Accepted** / **Paid**. |
| **If it fails** | Used, expired or unknown tokens all 404 (`src/app/api/auth/worker/accept/route.ts`). A `503 NEEDS_MIGRATION` means migration `1002`/`1004` did not run (the `workers.session_token` / `session_expires_at` columns are missing). |

```sql
SELECT w.full_name, w.role, w.session_token IS NOT NULL AS has_session,
       w.session_expires_at, i.is_used, i.used_by = w.id AS invite_points_at_worker
FROM public.workers w
LEFT JOIN public.worker_invites i ON i.used_by = w.id
ORDER BY w.created_at DESC LIMIT 5;
```

### Step 10 — Place a manual order from the worker terminal

| | |
| --- | --- |
| **Go to** | http://localhost:3000/worker/dashboard |
| **Do** | **New Order** → pick a **Table**, pick items **From the menu**, optionally add a **Custom item** + **Price** → **Add** → **Place Order**. |
| **Should appear** | Toast *"Order #{n} placed"*, and the order joins the **New Orders** column. |
| **If only the custom line fails** | That is the classic legacy-trigger signature — the manual (custom) path is what the rogue `order_items` trigger broke. Run `1003_live_db_repair.sql` ([§4B](#4b-existing-database-with-the-original-developers-legacy-objects)). |
| **Cashier vs Manager** | A Cashier cannot mark an order paid — the control is hidden client-side and the server enforces it with `403` (`src/app/api/orders/[id]/route.ts`). Test **Mark Paid** with a Manager invite. |

```sql
SELECT o.daily_order_number, i.product_name_snapshot, i.quantity, i.price_snapshot,
       i.product_id IS NULL AS is_custom_line
FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
ORDER BY i.order_id DESC LIMIT 10;
-- A custom line must have product_id = NULL and a non-zero price_snapshot.
```

### Step 11 — Confirm the whole loop

Both boards poll the same endpoint, so a second browser tab (or a phone, [§8](#8-expose-it-to-a-phone-tunnel))
sees the same orders within 3 seconds. If a guest order appears on the guest's confirmation
screen but never on the dashboard, the write committed and the read is mis-scoped — go back
to step 7's two checks.

---

## 7. Test the AI menu scan

The onboarding wizard has a **Scan your menu** button that reads a photo or PDF of a printed
menu and turns it into categories and products.

**What it needs**

- `MISTRAL_API_KEY` in `.env.local`. Without it the route fails fast with `503 NO_KEY`
  (`src/app/api/menu/scan/route.ts:78-81`) — no file is even read.
- An **owner session**. The scan is owner-only: no session → `401 UNAUTHORIZED`
  (`src/app/api/menu/scan/route.ts:59-65`), so sign in first.
- `MISTRAL_OCR_MODEL` is optional and defaults to `mistral-ocr-latest`
  (`src/lib/menu-scan.ts:100`).

**The request contract** — `POST /api/menu/scan`, `multipart/form-data`:

| Field | Value |
| --- | --- |
| `files` | 1–6 files, repeated. `MAX_FILES = 6` (`src/lib/menu-scan.ts:75`). |
| `venue` | Optional restaurant name string, max 200 chars (`src/app/api/menu/scan/route.ts:30,109`). |

| Limit | Value | Source |
| --- | --- | --- |
| Max files | 6 (0 or >6 → `400 TOO_MANY_FILES`) | `src/lib/menu-scan.ts:75`, `route.ts:111-116` |
| Max size per file | 12 MB (`413 FILE_TOO_LARGE`) | `src/lib/menu-scan.ts:76`, `route.ts:121-130` |
| Max total upload | 6 × 12 MB (`413 FILE_TOO_LARGE`) | `route.ts:131-136` |
| Accepted types | anything with an `image/*` MIME type, or `application/pdf` (`422 BAD_TYPE`) | `src/lib/menu-scan.ts:681` |
| Pages read per file | first 20 | `src/lib/menu-scan.ts:77,417` |
| Rate limit | 10 scans per minute per IP | `src/app/api/menu/scan/route.ts:69` |
| Max duration | 120 s | `src/app/api/menu/scan/route.ts:17-18` |

> **Trap:** the check is on the **MIME type**, not the file extension. If a part arrives with
> no content type, the route defaults it to `application/octet-stream`
> (`src/app/api/menu/scan/route.ts:147`) and the scan rejects the request with `422 BAD_TYPE`.
> Sending a real `image/jpeg` / `application/pdf` content type is what makes it work.
>
> The size caps are enforced on the decoder's own `f.size`, not on `Content-Length`
> (`route.ts:118-130`), so they still hold when the client omits or lies about that header.
> The declared length is only used as an early fail-fast (`route.ts:88-92`).

**Response**

```json
{ "ok": true,  "result": { "categories": [ … ], "products": [ … ], "stats": { … } } }
{ "ok": false, "error": "OCR_FAILED", "detail": "…" }
```

Error codes and their HTTP statuses are in `src/app/api/menu/scan/route.ts:32-45`
(`NO_KEY` 503, `TOO_MANY_FILES` 400, `FILE_TOO_LARGE` 413, `BAD_TYPE` 422, `UPLOAD_FAILED` /
`OCR_FAILED` / `NETWORK` 502, `RATE_LIMITED` 429, `EMPTY` 422). Anything not thrown as a
`MenuScanError` becomes `500 UNKNOWN` with the real exception in `detail`
(`route.ts:159-170`) — investigate that `detail`, never ignore it.

**Reading the server log.** Every scanner log line goes through one helper
(`src/lib/menu-scan.ts:109-120`) and is prefixed `[menu-scan] `, with `key=value` pairs after
the stage name. Falsy values are omitted from a line, so a field you expect may be absent.
The line that tells you what actually happened is:

```text
[menu-scan] FINAL strategy=reconcile source=ai model=mistral-ocr-latest categories=4 items=20 aiItems=20 parserItems=20 ms=8412
```

The field order is fixed: `strategy`, `source`, `model`, `categories`, `items`, `aiItems`,
`parserItems`, `ms` (`src/lib/menu-scan.ts:772-781`). How to read it:

| What you see | What it means |
| --- | --- |
| `source=ai`, `aiItems` ≈ `parserItems` | Both extraction paths agreed — the good case. |
| `source=fallback` or `aiItems=0`, `parserItems>0` | The LLM annotation came back empty and only the deterministic parser produced items. Usually an image-resolution problem — send photos at their native resolution rather than a small re-encode. |
| `categories=1` when the menu has four sections | The classic under-extraction signature. Check the OCR lines below. |
| No `FINAL` line at all | The scan threw before finishing. Look for the error line above it. |

Other stages to grep for, roughly in the order they appear: `VALIDATE` (`:673`), `UPLOAD`
(`:692,696`), `UPLOAD CLEANUP` / `UPLOAD CLEANUP FAILED` (`:296,298`), `OCR` (`:701`),
`OCR DONE` (`:712`), `STRUCTURE` (`:718,758`), `STRUCTURE SKIP` (`:723`),
`OCR RESPONSE PARSE` (`:433`), `OCR QUALITY` (`:449`), `OCR QUALITY RETRY` (`:470`),
`OCR QUALITY DEGRADED ACCEPT` (`:487`), `NETWORK RETRY` (`:182`), `RATE LIMIT RETRY` (`:206`),
`PARSER ORPHAN PRICES` (`:648`). Line numbers are for `src/lib/menu-scan.ts`.
The `OCR QUALITY` line carries the deterministic gate's verdict — `ok`, `reason`
(`EMPTY_TEXT`, `NO_ITEMS`, `NO_STRUCTURE`, `TRUNCATED`), `chars`, `items`, `headings`
(`src/lib/ocr-quality.ts`). Uploaded documents are released in a `finally` block after the
scan, so a scan never leaves your photos on the OCR provider (`src/lib/menu-scan.ts:783-788`).

To capture the log to a file instead of scrolling the terminal, restart the dev server with
its output redirected:

```bash
# bash
npm run dev > .dev.log 2> .dev.err.log
```

```powershell
# PowerShell
Start-Process cmd -ArgumentList '/c','npm run dev > .dev.log 2> .dev.err.log'
```

Then filter it:

```bash
grep '\[menu-scan\]' .dev.log
```

Both log files are gitignored (`.gitignore:41-43`).

**Calling the route without the UI** — useful when you want to test the pipeline alone:

```bash
curl -s -X POST http://localhost:3000/api/menu/scan \
  -H "Cookie: sufra_owner_session=<your cookie value>" \
  -F "files=@/path/to/menu.jpg;type=image/jpeg" \
  -F "venue=My Café" | head -c 600
```

Always call the **running app**, never a standalone fetch script — the route applies header,
MIME and session handling that a raw script bypasses.

---

## 8. Expose it to a phone (tunnel)

You need this to scan a table QR code with a real phone: the phone cannot reach
`localhost:3000`. This is for testing and demos only — for anything real, deploy the
container behind a proper domain ([§5.2](#52-docker)).

```bash
# 1. Install (any one of these)
winget install ngrok          # Windows
scoop install ngrok           # Windows
brew install --cask ngrok     # macOS

# 2. One-time authentication (token from https://dashboard.ngrok.com/get-started/setup)
ngrok config add-authtoken <NGROK_AUTHTOKEN>

# 3. Tunnel to the dev server
ngrok http 3000
```

ngrok prints a public HTTPS URL, e.g. `https://abc123-ngrok.ngrok-free.app`, which proxies to
`localhost:3000`. Check it from anywhere:

```bash
curl https://abc123-ngrok.ngrok-free.app/api/health
# {"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}
```

Then open **that URL** in a browser, go to `/dashboard/tables`, and re-download the QR codes.
The URLs inside them are generated from the origin the request came through
(`appBaseUrl()` in `src/lib/utils.ts:45-62`), so they become
`https://abc123-ngrok.ngrok-free.app/menu/...` and the phone can open them.

### The static-domain caveat — read this one

`appBaseUrl()` resolves in this order (`src/lib/utils.ts:45-62`):

1. `NEXT_PUBLIC_APP_URL`, if it is set (trailing slashes trimmed);
2. otherwise the browser's own origin (`window.location.origin`), when running in a browser;
3. otherwise the origin the request came through (`serverFallback`, which server callers pass
   in — e.g. the recovery route passes `new URL(req.url).origin`,
   `src/app/api/auth/recover/route.ts:46`).

So:

- **`NEXT_PUBLIC_APP_URL` unset** → QR and invite links follow whatever origin you are using.
  This is why the same build works on localhost and through the tunnel with no config change.
  **This is the setting to use during tunnel testing.**
- **`NEXT_PUBLIC_APP_URL` set** → it wins, everywhere, including on the tunnel. If it says
  `http://localhost:3000`, every QR code you print points at the *phone's own* localhost and
  scanning does nothing. If you must pin it, pin it to the tunnel URL — and remember it is
  inlined into the client bundle, so **restart the dev server** after changing it.
- The only server-side caller is password recovery
  (`src/app/api/auth/recover/route.ts:46`): with `NEXT_PUBLIC_APP_URL` unset it passes the
  request origin, so reset links are correct behind ngrok with no configuration.

Also true of the free ngrok plan:

- Sessions recycle after ~8 hours and the random subdomain changes. **QR codes printed with a
  random URL stop working when it changes.** For anything you intend to keep, reserve a
  static domain instead:

  ```bash
  ngrok http --url=sufra-table-order-01.ngrok-free.app 3000
  ```

- ngrok endpoints are already HTTPS, which matters for in-browser QR scanners.
- A tunnel is a public door to your dev server. Do not leave
  `SUFRA_AUTH_DISABLED=1` set while a tunnel is open ([§3](#3-configuration-create-env-local)).

---

## 9. Quality gates

Run these before you push. CI runs exactly the same scripts on Node 20
(`.github/workflows/ci.yml:19-23`), so a green run here means a green run there.

```bash
npm run check     # typecheck + lint + tests
npm run build     # production build
```

`npm run check` is defined as `npm run typecheck && npm run lint && npm run test`
(`package.json:13`), so:

```bash
npm run typecheck   # tsc --noEmit            -> no output = pass
npm run lint        # next lint               -> "✔ No ESLint warnings or errors"
npm run test        # vitest run              -> "Test Files  N passed (N)" / "Tests  N passed (N)"
npm run build       # next build              -> route table + "✓ Compiled successfully"
```

Expected shapes:

```text
> tsc --noEmit
(no output — silence is success)

> next lint
✔ No ESLint warnings or errors

> vitest run
 Test Files  9 passed (9)
      Tests  181 passed (181)
```

```text
> next build
   ▲ Next.js 15.x.x
 ✓ Compiled successfully
 ✓ Generating static pages
Route (app)                              Size     First Load JS
...
```

Notes:

- Run them individually when one fails — `npm run check` stops at the first failing stage, so
  a lint warning can hide a test failure behind it.
- `next lint` prints a deprecation warning about ESLint 8 on Next 15. That is expected.
- **`npm run build` needs no environment variables.** If it fails, it is a code problem, not a
  configuration problem — do not "fix" it by adding placeholder keys.
- `npm run build` produces the standalone bundle that Docker runs. Exercise it locally with
  `npm run start:standalone` (`package.json:9`) rather than `npm start`, which uses a different
  entrypoint and does not load config the way the container does.

### 9.1 Database schema smoke test

The migration chain ships its own end-to-end assertion test. It is worth running once on a
throwaway database after any schema change, because it asserts the *contracts the app's code
depends on* rather than merely that the SQL parsed (`supabase/tests/schema_smoke.sql:8-13`).
CI runs this same sequence in its `migrations` job (`.github/workflows/ci.yml:53-126`), so a
green local run and a green pipeline mean the same thing.

```bash
# Requires a plain Postgres 16 and psql. Run in this exact order.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/_shim_storage.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1002_production_readiness.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1003_live_db_repair.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1004_session_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/schema_smoke.sql
```

Expected tail:

```text
NOTICE: ok — guest slug + qr_token resolves one table
NOTICE: ok — guest menu product query returns the available product
NOTICE:
NOTICE: ========================================
NOTICE: ALL SCHEMA SMOKE CHECKS PASSED
NOTICE: ========================================
```

> ### ⚠️ Two things to know before running this
>
> **1. Skip the shim on a Supabase project.** `_shim_storage.sql` creates test-only `auth` and
> `storage` stand-ins for plain Postgres and says so explicitly: *"NOT part of the deployable
> schema. Never run this against a Supabase project."* (`supabase/tests/_shim_storage.sql:20`).
> Those schemas already exist on Supabase — you do not need it, and you should skip it.
>
> **2. `schema_smoke.sql` now cleans up after itself.** It runs entirely inside one transaction
> closed with `ROLLBACK` (`supabase/tests/schema_smoke.sql:26,376-378`), so the fixtures it
> inserts — a restaurant slugged `cafe-smoke`, plus its category, product, table, order, items,
> worker, invite and a daily-counter bump — are all undone and **no row is left behind**. It is
> therefore safe to run against a live project, and safe to run repeatedly.
>
> The reason that matters: a leftover `cafe-smoke` restaurant would break first-run signup, since
> the ownership bind only auto-claims an unowned restaurant when it is the *only* row
> (`src/app/api/auth/signup/route.ts:110-122`).
>
> The one caveat is failure handling: if a check raises, the transaction aborts **and stays open**,
> so your `psql` session is left in a failed transaction. Run `ROLLBACK;` (or reconnect) before
> doing anything else — `psql` will refuse further statements until you do. That is also why you
> should point it at a scratch database first.
>
> Each check prints `ok — <contract>` and raises `SMOKE FAIL: <contract>` on the first failure,
> so a red run names the broken contract and stops immediately.

---

## 10. Troubleshooting

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 1 | `docker compose ps` shows `Up (unhealthy)` but the app answers on :3000 | The probe is `GET /api/health` (`docker-compose.yml:46-52`, and the image's own `HEALTHCHECK` at `Dockerfile:50-51`). A 404, a timeout, or a non-2xx fails the probe after `start_period: 20s` + 3 × 30s. `restart: unless-stopped` restarts only on process **exit**, so it never self-heals. | Confirm the probe by hand: `docker exec restaurant-ai-web node -e "fetch('http://localhost:3000/api/health').then(r=>console.log(r.status))"`. If it prints 200, check app logs; if it hangs, Next is not listening — that is the real problem. Note the probe is **liveness only**: `/api/health` returns 200 even with an unreachable database (`src/app/api/health/route.ts:14-29`), so `healthy` does not mean the DB is configured. Read `"backend"` in the JSON body for that. |
| 2 | `npm ci` exits with `EUSAGE: … Missing: vitest@2.1.9 from lock file` | `package.json` declared a dependency the committed lockfile did not contain, so CI's first real step died before lint/typecheck/test/build ever ran. | The lockfile in this change set is repaired — re-clone, or delete `node_modules` and re-run `npm ci`. Do **not** work around it with `npm install`: that rewrites the lock and re-hides the drift. `Dockerfile:8-11` deliberately runs `npm ci` with no `\|\| npm install` fallback for the same reason. If it comes back, run `npm install` once on the pinned Node 20 and commit the regenerated lock. |
| 3 | A migration fails with `42P01 undefined_table` (classically at `REFERENCES public.restaurants(id)`) | `1002_production_readiness.sql` is an **incremental** patch and assumes the eight base tables exist (`1002:5-7`). On an empty database its first statement fails and, because the SQL editor submits one file as a single implicit transaction, the **whole file rolls back**. | You ran the files out of order. Apply in the order of your [§4 track](#41-pick-your-track): `0001_init_schema.sql` **first**, then `1002`, then `1004` (and `1003` on a legacy database). |
| 4 | A migration fails with `42703 undefined_column` — e.g. `products.created_at`, `orders.order_day`, `worker_invites.used_by`, `restaurants.owner_id` | The target database is a partial/legacy schema: `1002` references columns that no statement in it creates (the audit lists them all in `docs/audit/01-database.md`, "Columns the app requires that no statement in 1002 ever mentions"). | Run `0001_init_schema.sql` — it creates every one of those columns with defaults. Then re-run the migration that failed. On a legacy database, follow with `1003_live_db_repair.sql` and read every `VERIFY FAIL` warning. |
| 5 | The dashboard shows zero orders even though the guest app confirmed an order | Either the restaurant is not bound to the owner you are signed in as — `GET /api/orders` resolves the restaurant from `restaurants.owner_id` and returns `{"cloud":false,"orders":[]}` when it finds none (`src/app/api/orders/route.ts:44-57`) — or the app is in degraded mode (`backend:false`), in which case the board mirrors the local demo store instead of polling (`isCloud` is false, `src/lib/onboarding-store.tsx:813`; `src/lib/use-orders.ts:72-129`). | `SELECT id, owner_id FROM public.restaurants;` and compare with `SELECT id, email FROM auth.users;`. Also `curl -s localhost:3000/api/auth/session` (must return your user, not `null`) and `curl -s localhost:3000/api/health`. The board also shows a stale indicator when the last poll failed (`src/lib/use-orders.ts:107-111`) — that distinguishes "no orders" from "no connection". Orders may legitimately be missing from the list for rows older than the 60-row cap (`src/app/api/orders/route.ts:64`). |
| 6 | The guest menu 404s on a QR code that looks right | The page requires **both** a `restaurants` row with that exact `slug` **and** a `restaurant_tables` row with that exact `qr_token` for that restaurant; either mismatch calls `notFound()` (`src/app/menu/[slug]/[token]/page.tsx:21-26,43-50`). | `SELECT r.slug, t.table_number, t.qr_token FROM public.restaurant_tables t JOIN public.restaurants r ON r.id = t.restaurant_id;` and compare character-for-character with the URL. If the menu renders the "This menu isn't live yet" placeholder instead of a 404, the app has no Supabase config at all — see row 7. |
| 7 | The guest menu says "This menu isn't live yet", or the save badge says "Saved locally" | Degraded mode: `supabaseAdmin` is `null` because `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset (`src/lib/supabase-admin.ts:7-15`). The guest page renders the placeholder rather than 404ing (`src/app/menu/[slug]/[token]/page.tsx:16-18`; `src/components/guest-menu.tsx:271-279`), and the store degrades to a local save instead of the cloud (`src/lib/onboarding-store.tsx:470-479`). | `curl -s localhost:3000/api/health` — `"backend":false` confirms it. Fill in both variables in `.env.local` and **restart** the dev server (it reads the file only at boot). |
| 8 | An order insert fails with `23502 not_null_violation` on `orders.id` / `order_items.id` / `worker_invites.id` | The app inserts rows **without** a primary key and relies on a column default (`src/app/api/orders/route.ts:264-289`, `src/app/api/auth/worker/invite/route.ts:53-59`). A legacy schema whose PKs carry no `DEFAULT` rejects every insert. | Handled by `0001_init_schema.sql` (every `id` is `uuid PRIMARY KEY DEFAULT gen_random_uuid()`) and re-asserted by `1002` §10 for legacy databases. Verify: `SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema='public' AND column_name='id';` |
| 9 | Worker invite acceptance fails, or the worker is logged out unexpectedly | Two known causes. (a) `workers.session_token` may lack its `UNIQUE` constraint if it was created by an earlier partial run — `ADD COLUMN IF NOT EXISTS … UNIQUE` skips the **whole** clause when the column already exists (`1002` §5, audit DB-10); without it a duplicated token logs out both workers. (b) Worker sessions expired server-side were previously never enforced (LIB-02). | `0001_init_schema.sql` declares `workers_session_token_key` as a separate constraint so it survives re-runs, and `1004_session_hardening.sql` adds `session_expires_at`. Confirm: the verification query in [§4A step 4](#4a-fresh-hosted-supabase-project), check 3 (expect 5 rows). |
| 10 | A worker manual order (a **Custom item** line) returns `500 CREATE_ITEMS`, or its price silently changes | The original developer's live database has a trigger on `order_items` that rewrites `price_snapshot` from `products` and NULLs custom lines (price `0.01` stored as `5.50`); a custom line aborts with `23502`. 100% of worker manual orders fail. | Run `supabase/migrations/1003_live_db_repair.sql` — it drops every application trigger on `orders`/`order_items` except this repo's own `sufra_orders_set_day` (`1003:64-70`). Verify with check 2 of the [§4A verification SQL](#4a-fresh-hosted-supabase-project): exactly one row, `orders \| sufra_orders_set_day`. |
| 11 | Order numbers look wrong — duplicate ticket numbers, or a ticket inserted as `9999` comes back as `3` | The same legacy `orders` trigger rewrites `daily_order_number` with a racy 1-based `max+1` value, stomping the atomic `sufra_next_order_number()` allocator (`1003:26-35`). The migration cannot fix what it cannot name. | Same fix as row 10: `1003_live_db_repair.sql` discovers and drops it procedurally. Then confirm the allocator works: `SELECT public.sufra_next_order_number('<restaurant-uuid>');` — the first call of the day returns **1001**. |
| 12 | `PGRST200` / "Could not find a relationship" from the dashboard order list | PostgREST embedded selects are resolved through foreign keys; the order list embeds `order_items(*)` and `table: restaurant_tables(table_number)` (`src/app/api/orders/route.ts:59-64`). Missing FKs break the embed. | `0001_init_schema.sql` §2 creates the FKs, and `1003` verifies and repairs them on a legacy database (its `VERIFY FAIL DB-05` line names the missing one). Check: `SELECT conrelid::regclass, conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;` |
| 13 | A Cashier sees **Mark Paid** but gets `403 FORBIDDEN` (or a manager's action is rejected) | The permission matrix understands only `'Cashier'`, `'Manager'` and `'Owner'`, but the migration's CHECK allows the lowercase spellings too; an unrecognised role is coerced to `Cashier` at PATCH time (`src/lib/worker-permissions.ts`, audit DB-20). | Use the canonical capitalised roles. Check: `SELECT id, full_name, role FROM public.workers;` — any row with `'manager'`/`'cashier'` should be normalised. |
| 14 | `docker build` fails at `COPY --from=builder /app/public ./public` with `/app/public: not found` | The repository had no `public/` directory, and a `COPY` from a missing source path is a **hard build failure**, not a silent skip. | Fixed in this change set: `public/.gitkeep` is tracked so the copy always has a source, and `Dockerfile:33-35` documents why. If you see it again, someone deleted `public/.gitkeep`. |
| 15 | `docker compose up` aborts before building with `env file …\.env.local not found` | `env_file` defaults to **required**, so Compose aborted at project load — before any container — with an error that never mentions `.env.example`. | Fixed: the compose file now uses `env_file: [{ path: .env.local, required: false }]` (`docker-compose.yml:38-41`), so the stack starts without it. Create the file anyway ([§3](#3-configuration-create-env-local)) or the app runs in degraded mode. |
| 16 | QR codes generated locally open a blank page on a phone | You are on a tunneled URL but `NEXT_PUBLIC_APP_URL` is pinned to `http://localhost:3000`, and it takes precedence over the request origin (`src/lib/utils.ts:45-62`). Or the free ngrok session recycled and the random subdomain changed. | Unset `NEXT_PUBLIC_APP_URL` and restart the dev server, then regenerate the QR codes from `/dashboard/tables` while browsing the tunnel URL. For anything persistent, reserve a static ngrok domain ([§8](#8-expose-it-to-a-phone-tunnel)). |
| 17 | Password-recovery emails link to `localhost` | `NEXT_PUBLIC_APP_URL` wins over the request origin in the recovery route (`src/app/api/auth/recover/route.ts:46`); the old `.env.example` shipped it live as `http://localhost:3000`. | Leave `NEXT_PUBLIC_APP_URL` unset (the `.env.example` line is now commented out) so reset links are derived from the request origin. Then **restart** the server — the value is inlined at build time. |
| 18 | `/login` returns 404 | There is no `/login` route in this app. | Use `/auth/login` (owner) or `/worker/invite/<token>` (worker). `/` and `/onboarding` are the public entry points. |
| 19 | Port 3000 stops answering after an edit | The dev server can die silently. | Restart it with logging and check the port: `npm run dev > .dev.log 2> .dev.err.log`, then on Windows `Get-NetTCPConnection -LocalPort 3000 -State Listen`, on macOS/Linux `lsof -iTCP:3000 -sTCP:LISTEN`. |
| 20 | The AI scan returns only 1 category, or under-extracts | Under-extraction on a downscaled image: OCR returns full markdown but the annotation comes back empty, so only the deterministic parser contributes. | Send the photo at native resolution (images ≤ 2048 px should be sent unchanged). Read the `[menu-scan] FINAL` line — `source=fallback` with `aiItems=0` is this signature. See [§7](#7-test-the-ai-menu-scan). |
| 21 | The AI scan returns `502 NETWORK` or `TypeError: fetch failed` | `api.mistral.ai` intermittently unreachable at the TCP layer; Node's `undici` does no Happy Eyeballs and the host resolves to unreachable IPv6 addresses. | Retry. The route already sets `dns.setDefaultResultOrder("ipv4first")` and retries 6× with capped backoff (`src/lib/menu-scan.ts`). Always call the **running app** route, never a standalone fetch script. |
| 22 | The AI scan returns `502 OCR_FAILED` with a thin OCR response | Degraded OCR: HTTP 200 but only a few markdown lines and no headings. | The quality gate re-OCRs up to 3× on the same file, keeps the best attempt if none passes, and only throws when nothing usable came back (`src/lib/ocr-quality.ts`, `src/lib/menu-scan.ts:106,408-490`). Check the `OCR QUALITY` / `OCR QUALITY DEGRADED ACCEPT` lines for the `reason`; re-scan with a better photo. |
| 23 | `docker compose ps` shows an extra `n8n` container | The old compose file declared an n8n workflow engine with a bind mount into a directory that did not exist, and the app has zero references to it. | Removed in this change set (`docker-compose.yml:54-59` documents why). If you still see it, you are on an older checkout. |
| 24 | `docker build` is slow/inconsistent between runs, or the image resolves different dependency versions than CI | The old `Dockerfile` had `RUN npm ci \|\| npm install`, which silently resolved a different tree than CI's `npm ci` and masked lockfile drift. | Fixed: the Dockerfile runs `npm ci` alone (`Dockerfile:8-11`). Keep it that way — a broken lockfile should stop a release. |

### When a step fails and the table does not cover it

1. `curl -s http://localhost:3000/api/health` — is `backend` true? `ocr` true?
2. `curl -s http://localhost:3000/api/auth/session` — is there a user, or `null`?
3. Re-run the [§4A verification SQL](#4a-fresh-hosted-supabase-project) — all five checks.
4. For the scanner, read the `[menu-scan] FINAL` line and the stage lines above it
   ([§7](#7-test-the-ai-menu-scan)).
5. Only then read the code. The audit reports in `docs/audit/` record the full reasoning
   behind every constraint and every known trap in this system.

---

## Appendix — quick reference

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Configure | `cp .env.example .env.local` then fill it in |
| Dev server | `npm run dev` → http://localhost:3000 |
| Production build | `npm run build` |
| Run the built standalone server | `npm run start:standalone` |
| All quality gates | `npm run check` |
| Typecheck only | `npm run typecheck` |
| Lint only | `npm run lint` |
| Tests only | `npm run test` |
| Push migrations (Supabase CLI) | `npm run db:push` |
| Local Supabase stack | `supabase start` / `supabase stop` |
| Container stack | `docker compose up --build` |
| Container health | `docker compose ps` / `curl -s localhost:3000/api/health` |
| Phone tunnel | `ngrok http 3000` |

**Key paths**

| Thing | Where |
| --- | --- |
| Owner auth pages | `/auth/signup`, `/auth/login`, `/auth/forgot`, `/auth/reset` |
| Owner dashboard | `/dashboard`, `/dashboard/menu`, `/dashboard/orders`, `/dashboard/tables`, `/dashboard/workers`, `/dashboard/settings` |
| Onboarding wizard | `/onboarding` |
| Worker terminal | `/worker/dashboard` |
| Worker invite | `/worker/invite/<token>` |
| Guest menu | `/menu/<slug>/<qr_token>` |
| Health probe | `/api/health` |
| The single DB client | `src/lib/supabase-admin.ts` |
| Migrations | `supabase/migrations/` |
| Audit reports | `docs/audit/` |
