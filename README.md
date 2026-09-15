# Sufra — QR Menu & Table Ordering

Sufra (سُفرة, "the laid dining table") is a QR-menu and table-ordering platform for
restaurants. The owner builds a branded digital menu on the owner platform, prints a
unique QR code per table, and guests scan to browse and order straight to the
dashboard in real time.

- **Stack:** Next.js 15 (App Router, `--turbopack`), TypeScript, Tailwind CSS v4, React 19 context stores, Supabase (Postgres).
- **UI:** dark premium editor (owner platform) + themes for the guest menu (`classic`, `minimal`, `vibrant`, `gallery`).
- **Branding:** the guest menu is language-switchable (EN/FR/AR) but always priced in dinars — the currency row is hidden there; the public landing page switches English / French / Arabic and $ / €.

---

## 1. Local development

```bash
git clone <repository-url> sufra && cd sufra   # or `cd` into your existing checkout
npm ci                 # installs deps from the committed lockfile
cp .env.example .env.local   # then fill in the values below
npm run dev            # http://localhost:3000
```

**Requires Node 20+** — CI (`.github/workflows/ci.yml`) and the Docker image
(`FROM node:20-alpine`) both pin 20, and `package.json` declares no `engines`
field, so an older Node fails somewhere unpredictable instead of at install.

Use **`npm ci`, not `npm install`**: the committed lockfile is what CI
(`.github/workflows/ci.yml`) and the Docker image both install from, and
`npm install` can rewrite it.

Environment (`.env.local`):

| Var | What it's for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** service role key. Never commit a real value. |
| `MISTRAL_API_KEY` | **server-only** Mistral key for menu OCR scanning |
| `MISTRAL_OCR_MODEL` | optional OCR model override (default `mistral-ocr-latest`) |
| `NVIDIA_API_KEY` | **optional — server-only.** NVIDIA NIM key for the LLM menu-structuring pass (§6). Leave it unset and the scanner works exactly as before: the pass logs `STRUCTURE LLM ok:false reason:NO_KEY` and is skipped, with no error surfaced to the user. |
| `NVIDIA_BASE_URL` | optional override of the NIM base URL (default `https://integrate.api.nvidia.com/v1`) |
| `NVIDIA_MODEL` | optional model override (default `meta/llama-3.2-11b-vision-instruct`). Only a few models are entitled per NVIDIA account — see the trap in §6 before changing it. |
| `NEXT_PUBLIC_APP_URL` | **optional — commented out by default.** Canonical URL for the links the product hands out (QR codes, worker invites, password recovery). Leave it unset and they follow the origin the request came through; setting it pins them to whatever you write. See §3. |
| `SUFRA_RATE_LIMIT_DISABLED` | set to `1` to disable rate limiting (dev/tests only) |
| `SUFRA_PLACEHOLDER_OWNER_EMAIL` | optional override for the legacy auto-provisioned owner email matched at signup |
| `SUFRA_AUTH_DISABLED` | **dev-only escape hatch:** `1` opens every login wall. Honoured only when `NODE_ENV !== "production"`. Never set it where the internet can reach you (including an ngrok tunnel). |

> The browser never talks to Supabase directly — there is no anon-key client.
> Every database call goes through Next.js API routes using the service role,
> and every protected route verifies the caller's session server-side.

Authentication:

- **Owner:** Supabase Auth email + password. Sign up once at `/auth/signup`
  (binds the account to the restaurant), then sign in at `/auth/login`. The
  session lives in an `HttpOnly` cookie; `/dashboard/*` redirects to login
  when it is missing or invalid.
- **Workers:** the owner mints a one-time invite (dashboard → Workers), the
  worker opens `/worker/invite/<token>` and picks a name. Accepting sets an
  `HttpOnly` worker cookie. Roles (`Cashier`, `Manager`) are enforced
  server-side on every order mutation — the client role is display only.
- **Guests:** no account. Ordering is public by design but fully
  server-priced: the browser sends product ids + quantities, the server
  resolves prices from the database.

Checks:

```bash
npm run check       # typecheck && lint && test — the gate CI runs
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest run — 181 tests across 9 files
npm run build       # production build
```

### Docker (optional)

A `Dockerfile` and `docker-compose.yml` are included. `.env.local` is
**optional** for Compose: the stack boots without it and
`http://localhost:3000/api/health` reports `{"ok":true,"backend":false}`
("alive, backend unconfigured") until the Supabase values exist. The
container healthcheck probes that same endpoint, and there are no other
services (the unused `n8n` service was removed):

```bash
docker compose up --build   # serves on :3000
```

---

## 2. Supabase — schema and migration

The schema lives in versioned SQL, not in this README. There are **four** files
and the order matters — `1002` is an **incremental** patch, not a standalone
schema:

| # | File | What it is | Fresh project | Existing DB |
| --- | --- | --- | --- | --- |
| 1 | `supabase/migrations/0001_init_schema.sql` | **The base schema.** Creates all nine tables with their defaults, FKs, uniques and CHECKs, plus `sufra_next_order_number()`, the `order_day` trigger and the `menu-images` bucket row. `CREATE TABLE IF NOT EXISTS` throughout, so it is a no-op where the tables already exist. | run | run (safe) |
| 2 | `supabase/migrations/1002_production_readiness.sql` | **Incremental, and NOT self-sufficient.** It `ALTER`s tables that `0001` creates — run first on an empty database it dies with `42P01`, because its first statement references `public.restaurants(id)`. Adds the daily counter + RPC, the unique backstop on `orders (restaurant_id, order_day, daily_order_number)`, `client_ref`, `products.sort_order`, worker sessions/invites, money CHECKs, RLS policies, the storage bucket and PK defaults. | run | run |
| 3 | `supabase/migrations/1003_live_db_repair.sql` | Repair for **the original developer's existing database**: procedurally drops rogue triggers on `orders`/`order_items`, adds the four missing unique constraints, the missing PK defaults, and repairs the FKs the embedded selects need. | no-op (safe) | run |
| 4 | `supabase/migrations/1004_session_hardening.sql` | Adds `workers.session_expires_at`, makes `worker_invites.expires_at NOT NULL DEFAULT now() + interval '24 hours'`, and re-asserts `products.sort_order`. | run | run |

Which files to run depends on what your database already contains:

- **Fresh Supabase project / local stack:** `0001` → `1002` → `1004`.
- **The original developer's live database:** `0001` → `1002` → **`1003`** → `1004`.

**`docs/RUNBOOK.md` §4 is the authoritative walkthrough of both tracks** (what each
file does, the expected output and how to verify it). Run the files in the
Supabase SQL editor, or let the CLI apply them: `supabase/config.toml` is
committed so `supabase start` works locally, and `npm run db:push` pushes the
chain to a linked project. Every file is guarded and re-runnable.

To prove the result, run the schema test suite — see §4 below.

Live tables (columns the app actually uses): `restaurants` (incl.
`owner_id → auth.users.id`, `slug`, `business_type`, `currency`,
`primary_color`, `cover_image`, `menu_layout_theme`, `is_published`),
`categories` (`sort_order`), `products` (`category_id`, `price`,
`image_url`, `image_source`, `is_available`, `sort_order`),
`restaurant_tables` (`table_number`, `qr_token`), `orders` (`status`,
`total`, `daily_order_number`, `order_day`, `is_paid`, `paid_at`,
`client_ref`), `order_items` (`product_id` nullable for manual lines,
`product_name_snapshot`, `price_snapshot`, `quantity`), `workers`
(`restaurant_id`, `full_name`, `role`, `session_token`,
`session_expires_at`), `worker_invites` (`invite_token`, `role`, `is_used`,
`used_by`, `expires_at`), `sufra_daily_counters` (`restaurant_id`, `day`,
`last_number`).

Three of those carry a behaviour worth knowing:

- **`restaurants.slug` is write-once.** It is baked into every printed QR
  standee, so the sync route never rewrites it for an existing row (only a
  brand-new restaurant stores the slug it sent) — renaming a restaurant no
  longer invalidates the codes already on the tables.
- **`products.sort_order` / `categories.sort_order` are read *and* written.**
  They are the stored order (`GET /api/menu` orders by them; `PUT /api/menu`
  writes the editor's `position` back), not a vestigial column.
- **`workers.session_expires_at`** is the server-side half of the worker
  session: an expired token stops authenticating even if the cookie is
  replayed.

> **RLS note:** the app talks to these tables with the **service role key**
> (server-only), which bypasses RLS. The migrations enable RLS with
> owner-scoped policies as defense-in-depth.
> Orders are always written through `/api/orders` (server-side, server-priced),
> never directly from the browser.

---

## 3. Connecting to the internet with ngrok

In development the app only listens on `http://localhost:3000`. To let a phone on
a different network reach it (for scanning table QR codes), we exposed it to the
internet with **ngrok**:

```bash
# 1. Install (any of these):
winget install ngrok                 # or: scoop install ngrok  |  brew install --cask ngrok

# 2. One-time auth (token from https://dashboard.ngrok.com/get-started/setup):
ngrok config add-authtoken <NGROK_AUTHTOKEN>

# 3. Open a tunnel to the Next.js dev server:
ngrok http 3000
```

ngrok prints a public HTTPS URL, e.g. `https://abc123-ngrok.ngrok-free.app`.
That URL now proxies straight to `localhost:3000`:

```bash
curl https://abc123-ngrok.ngrok-free.app/api/auth/session   # 200 — { cloud, user }
```

**Why it "just works" with Sufra:** the app hard-codes no domain. Every link it
hands out is built by `appBaseUrl()` in `src/lib/utils.ts`, which resolves in
this order:

1. `NEXT_PUBLIC_APP_URL`, when it is set and non-empty — the escape hatch for a
   reverse proxy that rewrites `Host` and needs a pinned canonical domain;
2. otherwise the browser origin (`window.location.origin`);
3. otherwise the request origin the caller passes in (`serverFallback`).

The old hard-coded `https://sufra.app` fallback is gone, and `.env.example`
ships `NEXT_PUBLIC_APP_URL` **commented out** — so the default is (2)/(3), and
scan-the-QR links, worker invites and password-recovery links carry whatever
origin the request actually came through: localhost during development, the
ngrok URL on the open internet, the deployment URL in production. No config
change is needed when switching. The one trap is *setting* it to
`http://localhost:3000`: that pins every printed QR code to localhost even while
you are serving through ngrok, so a phone cannot open it.

Tips/limits for the free plan:

```bash
# Fixed subdomain (recommended once your tunnel URL is shared anywhere):
ngrok http --url=sufra-table-order-01.ngrok-free.app 3000
```

- Free ngrok sessions recycle after ~8 h; QR codes printed with the free random URL
  break when it changes. For anything persistent, reserve a static domain
  (`--url=<your-name>.ngrok-free.app`) or deploy to a real host.
- ngrok URLs are HTTPS already — ideal for camera scanners and webhook callbacks.
- This tunnel is for **testing and demos**. For production, run the Docker container
  behind a real domain (the app is origin-aware, so it needs no code changes).

---

## 4. Verifying the schema — the SQL test suite

After running the migration chain (§2), prove it. `supabase/tests/` holds a
plain-`psql` suite that asserts the contracts the application code depends on —
columns, defaults, uniqueness, the one legitimate `orders` trigger, the counter
RPC, the storage bucket and the RLS posture:

- `supabase/tests/_shim_storage.sql` — Supabase stand-ins (an `auth.users`
  stub, the `storage.buckets` / `storage.objects` tables, and the `anon` /
  `authenticated` / `service_role` roles) so the chain can run on **plain
  PostgreSQL**. Test-only; never apply it to a real Supabase database.
- `supabase/tests/schema_smoke.sql` — **34 assertions**. It runs inside a single
  transaction that **ROLLS BACK**, so it inserts its disposable rows (a
  `cafe-smoke` restaurant with a menu, tables, orders and workers) and leaves
  **zero residue** behind. Run it with `ON_ERROR_STOP=1`: the first broken
  contract raises, and a clean run prints one `ok — <name>` notice per check and
  closes with `ALL SCHEMA SMOKE CHECKS PASSED` before it rolls back.

The same chain runs in CI (`.github/workflows/ci.yml`): shim → every
`supabase/migrations/*.sql` in filename order → the smoke test, against a real
PostgreSQL 16. That job exists because `npm run check` never opens a database,
so a migration referencing a column that does not exist would otherwise pass
lint, typecheck and unit tests. `docs/RUNBOOK.md` §4 (which files to run) and §6
(manual end-to-end checklist) are the operator side of this.

---

## 5. Where is what

| Area | Path |
| --- | --- |
| Public landing (EN/FR/AR + $/€, "Sign in" link) | `src/app/page.tsx`, `src/lib/landing-i18n.tsx` |
| Owner onboarding wizard (requires an owner session — anonymous visitors are redirected) | `src/app/onboarding/` |
| Owner auth (signup/login/logout) | `src/app/auth/`, `src/app/api/auth/` |
| Owner dashboard | `src/app/(owner)/dashboard/` |
| Worker terminal + invite accept | `src/app/(worker)/worker/`, `src/app/api/auth/worker/` |
| Guest menu (scan → order) | `src/app/menu/[slug]/[token]/`, `src/components/guest-menu.tsx` |
| Menu scan pipeline (OCR → annotation + parser + NVIDIA structurer → validator) | `src/lib/menu-scan.ts`, `src/lib/menu-structure-llm.ts`, `src/lib/menu-validate.ts` |
| Menu sync API (validation + IDOR guard) | `src/app/api/menu/`, `src/lib/menu-mapping.ts`, `src/lib/menu-sync-guard.ts` |
| Orders API (server pricing, atomic numbers) | `src/app/api/orders/`, `src/lib/order-utils.ts` |
| Image upload → Supabase Storage | `src/app/api/upload/`, `src/components/image-dropzone.tsx` |
| Auth sessions + worker permissions | `src/lib/owner-auth.ts`, `src/lib/worker-auth.ts`, `src/lib/worker-permissions.ts` |
| Rate limiting | `src/lib/rate-limit.ts` |
| Phone preview component | `src/components/phone-mockup.tsx` |
| Brand mark / wordmark | `src/components/brand-logo.tsx` |
| Supabase server client | `src/lib/supabase-admin.ts` |
| Language / currency switcher (the guest menu uses it language-only: prices are always DT) | `src/components/lang-cur-switcher.tsx`, `src/lib/i18n.tsx` |
| Schema: base + incremental + legacy repair | `supabase/migrations/`, `docs/RUNBOOK.md` §4 |
| Schema smoke test (34 assertions, rolled back) | `supabase/tests/` |
| Liveness probe (`{"ok":true,"backend":…}`) | `src/app/api/health/route.ts` |
| CI: checks + the real migration chain on Postgres 16 | `.github/workflows/ci.yml` |
| Container path | `Dockerfile`, `docker-compose.yml` |

---

## 6. Menu scanning (AI photo/PDF → menu) — how it works

The onboarding wizard has a **"Scan your menu"** button (`MenuScanButton` in
`src/components/onboarding/menu-scan-dialog.tsx`, mounted in
`step-categories.tsx` and `step-products.tsx`). The flow:

```text
Browser:  user picks photos/PDFs (≤6 files, ≤12 MB each) → prepareUploadFile() re-encodes
          only genuinely large photos → POST /api/menu/scan (FormData: files + venue)
Route:    guards, in this order — NO_BACKEND → owner session → rate limit (10/min/IP)
          → NO_KEY → declared Content-Length → multipart parse → per-file and total size caps
Server:   upload each file to Mistral Files (25 s timeout each)
          → POST /v1/ocr per document (90 s timeout): pages 0-19, table_format = markdown,
            whole-document document_annotation (json_schema) → markdown + table bodies + annotation
          → quality gate (ocr-quality.ts); a structurally degraded response is retried
            (up to OCR_QUALITY_ATTEMPTS = 3), and the structurally fittest attempt is kept
          → buildMenuImport(annotation)                 [stats.source = "ai"]
          → parseOcrMarkdown() deterministic parser      [stats.source = "fallback"]
          → structureMenuWithLlm(markdown) NVIDIA NIM    [stats.source = "llm"]
            (skipped with NO_KEY when NVIDIA_API_KEY is unset; a timeout, an
             outage or a malformed reply degrades to the path below, never fails
             the scan)
          → when the LLM answered: mergeStructuredMenu(llm, parser)   [llm / llm+parser]
            else:                reconcileImports(ai, parser)
          → validateMenuImport(...) pure deterministic gate — removes what a
            menu must not contain (dropped rows are logged, never silently lost)
          → one MenuImportResult → onboarding store
          → finally: DELETE every uploaded Mistral document (best effort)
Everything after the size caps shares one 110 s budget (SCAN_BUDGET_MS), below the
route's maxDuration = 120, so a hanging provider ends in a typed error instead of
the platform killing the request with no message and no result. The NVIDIA call
gets a 60 s per-attempt budget clipped by that same deadline, so it cannot outlive
the scan either.
```

Key files:

| File | Role |
| --- | --- |
| `src/app/api/menu/scan/route.ts` | Route contract + error→HTTP mapping |
| `src/lib/menu-scan.ts` | Orchestration: upload, OCR under a shared deadline, quality retries, both Mistral extractors, the NVIDIA structurer, merge + validate, document cleanup, stage logs |
| `src/lib/ocr-quality.ts` | Pure deterministic gate that flags degraded OCR responses |
| `src/lib/menu-import.ts` | Pure pipeline: normalize (incl. Arabic-Indic digits) → sanitize → build → reconcile |
| `src/lib/menu-structure-llm.ts` | **server-only** NVIDIA NIM structurer: OCR markdown → the item/description/header/junk shape, under a 60 s-per-attempt budget; also owns the `NVIDIA_*` env reads and `hasLlmBackend()` |
| `src/lib/menu-validate.ts` | Pure (no `"server-only"`): the prompt contract (`MENU_STRUCTURE_RULES`), the defensive reply parser (`parseLlmJsonObject`) and the deterministic safety gate (`validateMenuImport` / `mergeStructuredMenu`) — kept pure so vitest pins the contract without a network or a key (see §8) |
| `src/lib/*.test.ts` — 9 files, 181 tests | The suite: `menu-import`, `menu-scan` (parser), `ocr-quality`, `menu-sync-guard`, `image-utils`, `order-utils`, `rate-limit`, `worker-auth`, `worker-permissions` |
| `src/lib/image-utils.ts` | `prepareUploadFile()` — client-side upload prep |
| `src/components/onboarding/menu-scan-dialog.tsx` | The scan dialog UI + error display |

Environment: `MISTRAL_API_KEY` (server-only) and optional `MISTRAL_OCR_MODEL`
(see `.env.example`). **Within Mistral, only the OCR endpoint is used — Mistral
chat completions are never called** (the current subscription rate-limits chat
completions with 429 code 1300 while the OCR quota is separate). Structure comes
from the OCR endpoint's built-in `document_annotation` (`json_schema`, strict).
The annotation prompt asks for TND and converts EUR/USD approximately
(1 € ≈ 3.4 DT, 1 $ ≈ 3.1 DT). The deterministic parser is blunter: a printed
`€`/`$` number is read at face value as dinars (`sanitizePrice`), and a currency
with no honest TND conversion (`£`, `¥`, `GBP`…) becomes `0` rather than a
fabricated price.

The **NVIDIA NIM structurer** is a separate provider, key and quota
(`NVIDIA_API_KEY` server-only, plus optional `NVIDIA_BASE_URL` / `NVIDIA_MODEL` —
see `.env.example`, and the entitlement trap below). It is the only stage that
reads the OCR text as a *card* rather than as lines: the rules in
`MENU_STRUCTURE_RULES` (`src/lib/menu-validate.ts`) classify every line as an
item, a description, a section header or junk, so a wrapped description stays
attached to the dish above it, a section header (`FOOD & DRINKS`) stops becoming
a "product", and the dietary legend / address / footer are recognised as
non-items. Rule 5 is the price contract the regex parser gets wrong: `1 200` is
1200 (a space between digit groups is a thousands separator), `4.500 DT` is 4.5
(three digits after the dot are millimes), and Arabic-Indic digits with the
Arabic separators `٫` (decimal) and `٬` (thousands) are understood. The validator
then re-normalizes every surviving price to millimes (a negative or non-finite
value floors to `0`). Prices remain in dinars, the unit the app uses everywhere.

Design decisions (do not casually undo):

- **Both Mistral extraction paths always run; the NVIDIA structurer is the third
  stage and does not replace them.** The annotation (an LLM) is stochastic and
  can under-extract; the deterministic parser always runs as a baseline. When the
  structurer is off or failed, `reconcileImports` unions the two (union of
  categories, product identity by normalized name with `name\0category`
  disambiguation for the same dish in two sections; parser price wins on
  disagreement; AI spelling wins on names) — that is the union that put 36 junk
  rows on the real café card. When the structurer answered, `mergeStructuredMenu`
  runs instead: its shape is kept and the parser is used purely as a completeness
  net — a *priced* row whose normalized name the structurer lacks is added, an
  un-priced one is a fragment and is not.
- **The NVIDIA structurer sets the shape; the validator sets the floor — the LLM
  is an enhancement, not a dependency.** Measured on a real photographed café
  card: the annotation + parser union produced **68 products, 36 of them
  junk** — wrapped description fragments split into separate "products", the
  section header `FOOD & DRINKS`, the three dietary-legend lines `V: Vegetarian`
  / `VG: Vegan` / `GF: Gluten Free`, and the address/phone line, which imported
  as a product priced `9999`). With the structurer answering, the same card
  yields **32 products, all 32 priced, zero junk**, descriptions attached to
  their items — and the validator had **nothing to remove** (`dropped=0`; that
  run's LLM call took 42.5 s). The property that matters most: when the same
  run's LLM call *failed* (one sample
  timed out at the 60 s budget), the pipeline fell back to annotation + parser and
  the validator removed **35 junk rows on its own**, producing the *same* 32
  products, all priced, zero junk. So a scan must never fail because the LLM is
  down: `structureMenuWithLlm` returns a typed outcome instead of throwing, and a
  missing key, an outage, a timeout or a malformed reply all degrade to the path
  that already existed. It retries **at most once** (only on a malformed reply,
  and only if the scan budget still allows), and every call sits inside a
  wall-clock deadline so the stage cannot outlive the scan.
- **Be honest about the cost — the pass is slow.** The LLM answers in roughly
  15–45 s and occasionally exceeds 60 s and times out; a scan with a working LLM
  call took ~45–62 s end to end, while a scan with **no** `NVIDIA_API_KEY`
  configured stays as fast as before (~10 s of OCR plus parsing). The structurer
  is optional by design: faster without it, cleaner with it.
- **Model entitlement is per account, not per model list.** NVIDIA's NIM model
  list is public and lists **81 models**, but access is granted per account: a
  probe with this key found only **5 of the 81 callable**, every other answering
  HTTP 404 `Function '<uuid>': Not found for account` (the usable five were
  `meta/llama-3.2-11b-vision-instruct`, `openai/gpt-oss-20b`,
  `nvidia/nemotron-3.5-lightning-30b-a3b`, `meta/muse-glimmer-30b`,
  `nvidia/nemotron-3-super-120b-a12b`). Of those, only
  `meta/llama-3.2-11b-vision-instruct` was good — 15 s at benchmark, valid JSON,
  20/20 priced, zero junk; the rest took 41–91 s and returned reasoning prose
  instead of JSON. That is why it is the default `NVIDIA_MODEL`. The model is
  also **stochastic even at `temperature: 0`**: the same prompt on the same
  captured OCR output captured a section on one run and dropped it on another.
  That is why the deterministic validator exists, and why a one-off scan result is
  never "fixed" by trusting a single run — reproduce before changing anything.
- **Quality gate before annotation/parser.** `assessOcrQuality` flags responses
  that are near-empty (`EMPTY_TEXT`), have no items (`NO_ITEMS`), carry several
  item lines with no heading and **not a single price** (`NO_STRUCTURE`), or end
  mid-section (`TRUNCATED`). It is purely structural — a real 1-category /
  2-product menu passes, and a headingless price board passes too, because its
  prices give it shape. A degraded response is re-OCR'd up to
  `OCR_QUALITY_ATTEMPTS` (3) on the same file, and the fittest attempt is then
  **used** rather than discarded — the parser's catch-all section can structure a
  headingless price board, so throwing away three paid OCR calls to return
  nothing would be worse. `OCR_FAILED` is reserved for a response with no pages
  at all, or one where no attempt was usable. Never import garbage silently.
- **Never hard-code the restaurant or a category count.** The tests use generic
  menus, not "Café Aziz".
- **The provider is not allowed to hang the request, and does not keep the
  photos.** Every provider call is aborted on a per-attempt timeout and on the
  scan deadline; a 429 is retried 3× and a transport failure 6× (backoff capped
  at 6 s). Uploaded documents are `DELETE`d in a `finally`, best effort — a failed
  cleanup is logged and never changes the scan's outcome, but without it every
  scan would permanently retain the owner's menu photographs.
- **A rejected key is not a missing key.** Mistral answering `401`/`403` becomes
  `PROVIDER_AUTH` (an operations incident, 503) rather than `NO_KEY`; telling an
  owner to configure a key that is already configured sends them the wrong way.
- **Pure logic lives in modules free of `"server-only"` and React** so vitest can
  import them. `menu-scan.ts` *is* `"server-only"`, and still unit-tested: its
  test mocks `server-only` and exercises the exported parser directly.

The dialog knows one union of codes: the route's `{ ok: false, error }` values,
two that never reach the network because client-side image prep raises them, and
`UNKNOWN` as the fallback for anything unexpected.

| error | HTTP | Raised by | Meaning | UI message |
| --- | --- | --- | --- | --- |
| `NO_BACKEND` | 503 | route | Supabase env vars missing — there is no database at all | ms_error_NO_BACKEND |
| `UNAUTHORIZED` | 401 | route | no/expired owner session (scanning is owner-only) | ms_error_UNAUTHORIZED |
| `BAD_BODY` | 400 | route | the multipart body could not be parsed | ms_error_BAD_BODY |
| `TOO_MANY_FILES` | 400 | route + lib | 0 files, or more than 6 | ms_error_TOO_MANY_FILES |
| `FILE_TOO_LARGE` | 413 | route + lib | one file over 12 MB, or the running total over 6 × 12 MB | ms_error_FILE_TOO_LARGE |
| `BAD_TYPE` | 422 | lib (+ dialog) | not an image or PDF | ms_error_BAD_TYPE |
| `BAD_IMAGE` | — | client `prepareUploadFile` | the image could not be decoded/re-encoded in this browser | ms_error_BAD_IMAGE |
| `HEIC` | — | client `prepareUploadFile` | a HEIC/HEIF photo this browser cannot decode (needs Safari) | ms_error_HEIC |
| `NO_KEY` | 503 | lib + route | `MISTRAL_API_KEY` is not configured | ms_error_NO_KEY |
| `PROVIDER_AUTH` | 503 | lib | Mistral answered 401/403: the key is revoked, expired or plan-limited | ms_error_PROVIDER_AUTH |
| `UPLOAD_FAILED` | 502 | lib | `/v1/files` failed, or returned no file id | ms_error_OCR_FAILED |
| `OCR_FAILED` | 502 | lib | OCR returned no pages, or nothing usable survived the retries | ms_error_OCR_FAILED |
| `NETWORK` | 502 | lib | `api.mistral.ai` unreachable/timed out, or the scan budget ran out | ms_error_NETWORK |
| `RATE_LIMITED` | 429 | route + lib | the per-IP limiter (10/min, sends `Retry-After`) or a Mistral 429 after 3 attempts | ms_error_RATE_LIMITED |
| `EMPTY` | 422 | lib | reconciliation produced zero dishes/drinks | ms_error_EMPTY |
| `UNKNOWN` | 500 | route | a non-`MenuScanError` escaped the route; `detail` carries the raw exception | ms_error_generic |

`BAD_IMAGE` and `HEIC` are client-side: the dialog maps `ImagePrepareError.code`
through the same `ERROR_MSG_KEY`, so they have no HTTP status. The `STATUS` map
in `route.ts` still carries `INVALID_MODEL_RESPONSE` and `INVALID_JSON` (both
422) from an earlier revision — no code path raises either today.

The NVIDIA structurer adds **no new error code and no new failure mode**. Its
failures are internal log lines (`STRUCTURE LLM ok:false reason=…`), never a
`MenuScanError` and never anything the dialog can show: only the Mistral/OCR path
can fail a scan, and the structurer can only make the result better. That is the
whole point of the fallback — a `NO_KEY`, an outage or a timeout must be
invisible to the owner.

Messages live in `src/lib/i18n.tsx` (EN/FR/AR) under `ms_error_*`; the dialog maps
codes via `ERROR_MSG_KEY` in `menu-scan-dialog.tsx` and falls back to
`ms_error_generic` for a code it does not know. Add a key to all three locales
when you add a code, and register the code in all four places listed in §8.

---

## 7. Troubleshooting — every issue we hit and its fix

> All scanner traces (stage logs, no secrets) go to the **server console** and
> `.dev.log` / `.dev.err.log` in the project root (git-ignored). Grep
> `.dev.log` for `FINAL ... categories= aiItems= parserItems= llmItems=` to see
> exactly what happened on a scan, `STRUCTURE LLM` for the NVIDIA stage (its
> `ok`, `reason`, `model` and `ms`), and `VALIDATE` for every row the gate
> removed and why.

1. **"Scan gives only 1 category (or catches all 4 only once in a while)".**
   Cause: the old client code downscaled every image to max **800px JPEG q0.82**
   (`1131×1600 → 566×800`). With such a small re-encode, Mistral returns full
   markdown but its **annotation comes back `{"categories":[]}`** (~5/6 runs),
   so the fallback parser alone collapses the result. Fix (done):
   `prepareUploadFile` returns a PNG/JPEG/WebP **unchanged** when its longest side
   is ≤ 2048 px *and* it is ≤ 12 MB; anything else (over 2048 px, over the size
   cap, or a format the provider does not read) is re-encoded to JPEG at q0.9 —
   the old always-800px/q0.82 collapse is gone. Verified 10/10 scans return the
   full 4 categories / 20 products. The modern signature of the same failure is
   an empty AI extraction next to healthy markdown — check the `STRUCTURE SKIP` /
   `STRUCTURE NO CATEGORIES` lines and the `FINAL ... aiItems=` count.

2. **Spurious `TypeError: fetch failed` / `ETIMEDOUT` calling `api.mistral.ai`**
   (bare `node -e fetch()` fails almost always, `curl.exe` usually works, the
   Next.js route sometimes fails uploads 6× in a row). This machine's route to
   Mistral is **intermittently dead at the TCP layer and `api.mistral.ai`
   resolves to unreachable IPv6 addresses** — Node's undici does no Happy
   Eyeballs. Mitigations applied: `dns.setDefaultResultOrder("ipv4first")` at the
   top of `menu-scan.ts`, network retry loop in `postWithRetry` (6 attempts,
   backoff capped at 6s), `429` retried up to 3×, and a **typed `NETWORK` error**
   instead of leaking a raw `TypeError` as `UNKNOWN`. When testing locally,
   always call the running app route (`POST localhost:3000/api/menu/scan`),
   never a standalone fetch script.

3. **Single 1-category run in mid-dev.** Was a transient **degraded OCR**: HTTP
   200 but only ~3 markdown lines, no headings. Now caught by the quality gate:
   the response is re-OCR'd up to 3×, and if every attempt stays structurally
   imperfect the fittest one is used anyway (`OCR QUALITY DEGRADED ACCEPT`) — a
   headingless price board is still importable, so this no longer ends in
   `OCR_FAILED`. `OCR_FAILED` is now reserved for a response with no pages and
   no annotation, or one where no attempt produced anything usable.

4. **`Mistral /v1/ocr → 400` "File could not be found or may have expired"**
   (code 3310). Mistral file-cache race/expiry on a repeat OCR of the same
   `file_id`. Transient; a retry of the request succeeds. The retry/backoff loop
   covers it. If it becomes common, re-upload the document on `3310`.

5. **`POST /api/menu/scan` 500 `UNKNOWN`.** Any non-`MenuScanError` escaping the
   route. Should no longer happen for transport failures (fixed with NETWORK);
   if you see one again, the `detail` is the real exception — investigate, don't
   ignore.

6. **`/login` returns 404.** Intended: this app has no `/login` page. The
   landing page is `/`, sign-in is `/auth/login`, and `/onboarding` redirects
   anonymous visitors to `/auth/signup?next=/onboarding` (the wizard writes to
   the owner's restaurant, so it needs a session).

7. **Port 3000 not answering after edits.** The dev server can die silently.
   Restart with logging:
   `Start-Process cmd -ArgumentList '/c','npm run dev > .dev.log 2> .dev.err.log'`,
   then check `Get-NetTCPConnection -LocalPort 3000 -State Listen`.

8. **`next lint` prints a deprecation warning.** Next 15 still runs ESLint 8;
   the warning is expected. `npm run typecheck`, `npm run test` and `npm run
   lint` all run clean (181 vitest tests in 9 files), and `npm run check` runs
   all three in one go.

9. **ngrok is only needed to expose the dev server** (webhooks / real phone).
   The scanner itself needs no tunnel: browser → `localhost:3000` → Mistral OCR,
   then optionally NVIDIA NIM.

10. **A scan with the structurer is slow, or logs `STRUCTURE LLM ok:false
    reason:TIMEOUT`.** Expected, not a bug. The NVIDIA call runs in its own
    60 s budget (clipped by the scan's 110 s), so a scan with a working LLM call
    takes ~45–62 s end to end; `structureMenuWithLlm` answers in roughly 15–45 s
    and its default model occasionally needs longer than 60 s. A timeout is a
    *soft* failure: the pipeline falls back to annotation + parser and the
    validator still yields a clean menu (§6), so the scan result is fine — only
    the wall time differs. If you want the faster path back, unset
    `NVIDIA_API_KEY`. Two related traps when you do keep it on:
    - **A 404 `Function '<uuid>': Not found for account` is not a broken URL.**
      It means the account is not entitled to that `NVIDIA_MODEL`; NVIDIA's
      public list has 81 models but only a handful are callable per account
      (§6). Stick with the default unless you have re-probed.
    - **Never "fix" a scan by trusting one run.** The model is stochastic even at
      `temperature: 0` — it caught a section on one run and dropped it on the
      next over identical input. Compare the `VALIDATE` / `FINAL` lines across
      two or three scans before concluding anything changed.

---

## 8. For the next developer — getting up to speed fast

- **Run it:** `npm ci`, `cp .env.example .env.local` (fill Supabase keys +
  a real `MISTRAL_API_KEY` — `NVIDIA_API_KEY` is optional and only improves menu
  structuring, see §6), `npm run dev` → http://localhost:3000.
- **Verify a scan end-to-end without the UI:** grab your `sufra_owner_session`
  cookie from the browser (devtools → Application → Cookies) and post a real
  photo or PDF to the live route — the route is owner-only, so a bare request
  answers `401 UNAUTHORIZED`:

  ```powershell
  curl.exe -s -X POST http://localhost:3000/api/menu/scan `
    -H "Cookie: sufra_owner_session=<paste from devtools>" `
    -F "files=@menu.jpg" -F "venue=<your restaurant name>"
  ```

  Watch `.dev.log` for `OCR QUALITY`, `NETWORK RETRY`, `OCR RESPONSE PARSE`,
  `STRUCTURE LLM`, `VALIDATE`, `FINAL`. There is no checked-in probe script (the
  old one lived in a machine-specific temp directory) — the reproducible
  artifacts are this curl and the SQL suite at
  `supabase/tests/schema_smoke.sql`; `docs/RUNBOOK.md` §6 is the full end-to-end
  checklist.
- **Real menu fixtures used during development** (kept outside the repo because
  they're user photos): `Downloads\1131w-vQnxH5Nxwgc.webp` is **the production
  menu** — 4 categories **Coffee / Non Coffee / Pastries / Add-ons**, 20
  products (dollar prices). `cafe-menu-photo.png` is a *different* 3-category
  fixture (Coffees / Salades / Sandwiches) — do not confuse the two. If a scan
  "regresses to 3 categories", it's using the wrong photo.
- **Unit tests:** `npm test` (`vitest run`) — **181 tests across 9 files** in
  `src/lib/`: `menu-import`, `menu-scan` (parser), `ocr-quality`, `menu-sync-guard`,
  `image-utils`, `order-utils`, `rate-limit`, `worker-auth`, `worker-permissions`.
  Keep them green; they encode the reconcile + sanitize + quality-gate rules.
  `npm run check` runs typecheck + lint + test together.
- **If you touch an error code**, register it in all four places, or it will
  render as the generic message: the `ScanErrorCode` union in
  `src/lib/menu-scan.ts` **and** the `MenuScanError` you throw there; the
  `STATUS` map in `src/app/api/menu/scan/route.ts` (plus `errorFromStatus` if the
  code derives from a provider HTTP status); `ERROR_MSG_KEY` in
  `src/components/onboarding/menu-scan-dialog.tsx`; and the `ms_error_*` keys in
  all three locales of `src/lib/i18n.tsx`. A code with no `ERROR_MSG_KEY` entry
  silently falls back to `ms_error_generic` — which is how the two dead `STATUS`
  entries (`INVALID_MODEL_RESPONSE`, `INVALID_JSON`) have stayed invisible.
- **If you change OCR tuning**, look at `OCR_QUALITY_ATTEMPTS`,
  `MAX_PAGES_PER_FILE`, and `ocr-quality.ts` thresholds
  (`MIN_NON_WS_CHARS=8`, `MIN_ITEMS_FOR_STRUCTURE=3`).
- **If you change the NVIDIA structurer**, know the split: the *non-deterministic*
  half (the request, the retry, the deadline) lives in the `"server-only"`
  `src/lib/menu-structure-llm.ts`; the *pure* half (the prompt rules
  `MENU_STRUCTURE_RULES`, the reply parser `parseLlmJsonObject`, and the gate
  `validateMenuImport` / `mergeStructuredMenu`) lives in `src/lib/menu-validate.ts`
  precisely so vitest can pin it without a network or a key — that is why the
  measured contract (15 s, 20/20 priced, zero junk) cannot drift. The knobs:
  `NVIDIA_MODEL` (env), `LLM_TIMEOUT_MS` (60 s/attempt), `MAX_INPUT_CHARS`
  (30 000) and `MAX_TOKENS` (4096). Adding a price or classification rule means
  editing `MENU_STRUCTURE_RULES` **and** its unit test together. Do **not** try to
  make the gate "smarter" by trusting the model more: the model is stochastic even
  at `temperature: 0` (§6), and the validator is what makes the result
  reproducible.
- **Product reality to respect:** owner is building a Tunisian café menu; prices
  in scanner annotations arrive in TND by design. Do **not** hard-code the
  restaurant name, the 4 categories, or any fixture file into the pipeline — the
  tests will (rightly) call that out.
- **The 1-category bug has cost real time — before "fixing" a scan result again,
  reproduce with the actual user photo through the live route and read the
  `FINAL` line.**
- **If you touch the schema or a migration**, run `supabase/tests/schema_smoke.sql`
  afterwards (see §4) — it asserts the contracts the routes depend on, and CI
  applies the whole chain plus that suite on PostgreSQL 16.

---

## 9. Audit deliverables — where the diagnosis lives

The repository carries the full audit that produced this fix pass. Read it before
changing behaviour that looks odd; most of the oddity is deliberate.

| Artifact | What it is |
| --- | --- |
| `docs/AUDIT.md` | The consolidated index: executive summary, the ordered critical path, the cross-slice dedup, and the corrections to the three earlier reports. |
| `docs/audit/01-database.md` … `07-ocr-pipeline.md` | The seven per-slice reports (database, API routes, frontend, lib, infra, i18n, OCR), each with finding IDs and the code citation behind every claim. |
| `docs/INTENT.md` | The product reconstructed from the code: actors, feature inventory, the intended journey, and what "it works" means to the owner. |
| `docs/RUNBOOK.md` | The **current** operator guide: prerequisites, config, the SQL tracks (§4), running the app, and the end-to-end checklist (§6). Start here on a fresh machine. |
| `docs/diagrams/` | Three Mermaid diagrams — architecture, order lifecycle, scan pipeline — with `README.md` explaining how to render them. |
| `docs/FINDINGS.tsv` | Machine-readable index of every finding (`id, severity, slice, component, summary, source_report`), for grep/automation. |

One caveat so the two kinds of document are not confused: `docs/AUDIT.md`,
`docs/audit/*` and `docs/diagrams/*` describe the tree **as it was handed over**
(branch `rag-option` @ `3b8ad43`, 141 findings) — several of their Critical and
High findings have since been fixed in this tree, so treat them as the diagnosis
and the finding IDs, not as a description of current behaviour. `docs/RUNBOOK.md`
and this README describe the tree you are holding.