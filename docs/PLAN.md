# Sufra — The Plan to a First Paying Customer

**Who this is for:** the owner of this project, who built a QR-menu and table-ordering app for a
café and wants one real café to use it with real customers.

**What this document is:** the forward-looking roadmap. It says what is already proven, what is
only written, and in what order to close the gap. It deliberately does **not** propose new product
features — the product is already ambitious enough. Everything here is about making the thing that
exists *reachable*.

**Three other documents you will need, and when:**

| Document | Read it for |
|---|---|
| `docs/RUNBOOK.md` | The step-by-step operator instructions. This plan points into it rather than repeating it. |
| `docs/INTENT.md` | What the app was trying to be, and the "three levels of it works" (its §7). |
| `docs/AUDIT.md` + `docs/FINDINGS.tsv` | The 141 original findings, with per-slice detail in `docs/audit/01..07`. |

**Jargon, defined once.** *Migration* — a numbered `.sql` file that changes the shape of the
database. *RLS (Row Level Security)* — Postgres rules restricting which rows a caller may see; this
app has no browser-side database client, so RLS is defence-in-depth only. *Service role* — a
Supabase key that bypasses RLS entirely; it is server-only and must never reach a browser.
*Tunnel* — `ngrok`, which gives your laptop a temporary public HTTPS address so a phone can reach
it. *Idempotent* — doing the same request twice has the same effect as doing it once.
*Standalone* — Next.js's self-contained production server bundle (`npm run start:standalone`).

> **Status warning.** Parts of `docs/INTENT.md` and `docs/AUDIT.md` describe the repository **before**
> the remediation pass and are now out of date on status (they still say "nothing is saved", "the
> worker order path is 100 % broken", "`npm ci` fails", "`docker build` fails", "`/api/health` does
> not exist"). `README.md` and `docs/RUNBOOK.md` describe the tree you are holding. Where this plan
> disagrees with `INTENT.md`/`AUDIT.md` about **status**, this plan is the newer reading, and every
> claim in it was re-read in the source tree.

---

## 1. The goal, stated as a test

The north star is not "the features are finished". It is:

> **A real café can use this with real paying customers.**

That is too vague to be useful, so here is the falsifiable version. Call it **the acceptance test**:

> **The minimum working version is reached when, against a REAL Supabase project (not a scratch
> database, not `localStorage`), one person can do all of the following in one sitting:**
>
> 1. **Owner** — sign up at `/auth/signup`, build a menu in `/onboarding`, publish it, and download a
>    QR code for a table.
> 2. **Guest** — scan that QR code with a phone, add a dish to the cart and place the order.
> 3. **Worker** — accept an invite, place a manual (walk-in) order, accept it, and mark an order paid
>    on the board.
>
> **…and the order from step 2 appears on the board in step 3.**

This is one sentence because it is one chain: break any link and a café cannot serve a customer.

**Status of the acceptance test: NOT YET RUN end to end, on any database.** The application now
builds, boots, and serves every page (see §2), and the schema chain has been executed against a real
PostgreSQL 17 — but never against a *real Supabase project*, and no human has walked the three steps
above in one sitting. That gap is what §3 closes.

Everything else in this plan is either preparation for that test, honest measurement that cannot be
replaced by reading code (OCR, §5), or hardening that a first customer will eventually trip over
(§6, §7).

---

## 2. Status right now — proven vs merely written

This section exists to stop you from over-trusting the work. The distinction is **how** something
was established:

- **Proven** — something was *executed* and its output observed: a gate ran, SQL ran against a real
  database, or a server was started and probed over HTTP.
- **Written** — the code or SQL exists and reads correctly, and nothing has ever run it.

### 2.1 Proven by execution

| Claim | How it was proven |
|---|---|
| The TypeScript compiles | Green gate: `npx tsc --noEmit` → 0 errors |
| The unit suite passes | Green gate: `npx vitest run` → **181/181 passing across 9 files** (was 124/7) |
| Lint is clean | Green gate: `npx next lint` → no warnings or errors |
| The production build works | Green gate: `npx next build` → clean, **38 routes** |
| The app runs and every route answers | A production **standalone** build was started and probed over real HTTP: every page returned 200, `/nope` returned the branded 404, `/onboarding` → `307 /auth/signup?next=/onboarding`, `/dashboard` → `307 /auth/login`, `/worker/dashboard` is server-guarded, and the server log held **zero server-side errors**. No Supabase credential existed at the time, so this proves routing, guards and error boundaries — **not any data path**. |
| The container image builds | `docker build` succeeds (it previously failed hard at `COPY /app/public`) |
| Dependencies install reproducibly | `npm ci` works (the lockfile was missing `vitest` and its whole tree, so CI had never actually run) |
| The database schema is valid SQL | The whole chain `0001 → 1002 → 1003 → 1004` was executed against a **real PostgreSQL 17** (the `supabase/postgres` image) with `ON_ERROR_STOP=1`: it applies with no errors |
| The schema honours the contracts the app depends on | `supabase/tests/schema_smoke.sql` runs **34 contract assertions** — including the three legacy blockers (worker creation, the `order_items` price trigger, the `orders` ticket trigger), FK-backed embeds, uniqueness, CHECKs, `client_ref` idempotency and the `menu-images` bucket — **all passing**, inside one transaction that `ROLLBACK`s, so it leaves zero rows behind |
| Arabic gets RTL on first paint | Verified live: an `ar-TN` phone receives `<html lang="ar" dir="rtl">` **and** an Arabic page title in the server HTML (previously English LTR until hydration, plus a hydration error) |

**One more claim is "verified" but is not an execution:** 110 of the 141 original findings are
closed. That was established by re-reading each fix in the source tree — a code read, not a command.
The 31 that remain open or partial are enumerated in §6.

### 2.2 Written, and never executed

| Claim | Why it is not proven |
|---|---|
| The app works against a real Supabase project | **No live database has ever been exercised against this code.** There was no valid Supabase credential and the original developer's project keys were unavailable. Everything database-side is "SQL against a scratch Postgres", not "a running app against a real project". |
| The migration track for the **legacy** database | `1003_live_db_repair.sql` has only ever run on a scratch database. The headline promise — "drops the two rogue triggers that broke worker orders and ticket numbering" — is unverified against the database that actually has those triggers. |
| OCR accuracy | **Never measured.** No `MISTRAL_API_KEY` existed, so **no scan has ever been executed**. The OCR audit is a static + unit-level review; its price truth table came from executing the pure functions on constructed strings, not from reading real provider output. The `document_annotation` wire shape is an inference. |
| The owner, guest and worker flows in a real browser | There is **no browser automation and no end-to-end test**. Nothing has been clicked against a real backend. |
| Load, soak and memory behaviour | Never measured. No concurrency run, no memory profile. |
| The rate limiter in production | The code was read; the limiter was never hammered, and its `X-Forwarded-For` trust assumption (§7) has never met a real edge proxy. |
| `npm run db:push` | Never executed. The Supabase CLI must be installed globally, the project linked, and it must accept this repo's 4-digit migration filenames — none of which has been tried. |
| The **container** at runtime | `docker build` succeeds; the image has never been *run* and probed in CI. (`npm run start:standalone` was probed, which is a different artefact.) |
| Email delivery (`/auth/forgot` → reset link) | Depends on the Supabase project's SMTP configuration, which has never been inspected. |
| The 181 tests as a safety net | Real, but mostly pure-logic tests. There are **no browser/E2E tests**; treat the manual script in §4 as the real acceptance suite. |

**The one line to remember:** *the app is proven to run; it is not proven to work.* Running and
working are separated by one thing — a real database — and that is Phase 0.

---

## 3. Phase 0 — Stand up a real backend

**Nothing is blocked on code. This phase is the whole critical path.** It is manual, it takes about
an hour, and it unblocks every other phase. Do it in this order and do not skip the verification.

### 0.1 Create or choose the Supabase project

1. Sign in at <https://supabase.com> → **New project**. Pick a name (e.g. `sufra-prod`), a strong
   database password (**save it in a password manager — you cannot recover it from here**), and the
   region closest to Tunisia (Frankfurt or Paris).
2. Wait ~2 minutes for provisioning.
3. Open **Project Settings → API** and copy two values:
   - **Project URL** → goes into `NEXT_PUBLIC_SUPABASE_URL`
   - **`service_role` secret** → goes into `SUPABASE_SERVICE_ROLE_KEY`
     *(not the `anon` key — the `anon` key is useless here, because the browser never talks to
     Supabase directly in this app)*

> **Write the project ref down.** The URL looks like `https://abcdefgh.supabase.co`; `abcdefgh` is the
> ref, and you will need it for the connection string in step 0.4.

### 0.2 Fill in `.env.local`

`.env.local` is gitignored (`.gitignore:27`), so secrets here never get committed.

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Fill in exactly these, and leave everything else as shipped:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your-service-role-key...
MISTRAL_API_KEY=your-mistral-key
MISTRAL_OCR_MODEL=mistral-ocr-latest
# NEXT_PUBLIC_APP_URL=          <- LEAVE THIS COMMENTED OUT
```

Three traps, all of which have bitten this repo:

- **Leave `NEXT_PUBLIC_APP_URL` commented out.** When unset, QR codes, worker invites and
  password-reset links are derived from the origin the request actually came through. If you pin it
  to `http://localhost:3000`, every QR code you print points at *the phone's own* localhost and
  scanning does nothing.
- **Never set `NODE_ENV` in `.env.local`.** Next.js manages it. Setting it to `production` locally
  makes the session cookies `secure`, a plain-HTTP browser then drops them, and you appear to be
  logged out on every request.
- **Restart the dev server after any change to this file.** Next.js reads it only at boot. This is the
  single most common cause of "but I just set that".

`MISTRAL_API_KEY` is only needed for the OCR scan (§5). Everything else works without it.

### 0.3 Decide fresh vs legacy, and run the right migration track

Answer one question: **does this database already contain the original developer's tables?** Full
tracks are in `docs/RUNBOOK.md` §4.1 and §4A/§4B/§4C; the short form:

| Situation | Track | Files to run, in this exact order |
|---|---|---|
| **A brand-new Supabase project** (recommended for the first customer) | **A** | `0001_init_schema.sql` → `1002_production_readiness.sql` → `1004_session_hardening.sql` |
| The original developer's live database (`public.restaurants` already exists) | **B** | `0001` → `1002` → **`1003_live_db_repair.sql`** → `1004` |
| A local Supabase stack (`supabase start`) | **C** | same as A — the local stack starts empty |

**Order matters and is not negotiable.** `1002` is an *incremental* patch: it assumes the eight base
tables already exist, and its first statement fails with `42P01 undefined_table` on an empty
database. Running `0001` first is safe on an existing database too (it uses `CREATE TABLE IF NOT
EXISTS` and `DROP … IF EXISTS`).

**`0001` and `1002` now agree on the day boundary.** The base schema's counter default
(`0001_init_schema.sql:197`) and the `sufra_next_order_number` RPC (`:408`) both use
`(now() AT TIME ZONE 'UTC')::date`, matching `1002_production_readiness.sql`. `0001` previously used
the session-local `CURRENT_DATE`, which reintroduced the `DB-08` day-boundary bug on any database
where only `0001` had been run; the two files no longer disagree. The order above still matters for
the separate reason given — `1002` is incremental and assumes `0001`'s tables already exist.

**Recommended for the first customer: Track A.** A legacy database inherits hand-made triggers and
missing constraints that this repository was never written against (`1003` repairs them, but `1003`
has never been run against a real Supabase project — see §2.2). Start clean, and only migrate the
legacy data if it holds orders you actually need.

**Applying them, hosted (Track A or B):** for each file, open **SQL Editor → New query**, paste the
**entire** file, press **Run**. Each file is submitted as one implicit transaction, so a single error
rolls back the whole file. Expected: `Success. No rows returned` (the files end with `DO` blocks that
emit `NOTICE` lines — expand the notices panel and actually read them).

**Or with the Supabase CLI** (needs the CLI installed globally — the repo has no dependency on it):

```powershell
supabase login
supabase link --project-ref abcdefgh
npm run db:push
```

`db:push` has never been executed in this repo; it must accept the 4-digit migration filenames, which
is unproven (finding `INFRA-09`). If it complains, use the SQL-editor path above.

On **Track B**, read every `VERIFY OK` / `VERIFY FAIL` line `1003` prints. Any `VERIFY FAIL` is
actionable and names the object. Do not skip `1003` on a legacy database: `0001` and `1002` add what
is missing, but neither removes what is already there.

### 0.4 Verify the schema with the §4A verification SQL

Run all five queries from `docs/RUNBOOK.md` §4A step 4 (or paste the block below). This is what tells
you the migration actually landed, rather than merely parsed.

> **Eight, not nine.** `0001_init_schema.sql` creates **nine** relations, but the ninth is
> `public.sufra_daily_counters` — the helper table that makes daily ticket numbers atomic. The query
> below checks the **eight application tables**, which is why it expects 8 rows. `docs/RUNBOOK.md`
> calls them "the eight base tables"; some summaries of this project call it "all 9 tables". Both
> are right about different things: 8 app tables + 1 helper.


```sql
-- 1. All eight app tables exist. Expect 8 rows.
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

-- 3. The unique constraints the app's .single() lookups depend on. Expect 5 rows.
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

-- 5. No leftover permissive policies. Expect only the *_owner_all policies.
--    A row with USING (true) here is a security hole.
SELECT tablename, policyname, permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 0.5 Run the schema contract suite against the real project (optional, safe)

`supabase/tests/schema_smoke.sql` asserts the *contracts the code depends on*, not merely that the
SQL parsed. It is worth one run on the real project.

```powershell
# Connection string: Supabase dashboard → Project Settings → Database → Connection string → URI
$env:DATABASE_URL = "postgresql://postgres:<your-db-password>@db.abcdefgh.supabase.co:5432/postgres"

# NOTE: do NOT run supabase/tests/_shim_storage.sql here. The shim creates test-only
# auth/storage stand-ins for plain Postgres and says explicitly it must never be run
# against a Supabase project. Those schemas already exist there.
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/schema_smoke.sql
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

> **Residue — the thing to check.** The suite runs entirely inside **one transaction closed with
> `ROLLBACK`** (`supabase/tests/schema_smoke.sql:26,376-378`), so every fixture it inserts (a
> restaurant slugged `cafe-smoke`, its category, product, table, order, items, worker, invite and a
> daily-counter bump) is undone and **no row is left behind**. It is therefore safe to run against
> your live project and safe to run repeatedly. *Prove it*, don't trust it:
>
> ```sql
> SELECT count(*) FROM public.restaurants WHERE slug = 'cafe-smoke';   -- must be 0
> ```
>
> A leftover `cafe-smoke` row would break first-run signup, because the ownership bind only
> auto-claims an unowned restaurant when it is the *only* row.
>
> **The one caveat:** if a check raises, the transaction aborts **and stays open**, leaving your
> `psql` session in a failed transaction — `psql` will refuse further statements. Run `ROLLBACK;`
> (or reconnect) before doing anything else.

### 0.6 Confirm the app can reach the backend

```powershell
npm run dev
```

Then, in a second terminal:

```powershell
curl.exe -s http://localhost:3000/api/health
curl.exe -s http://localhost:3000/api/auth/session
```

Expected:

```json
{"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}
{"cloud":true,"user":null}
```

`"backend":false` means the Supabase pair is wrong **or** the server was not restarted after you
edited `.env.local`. `"ocr":false` means `MISTRAL_API_KEY` is missing — that blocks only §5, not
Phase 1.

> **Degraded-mode trap.** With no Supabase pair the app does not crash; it renders, the wizard works,
> and everything saves to `localStorage`. It *looks* like a working app with no data
> (`docs/RUNBOOK.md` §3.1). If anything looks empty, check `/api/health` → `"backend"` **before** you
> debug anything else.

**Phase 0 is complete when:** `/api/health` reports `"backend":true`, the five verification queries
return their expected rows, and `SELECT count(*) FROM public.restaurants WHERE slug = 'cafe-smoke'`
is 0.

---

## 4. Phase 1 — Walk the three levels of "it works" manually

There is no automated end-to-end test, so **this section is the acceptance suite**. Run it in order,
on a configured app, against the real project. The step-by-step operator version with full
descriptions is `docs/RUNBOOK.md` §6; this is the same walk with the *diagnostics* attached.

**Before you start:** `/api/health` must report `"backend":true`. Set the dev server to log to a file
so you can read it afterwards:

```powershell
# PowerShell
Start-Process cmd -ArgumentList '/c','npm run dev > .dev.log 2> .dev.err.log'
```

```bash
# bash
npm run dev > .dev.log 2> .dev.err.log
```

Both files are gitignored. The two log markers worth grepping are `[menu-scan]` (OCR stage lines) and
`[sufra]` (the dev-switch warnings, session-revoke failures). Everything else you need is in the
**browser's Network tab**: read the JSON *response body* of the failing request — every route answers
with `{"ok":false,"error":"<CODE>", ...}`, and that code is the real diagnosis.

### 4 (a) Owner — build, publish, print

| # | Do | Expected | Server log to watch | SQL if it fails |
|---|---|---|---|---|
| a1 | Open <http://localhost:3000/auth/signup>, fill **Email**, **Password** (≥8 chars), optional **Name** → **Create account** | Redirect to `/dashboard` (signup signs you in; no email confirmation) | nothing | `SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;` |
| a2 | Go to `/onboarding` (the landing page's **Open the Platform** button, or `/auth/signup?next=/onboarding`) and complete the five steps: **Identity → Branding → Categories → Products → Live Preview** | The stepper ticks off each step. **Continue** stays disabled until step 1 has a name and step 3 has a category. On step 5, **Finish Setup** saves first and only then shows *"Setup complete!"* | nothing | — |
| a3 | Watch the save badge in the top bar | **"All changes saved"** — the only text that means success. "Saved locally" / "Sign in to save your menu" / "Sync failed" each mean it did **not** reach the database; "Sync failed" carries the server's reason | nothing | `SELECT name, slug, is_published FROM public.restaurants;` → 1 row, `is_published = true` |
| a4 | Add a photo to a product (or use `/dashboard/menu` → **Add Product**) | The image appears; no `data:` URL ever stored | nothing | `SELECT count(*) FROM public.products;` ≥ 1 |
| a5 | `/dashboard/tables` → set **Tables** (1–40) → **Generate Tables** → **Download All** | One card per table, each with a QR image and a URL of the shape `${origin}/menu/${slug}/${token}`. The print/download controls are **disabled while unsaved** | nothing | `SELECT table_number, qr_token FROM public.restaurant_tables ORDER BY table_number;` and `SELECT slug FROM public.restaurants;` — the slug in the URL **must equal** the stored slug, character for character |
| a6 | Open the QR URL in a second browser window (desktop is fine for this step) | The guest menu renders with a *"Dine-in · Table N"* badge, a search box, category pills and an **Add** button | nothing | If it 404s: both halves must match — a `restaurants` row with that exact `slug` **and** a `restaurant_tables` row with that exact `qr_token` for that restaurant. A *"This menu isn't live yet"* page instead of a 404 means there is no Supabase config at all. |

**Step a3 is the load-bearing step.** Everything after it depends on exactly one `PUT /api/menu`
having succeeded. Read the badge before you believe the wizard.

### 4 (b) Guest — scan and order

Do this on a **real phone**. A desktop browser cannot tell you whether a QR code is scannable. Use a
tunnel (`docs/RUNBOOK.md` §8) or a deployed domain — and **regenerate the QR codes from whichever URL
the phone will use**, because the URL inside them is derived from the origin the request came through.

| # | Do | Expected | Server log to watch | SQL if it fails |
|---|---|---|---|---|
| b1 | Scan the table QR with the phone camera | The menu opens over HTTPS. If you are on a tunnel, the URL is the tunnel's, not localhost | nothing | — |
| b2 | Switch language to **AR** | The whole page flips to RTL **immediately** (the direction is server-rendered now, so there is no LTR flash) | nothing | — |
| b3 | Tap **Add** on a dish, open the cart bar | The cart shows the line with a correct price in dinars | nothing | — |
| b4 | Tap **Send Order to Kitchen** | Full-screen confirmation: **Order #N** ("#1001" for the first order of the day), *"Your order for … is with the kitchen…"*, and **Back to menu** | nothing | `SELECT o.daily_order_number, o.status, o.total, o.is_paid, o.order_day, t.table_number, (SELECT count(*) FROM public.order_items i WHERE i.order_id = o.id) AS lines FROM public.orders o JOIN public.restaurant_tables t ON t.id = o.table_id ORDER BY o.created_at DESC LIMIT 5;` → `status='pending'`, `is_paid=false`, `order_day` = today |
| b5 | **Refresh the page** | The cart and the order number survive (the "Order #N sent" bar is still there) | nothing | — |
| b6 | Optional, the honest test: turn the phone's network on and off mid-submit, or double-tap the button | **One** order, not two — the client reuses its idempotency key across retries | nothing | `SELECT count(*) FROM public.orders WHERE client_ref IS NOT NULL;` — compare with how many times you tapped |

**Known residual (`FE-04`, partial):** if a dish goes unavailable or is deleted after you added it,
the guest gets a generic "no longer available" toast and the offending line stays in the cart. The
client half of the fix has landed; the server half (returning the offending `productIds`) has not —
see §6.1.

### 4 (c) Worker — invite, manual order, accept, mark paid

| # | Do | Expected | Server log to watch | SQL if it fails |
|---|---|---|---|---|
| c1 | As the owner: `/dashboard/workers` → **Invite Worker** → choose **Cashier** or **Manager** → **Generate Invite** | An *"Invite ready"* panel with a QR code, a copyable `${origin}/worker/invite/<token>` link, and "expires in 24 hours" | nothing | `SELECT invite_token, role, is_used, used_by, expires_at FROM public.worker_invites ORDER BY expires_at DESC LIMIT 3;` → `is_used=false`, `expires_at ≈ now + 24 h` |
| c2 | Open the invite link on a **second device** (or a private window) → type a name → **Accept Invite** | *"Welcome aboard!"* and a redirect to `/worker/dashboard`, showing three columns: **New Orders / Accepted / Paid** | `[sufra] worker session revoke failed` would indicate a problem here; normally nothing | `SELECT w.full_name, w.role, w.session_token IS NOT NULL AS has_session, w.session_expires_at, i.is_used FROM public.workers w LEFT JOIN public.worker_invites i ON i.used_by = w.id ORDER BY w.created_at DESC LIMIT 5;` → `has_session=true` |
| c3 | On the worker terminal: **New Order** → pick a **Table** → pick items **From the menu** → optionally add a **Custom item** + **Price** → **Add** → **Place Order** | Toast *"Order #N placed"*; the order joins **New Orders** | nothing | `SELECT o.daily_order_number, i.product_name_snapshot, i.quantity, i.price_snapshot, i.product_id IS NULL AS is_custom_line FROM public.order_items i JOIN public.orders o ON o.id = i.order_id ORDER BY i.order_id DESC LIMIT 10;` → a custom line has `product_id = NULL` **and a non-zero `price_snapshot`** |
| c4 | On the owner board (`/dashboard/orders`) and the worker board, watch the guest's order arrive | It appears in **Pending** within ~3 seconds | nothing | If the board is empty but b4's SQL showed the order: the order was written and this is a read/auth problem — check you are signed in as the owner of that restaurant |
| c5 | Click **Accept**, then **Mark Paid** | The card moves to Accepted, then Paid (`is_paid=true`, `paid_at` set). A **Cashier** cannot mark paid — the control is hidden and the server answers `403` | nothing | `SELECT daily_order_number, status, is_paid, paid_at, accepted_by_name FROM public.orders ORDER BY created_at DESC LIMIT 1;` |
| c6 | Optional: note the worker's session lifetime | 7 days (`WORKER_SESSION_MAX_AGE`), enforced **server-side** now — and revoking the worker in `/dashboard/workers` cuts the device off immediately | nothing | `SELECT full_name, session_expires_at FROM public.workers;` |

### 4.1 The two flows most likely to break first

If something fails, look here before anywhere else.

**First: the owner's publish → print chain (steps a3–a6).** Reason: everything downstream is gated on
one `PUT /api/menu` succeeding, and the printed URL is assembled from the *stored* slug — but the
tables page falls back to a slug derived from the display name if it could not read the menu
(`src/app/(owner)/dashboard/tables/page.tsx:32`, `savedSlug ?? slugify(displayName)`). So a single
failing or unhydrated read produces a QR code that encodes a slug the database does not have, and
every scan 404s while the owner's screen says everything is fine. Two aggravators: the environment
was not picked up (badge says "Saved locally" — but note the dashboard's own hydration is
mount-only, `FE-08`, so a board can show stale/zero state after sign-in until a reload or a tab
switch), and `NEXT_PUBLIC_APP_URL` being pinned to `localhost` or a tunnel hostname that has since
recycled. **How to tell them apart:** the badge text in a3 (says whether the write landed), the SQL
in a5 (compares the stored slug with the slug in the URL), and `/api/health` (says whether a backend
exists at all).

**Second: the worker's invite → manual-order chain (steps c1–c3).** Reason: this is the flow with
the most moving parts and the only one with a *database-shaped* failure mode. The invite-accept path
writes a `workers` row and depends on the session columns (`1004`), so a partially-migrated project
answers `503 NEEDS_MIGRATION`. And if you are on the **legacy** track and did not run `1003`, the
original developer's trigger on `order_items` rewrites `price_snapshot` from `products` and NULLs
custom lines — the signature is **"the order places, but only a Custom item line fails"**, which is
`500 CREATE_ITEMS` on the server and looks like an application bug. **How to tell them apart:** the
response code in the Network tab (`NEEDS_MIGRATION` vs `CREATE_ITEMS`), and re-running check 2 of the
§0.4 verification SQL (expect exactly one trigger: `orders | sufra_orders_set_day`).

**Third, because it masks both of the above:** degraded mode. If the Supabase pair is wrong or the
dev server was not restarted, *both* chains fail in ways that look like product bugs. Always
`curl.exe -s http://localhost:3000/api/health` first.

---

## 5. Phase 2 — The OCR feature, the one unproven flagship

**The honest starting point: OCR accuracy against the real provider is UNMEASURED.** No `MISTRAL_API_KEY`
existed during any audit, so no scan has ever been executed against Mistral. Every OCR conclusion on
record comes from executing the *pure* functions on constructed strings (`parseOcrMarkdown`,
`buildMenuImport`, `ocr-quality.ts`) plus the provider's published contract. The `document_annotation`
wire shape is an inference. You cannot fix what you have not measured, and you cannot sell the
"photograph your menu" feature on a test that never touched a photograph.

### 5.1 What the in-repo tests already cover — and what they do not

```powershell
npx vitest run src/lib/menu-scan.test.ts src/lib/menu-import.test.ts src/lib/ocr-quality.test.ts
```

`src/lib/menu-scan.test.ts` (19 tests) is new: it covers the price truth table (spaces, prefix
currencies, Arabic-Indic digits), table-laid-out markdown, headingless menus, pre-heading items,
orphan price lines, bold/`####` headings, and the `reconcileImports` invariant
`final >= max(ai, parser)`. **This proves the parser is deterministic and correct on strings that a
human wrote. It proves nothing about what Mistral returns for a photograph.** That is exactly what
the corpus below measures.

### 5.2 The 10-scan corpus

Photograph/collect these once and keep them in a folder (they are test data, not product features;
keep them out of git). Include the real menu fixture: **the café's own printed menu**, which is the
acceptance scan — if the feature works on nothing else, it must work on that.

| # | Input | What it probes |
|---|---|---|
| S1 | The café's **real printed menu**, photographed straight-on in good light, at native resolution | The acceptance scan |
| S2 | The same menu, **dim light and a slight angle** — the photo you will actually get at 21:00 | Robustness to real-world capture; the "under-extraction" signature |
| S3 | A **mixed Arabic / French / Latin** menu (Arabic dish names, French section headings, Latin brand words) | Bilingual extraction and name fidelity |
| S4 | A fully **Arabic (RTL) menu with Arabic-Indic numerals** (`١٢٫٥`) | The digit-normalisation path (`OCR-03`/`OCR-14`) |
| S5 | A French menu with **space-separated prices** (`1 200`, `4 500`) | The TND price rule and the name-corruption path (`OCR-02` — the phantom dish) |
| S6 | A **table/grid-laid-out** menu, ideally 2–3 columns | `page.tables` handling (`OCR-04`) |
| S7 | A menu printing the **currency symbol before** the price (`€ 5.500`, `$5.50`) | Prefix-currency parsing (`OCR-03`) |
| S8 | A **3-item headingless price board** (a food-truck/small-counter style menu) | The quality gate's false-reject boundary (`OCR-05`) |
| S9 | A **multi-page PDF** (or a menu long enough to hit the 20-page cap) | Truncation detection (`OCR-13` — still open, see §5.5) |
| S10 | A **non-menu photo** — a promotions panel, a wall, a poster | The negative control: the scan must **fail**, not import junk |

How to run one scan: `/onboarding` → **Scan your menu** → select files → **Apply**. To call the route
directly (useful for repeat runs), see `docs/RUNBOOK.md` §7.

### 5.3 The results table to fill in

One row per scan. **Hand-count the expected values from the printed menu first, before you scan** —
otherwise you will rationalise whatever comes back.

| # | Expected items (hand) | Extracted items (`FINAL` line) | Price errors: missing (0) / **wrong but plausible** / name corrupted | `source` / `aiItems` / `parserItems` | Gate attempts & `reason` | Verdict |
|---|---|---|---|---|---|---|
| S1 | | | | | | |
| S2 | | | | | | |
| S3 | | | | | | |
| S4 | | | | | | |
| S5 | | | | | | |
| S6 | | | | | | |
| S7 | | | | | | |
| S8 | | | | | | |
| S9 | | | | | | |
| S10 | 0 (must fail) | | | | | |

**Split the price errors into three columns, and do not merge them.** They are different severities:

- **Missing (price 0)** — visible (the review shows "—") and annoying, but the owner will catch it.
- **Wrong but plausible** — the dangerous one. `Couscous 1 200` importing as a dish named
  "Couscous 1" at **200 DT** is the canonical case. It looks right, it survives review, and it
  reaches the live menu. Count these by reading every price against the printed sheet.
- **Name corrupted** — digits or a currency symbol left inside the dish name.

### 5.4 What a FAILING scan looks like in the log

All scanner logs go through one helper and are prefixed `[menu-scan] `, with `key=value` pairs. The
line that tells you what actually happened is:

```text
[menu-scan] FINAL strategy=reconcile source=ai model=mistral-ocr-latest categories=4 items=20 aiItems=20 parserItems=20 ms=8412
```

| What you see | What it means | What to do |
|---|---|---|
| **No `FINAL` line at all** | The scan threw before finishing. Look *above* it for the error line | Read the error line; correlate with the response body's `error` code |
| `source=fallback`, `aiItems=0` | The AI annotation came back empty; only the deterministic parser contributed | Re-shoot at native resolution (see `docs/RUNBOOK.md` §10 row 20) |
| `categories=1` when the menu has four sections | The classic under-extraction signature | Same as above |
| `[menu-scan] OCR QUALITY … ok=false reason=NO_STRUCTURE` / `TRUNCATED` **repeated 3×**, then `OCR_FAILED` | The gate rejected the document three times (up to 3 paid OCR calls) | With the fix in place the gate keeps the fittest attempt (`OCR QUALITY DEGRADED ACCEPT`); a hard `OCR_FAILED` here means nothing usable came back |
| `PROVIDER_AUTH` | A 401/403 from Mistral — an expired, revoked or plan-limited key | Check the key and the plan. Previously this masqueraded as "the feature is not configured" (`OCR-16`, now fixed) |
| `NETWORK` / `TypeError: fetch failed` | `api.mistral.ai` unreachable at the TCP layer | Retry; the route already forces IPv4 and retries |
| `PARSER ORPHAN PRICES`, `UPLOAD CLEANUP FAILED` | A price line that could not be attached; a document not released by the provider | Both are informational now — but a repeated `UPLOAD CLEANUP FAILED` means the provider file quota will grow |
| A scan that **succeeds** on S10 | The negative control failed: junk was imported | This is the gate's known soft spot — see §5.5 |

### 5.5 What to do about each likely failure

The findings that make a given failure likely, and the current state of each (`OPEN`, `PARTIAL`,
`FIXED` re-read in the tree):

| Likely failure | Finding | Status | What it means for you |
|---|---|---|---|
| A truncated menu (20+ pages, or a cut-off page) imports as if complete | `OCR-13` | **OPEN** | There is no comparison between the OCR item count and the annotation's item count, and `usage_info` is discarded, so truncation is undetectable except in the one case where the document ends on a heading. **Mitigation now:** cap your scan at 20 pages and check the item count by eye. **Fix:** §6.3. |
| Two or three concurrent scans OOM the process | `OCR-07` | **PARTIAL** | The route still parses the whole multipart body into memory and copies each file again, so peak is roughly twice the upload cap per request. **Mitigation now:** scan one document at a time, and keep the `Max duration 120 s` in mind. **Fix:** §6.3. |
| Wrong-but-plausible prices on S5 | `OCR-02` | **FIXED** | The parser now requires the name to end in a non-digit and lets the price span internal whitespace, with tests. Verify on S5 — this is the whole point of the corpus. |
| Lost prices on S4/S7 | `OCR-03`, `OCR-14` | **FIXED** | Prefix currency symbols and Arabic-Indic digits are normalised, and the parser and the string sanitiser share one routine. Verify on S4/S7. |
| Empty or row-named products on S6 | `OCR-04` | **FIXED** | `page.tables` is concatenated into the parser input and there is a table-row branch. Verify on S6. |
| A legitimate 3-item board hard-fails on S8 | `OCR-05` | **FIXED** | The gate now requires `priced === 0` for its structure rejection, accepts bold/`####` headings, and is retry-then-use rather than retry-then-throw. Verify on S8. |
| An unbounded hang | `OCR-06` | **FIXED (asymmetric)** | Server-side every provider call is bounded (25 s upload / 90 s OCR / 110 s total scan budget). **The client POST still has no timeout** — only an abort when the dialog closes. |
| Junk imported on S10 | *(no finding ID — a residual of the `OCR-05` fix)* | — | A promo panel (`## Promotions` + `Réduction 20%`) still passes the gate and imports as a 0-price product, and the review step shows no warning banner for 0-price or OCR-shaped names. See §6.4. |
| `$`-prefixed prices silently free | `OCR-14` | **FIXED** | `$` normalisation added. Verify on S7. |
| The AI structure path silently doing nothing | `OCR-15` | **FIXED** | The annotation is accepted as a string **or** an object, and the failure branch logs `typeof`. One real scan will settle the wire-shape question for good. |
| Photos retained by the provider | `OCR-08` | **FIXED** | Documents are deleted in a `finally`; the log carries `UPLOAD CLEANUP` / `UPLOAD CLEANUP FAILED`. |

### 5.6 Cost and quota per scan

- Up to **6 files** per scan, **12 MB** each, first **20 pages** of each file.
- The quality gate re-OCRs up to **3×** on a degraded document, so one scan costs up to **18 OCR
  calls** plus up to **6 file uploads**. A degraded document is the expensive one.
- The scan budget is **110 s** server-side; the rate limit is **10 scans/min per IP**.
- Uploaded documents are deleted after the scan, so the provider *file quota* does not grow — but the
  *OCR call* spend does, permanently, on every scan.
- **Keep a running tally.** Open the Mistral console after each of the 10 scans and record the call
  count. That gives you a real per-scan cost you can multiply by expected scans per month. There is
  no spend ceiling enforced anywhere in the app (`docs/audit/07-ocr-pipeline.md` open question 7).

---

## 6. Phase 3 — The remaining findings, ordered by what a first customer would hit

**141 findings were originally recorded. 31 are still open or only partially landed in the current
tree; the other 110 are closed.** The 31 below are ordered by *when a real customer would meet them*
— derived from the three levels in §4, **not** from the severity ranking in `docs/AUDIT.md`. A
`Low`-severity finding that the owner hits on his first sign-in outranks a `High` one he will never
see.

Sizes: **S** ≈ under an hour, one file. **M** ≈ half a day, or needs a decision. **L** ≈ a day or
more, or changes a contract.

### 6.1 Fix before the first customer sits down

| Order | Finding(s) | Symptom the customer sees | Fix | Size |
|---|---|---|---|---|
| 1 | `FE-08` | The owner signs in and the Overview shows **zero revenue, zero orders and empty charts** even though the restaurant has live orders — because the store hydrates on mount only, and signing in does not re-hydrate. Reload or switch tabs and the data appears. | Re-hydrate on auth change (or drive hydration from the session response) instead of mount-only. `src/lib/onboarding-store.tsx:392-400`, `src/components/auth-form.tsx:60-64`. | **S** |
| 2 | `FE-04` | A guest whose dish went unavailable gets a generic "no longer available" toast with **no way to learn which line**; the offending line stays in the cart. The client half is written; the **server never emits the identifiers it reads** (`GET`/`POST /api/orders` return `{cloud,error,message}` only — `productIds` has zero hits in that file). | Emit `productIds` from the two error branches in `src/app/api/orders/route.ts` (~`:159`, `:162`) so the client's existing handling works, and clear the offending line. | **S** |
| 3 | `FE-13(b)` | At the counter, tapping **Place order** in a busy service **does nothing at all** when the response body is not JSON — the handler is `try/finally` with no `catch`. | Add the `catch`, surface a toast, re-enable the button. `src/components/dashboard/worker-new-order.tsx:104-135`. | **S** |
| 4 | `DB-05` | PostgREST **embed errors are still discarded** at two call sites (`src/app/api/orders/route.ts:58`, `src/app/api/auth/worker/invite/[token]/route.ts:22`), so a schema/FK regression returns a **silently empty order board** or a 404 on a perfectly valid invite — the exact symptom the owner would report as "the app lost my orders". | Check the returned `error` at both sites and answer `500` with a code. | **S** |
| 5 | `OCR-13` | A menu longer than 20 pages (or a cut-off page) **imports as if it were the complete menu**; nothing in the pipeline says otherwise. The owner publishes a menu missing items. | Compare the parser's item count with the annotation's item count and raise a warning through `MenuImportResult`; make `TRUNCATED` a re-run trigger. Whether the 20-page cap is even detectable depends on whether `usage_info` reports total pages — **open question, resolve it with one real scan first.** `src/lib/ocr-quality.ts:47,62,76-79`, `src/lib/menu-scan.ts:77,417`. | **M** |
| 6 | `OCR-07` | Two or three concurrent scans can **OOM the process**, killing in-flight orders for everyone on the same instance. Now roughly 2× the upload cap per request (was ~3×). | Stream the multipart body (or write parts to temp files) instead of `req.formData()`, and hand the upload route a file handle rather than a `Buffer` + `Blob` copy. `src/app/api/menu/scan/route.ts:99,144`, `src/lib/menu-scan.ts:289`. | **M** |
| 7 | `FE-06` | The **exploitable half is closed** — no worker session is minted when the server answered 429/5xx/403. What remains: the genuine offline fallback is still unlabelled, so a worker device can show a working-looking terminal that holds no server session. | Label the offline/demo state on the terminal itself. `src/app/(worker)/worker/invite/[token]/page.tsx:184-186,210-219`. | **S** |
| 8 | `DB-23` | **Publication is not a real control** (`is_published` is always written `true` and the guest route never filters on it, so an unpublished restaurant is still public), and `restaurants.currency` + `products.image_source` are dead columns. | Decide, then either enforce the filter on the guest route or delete the columns. **Careful: gating on `is_published` must not 404 a QR code that is already printed.** `src/app/menu/[slug]/[token]/page.tsx:20-26`, `src/app/api/menu/route.ts:297`. | **M** |
| 9 | `I18N-01` + `I18N-14` | The currency switcher is gone from the guest menu (good), but the currency **state is still global**: the landing page's `$` writes the same cookie/localStorage the guest menu's `formatPrice` reads, so tapping `$` on the marketing page reprices a café's menu in USD while the kitchen receives TND. And the owner still cannot choose a currency — `restaurants.currency` is written once and read nowhere. | **Needs the owner's decision first** (TND everywhere on the guest path, or a real per-restaurant currency). Then stop reading the global currency on the guest surface and make the columns real. `src/lib/i18n.tsx:193-197`, `src/app/page.tsx:73`. | **M** |
| 10 | `DB-20` | A worker row whose role is the lowercase `'manager'` (which the DB CHECK still accepts) is coerced to **Cashier**, so a manager gets `403 FORBIDDEN` marking an order paid and cannot understand why. | Normalise the role on write (or narrow the CHECK), and stop the silent Cashier fallback at PATCH time. `src/lib/worker-permissions.ts:11-14`, `0001_init_schema.sql:375`, `src/lib/.../orders/[id]/route.ts:84`. | **S** |
| 11 | `DB-22` | Around local midnight the ticket-number fallback can compute a number that already exists in the UTC-day group; the insert is rejected `23505` and the loop retries 8× before failing `500`. **Day-boundary orders fail.** | Make the fallback filter on `order_day` rather than a local-midnight `created_at` window. `src/app/api/orders/route.ts:90-92,115`. | **S** |
| 12 | `DB-19` | On the **legacy** track only: `order_day` can still be `NULL` (the `ADD COLUMN IF NOT EXISTS` never gets a `SET NOT NULL`), and in a plain unique index NULLs are distinct — so the "unique backstop for daily ticket numbers" does not constrain those rows. | `UPDATE … SET order_day = (created_at AT TIME ZONE 'UTC')::date WHERE order_day IS NULL;` then `ALTER COLUMN order_day SET NOT NULL;` — in `1003`/`1004`, and only after the verification query catches it. | **S** |
| 13 | `LIB-08` | The rate limiter keys on the **first `X-Forwarded-For` entry**, which is only meaningful when a trusted edge overwrites it. Exposed directly, a client can choose its own bucket key and sidestep the throttle (and evict other callers' counters — bounded now, 4096 keys, LRU). The unbounded-memory half is fixed. | Decide the deployment topology first (§7), then key on a header your edge provably overwrites. `src/lib/rate-limit.ts:43-52`. | **M** |

### 6.2 Cheap and high-value — batch these in one sitting

All **S**. None of them blocks a customer, and together they are a couple of hours. Do them as one
batch rather than one at a time.

| Finding(s) | What it is | Fix |
|---|---|---|
| `API-11` | Three routes still answer `429` with **no `Retry-After`** header (`password/route.ts`, `recover/route.ts`, `reset/route.ts`), while the other six were converted to the shared `retryAfterHeaders()` helper. | Use `retryAfterHeaders(rate)` in the three remaining routes. |
| `API-12` | `POST /api/menu/scan` returns raw provider detail (`err.message`, `String(err)`) to the browser. | Return the typed code only; log the detail server-side. `src/app/api/menu/scan/route.ts:161,166`. |
| `FE-17` | The category reorder arrows are still `title`-only and ~22 px — unlabelled for a screen reader and hard to hit on a phone. | `aria-label` + a ≥44 px target. `src/components/onboarding/step-categories.tsx:128-146`. |
| `FE-19` | Submitting the worker invite form with an **empty name does nothing at all** — no error, no message. Same silent `return` in the product form. | Add an error slot and `required`. `src/app/(worker)/worker/invite/[token]/page.tsx:135-136`, `src/components/onboarding/step-products.tsx:55-59`. |
| `I18N-04`, `I18N-15`, `I18N-17`, `I18N-18` | Residual RTL/direction pins in `ui/dialog.tsx:43,53`; two dead keys (`cur_label`/`lang_label`); the onboarding page's `<title>` is still English-only; a few owner-facing literals ("Sign out", "Close") remain untranslated. | Mechanical sweep. |
| `INFRA-13` | `tailwind.config.ts` is **dead configuration** — Tailwind v4 never reads it without `@config`, and its `brand` palette has zero consumers. | Delete it. |
| `INFRA-15` | `@radix-ui/react-progress` is installed with **zero imports**. | Remove the dependency. |
| `INFRA-16` | `package.json` declares **no `engines`**, and `@types/node ^22` sits beside a Node 20 build/CI. | Add `"engines": { "node": ">=20 <21" }` (or align the types). |
| `INFRA-18` | The app is "Sufra", the npm package is `sufra`, the Compose project is `restaurant-ai`. | Rename the Compose project for consistency. |

### 6.3 Genuinely risky — do not batch these

| Finding(s) | Why it is risky | Approach |
|---|---|---|
| `OCR-07` (memory) | Touches the memory model of the scan route; easy to break streaming semantics. | One change, one scan of each corpus item afterwards. |
| `OCR-13` (truncation) | Blocked on an unproven provider detail (`usage_info` total pages). | Resolve the open question with one real multi-page scan **before** writing the fix. |
| `LIB-08` (limiter key) | The correct fix depends on infrastructure you have not chosen yet. | Decide §7's topology first; a limiter fix aimed at the wrong edge is theatre. |
| `I18N-12` (RTL sweep) | ~20 physical left/right sites across the dashboards, wizard and mockups. It was applied unevenly once already — half-done RTL is worse than consistently LTR. | Do it as one deliberate pass with the AR locale on screen, not opportunistically. |
| `I18N-14` / `DB-23` | Both need an owner decision, and `DB-23` can break already-printed QR codes if done carelessly. | Decide intent first, then implement. |
| `INFRA-06` | Add a container build **and run** job to CI — the four container fixes ported from `INFRA-01/03/04/05` are currently code-only and ungated. | Add it after Phase 1 passes, so it can encode a known-good behaviour. |
| `INFRA-09` | Proving `supabase db push` works may require renaming the migrations to the CLI's 14-digit convention — which freezes the applied history. | Test on a throwaway project; do **not** rename files that have already been applied to a live database. |
| `INFRA-10` | No `db:migrate`, no `seed`, no `format` script. | Add only once the sequences are stable in §3. |
| `INFRA-14` | The Next image optimizer accepts `hostname: "**"` — `/_next/image?url=` is an open fetch proxy. | Decide the allowed image hosts (Supabase Storage + nothing else) and narrow it. |

### 6.4 Residuals with no finding ID

These were found while re-verifying the tree. They are **not** in the original 141 and are not counted
in the 31. They are recorded here so they do not get lost.

1. **A promo panel still imports as a product, and the review step still shows no warning banner.**
   A residual of the `OCR-05` fix (`## Promotions` + `Réduction 20%` passes the gate and imports as a
   0-price product) and of `OCR-10`'s third fix item. `src/lib/ocr-quality.ts:71-85`,
   `src/components/onboarding/menu-scan-dialog.tsx:289-346`. Measured in §5, scan **S10**.
2. **The tables page can print a QR for a slug the database does not have.** `tables/page.tsx:32` is
   `savedSlug ?? slugify(displayName)`, and `savedSlug` is only populated by a *successful* menu read
   — which now answers `503` on a read failure. So a read failure produces a name-derived slug in the
   printed URL. A narrower and different defect from `API-14` (which is fixed). This is the mechanism
   behind failure #1 in §4.1.
3. **Deleting a table no longer cascades away its order history — decided and implemented.**
   `0001_init_schema.sql:269` now declares `orders_table_id_fkey … ON DELETE RESTRICT` (and the same
   FK-repair spec is in `1003_live_db_repair.sql:303`), so removing a table in the editor no longer
   silently deletes every order placed at it: the delete fails loudly and `PUT /api/menu` surfaces
   the DB error instead of reporting success. Order history is the owner's revenue record, which is
   why `DB-16`'s flagged product decision resolved this way. The operational consequence: an owner
   can no longer delete a table that has orders — they must keep it, or the history must be handled
   deliberately.
4. **Stale comment / self-heal mismatch.** `src/app/api/menu/route.ts:205` still says "the DB has no
   constraint yet" beside the new `UNIQUE (slug)`; `src/app/api/upload/route.ts:62` self-heals the
   storage bucket as `{ public: true }` with **no size or MIME limits**, so a bucket created by that
   path bypasses the limits the migration sets (only a migration re-run backfills them).
5. **Dead status entries.** `ScanErrorCode` has no `INVALID_MODEL_RESPONSE` / `INVALID_JSON`, yet
   `src/app/api/menu/scan/route.ts:46-47` still declares both in the `STATUS` map.

---

## 7. Phase 4 — Before real customers: the operational checklist

Run this list once, top to bottom, on the day you decide to put a QR code on a table.

**1. A real domain, with TLS.** Do not print a QR code that points at a tunnel. Point the app at a
domain you control (e.g. `order.<your-cafe>.tn`), terminate TLS at your host or proxy, and set
`NEXT_PUBLIC_APP_URL` only if a reverse proxy rewrites `Host` internally — otherwise leave it unset
and let the origin rule apply. Then **regenerate every QR code from the final domain** and only then
print or laminate anything.

**2. Keep ngrok for testing, never for the table.** A free ngrok session **recycles roughly every 8
hours and its random subdomain changes**. The consequence is blunt: **every QR code you printed
against the tunnel URL dies within a day**, and a laminated standee becomes a 404 that a guest reads
as "this restaurant's menu is broken". Use the tunnel to prove a phone can reach the app; use the
real domain for anything a guest touches.

**3. Decide the deployment topology, then trust the rate limiter accordingly.** The limiter
(`src/lib/rate-limit.ts`) keeps its counters **in the process's memory** and keys them on the first
`X-Forwarded-For` entry. That means:

- **One instance only** — a second instance has its own counters, so limits are effectively
  per-instance. Run one instance, or accept that limits become per-instance.
- **The `X-Forwarded-For` header must be overwritten by your edge.** Only meaningful behind an edge
  that rewrites it (a managed platform, or nginx/Cloudflare configured to do so). Expose the Node
  process directly to the internet and a caller chooses its own bucket key — the throttle is
  bypassable, and a caller sending a unique header per request can evict other callers' counters
  (bounded: 4096 keys, least-recently-active eviction — it can no longer cause an OOM). Behind a
  proxy that *strips* the header, every caller shares one bucket, which is a real throttle.

The current limits, for reference: login 10 / 10 min, signup 5 / 10 min, recover 5 / 10 min, reset
and password 10 / 10 min, worker invite and accept 20 / min, orders 60 / min, scans 10 / min,
uploads 30 / min.

**4. Backups.** Check the project's backup policy in **Supabase → Project Settings → Database →
Backups** (what you get depends on the project's plan — the free tier's retention is short, so do not
assume you are covered). Independently: take a **manual `pg_dump` before running any migration** on a
database that holds real orders, and keep the dump off the machine that runs the app.

**5. Observability.** The app logs to **stdout and nowhere else**; there is no error tracker, no
metric, no alert. Nothing will tell you that last night's orders failed to arrive. Before real
customers: (a) run it under something that *keeps* stdout (`docker logs`, `journald`, or your host's
log viewer — the dev instruction `npm run dev > .dev.log 2> .dev.err.log` shows the shape of it), with
rotation; (b) check it daily for the first two weeks, grepping for `[sufra]` (the dev-switch warnings
and session-revoke failures) and `[menu-scan]`; (c) treat any guest report of "my order didn't come"
as a log incident, not a UI glitch — the order row's `status` in `public.orders` is the truth.

**6. The dev switches — never on a deployed server.**

- `SUFRA_AUTH_DISABLED=1` **opens every login wall** (owner dashboard, worker terminal, all protected
  APIs) to anyone who can reach the server.
- `SUFRA_RATE_LIMIT_DISABLED=1` **turns off throttling** on login, signup, orders, scans and uploads.

Both are honoured **only** on a non-production build (`NODE_ENV !== 'production'`), so a production
container ignores them even if the variable leaks in — that guard is the last line of defence, not a
licence to leave them set. Keep them **commented out in `.env.local`**, never set them on a box the
internet can reach, and never while an ngrok tunnel is open. The server prints a warning on first use
of each: `[sufra] SUFRA_AUTH_DISABLED=1 — all login walls are OPEN.` and
`[sufra] SUFRA_RATE_LIMIT_DISABLED is set — rate limits are OFF.` If you ever see either in
production logs, treat it as an incident. Also: **never set `NODE_ENV` in `.env.local`** — it
overrides Next's own, and setting it to `production` locally makes the cookies `secure` so a
plain-HTTP browser silently appears logged out.

**7. The OCR cost and quota budget.** Per scan: up to 6 files; the quality gate may re-OCR each file
up to **3×**, so a single degraded scan can cost up to **18 OCR calls plus 6 uploads**, and the
server budget is 110 s. Uploaded documents *are* deleted after the scan (so the provider file quota
does not grow), but the OCR call spend is permanent. Before you advertise "photograph your menu",
scan the ten-corpus set (§5.2) and read the Mistral console usage before and after — that gives you a
real per-scan cost. Then multiply by expected scans per month. Nothing in the app enforces a ceiling,
so the ceiling is you watching the console.

**8. The service-role key is the whole database.** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is
server-only, must never be prefixed `NEXT_PUBLIC_`, and must never be pasted into anything the
browser can read, a screenshot, or a chat. Store it in a password manager. If it leaks, rotate it in
the Supabase dashboard **and redeploy**, because the running process holds the old value until it
restarts.

---

## 8. Phase 5 — Deliberately deferred (not bugs)

These are choices, not defects. Nobody should "fix" them by accident, and no customer should be told
they are broken.

| Deferred | Why it is deliberate |
|---|---|
| **Google OAuth** | Scope control for a first customer. The callback seam exists (`src/app/api/auth/callback/route.ts`); nothing links to it yet. |
| **Payments** | The app replaces the waiter's notepad, not the cash register. "Paid" is a boolean a worker flips. |
| **Printer / kitchen integration** | No ESC/POS, no receipt printing, no outbound webhook anywhere. (The old `n8n` Compose service was removed — it was wired to nothing.) |
| **Multi-branch / multi-restaurant** | Owner queries resolve a single restaurant row, and there is no restaurant switcher. One café, one account. |
| **Guest order history / "my order" view** | Guests have no identity at all, by design — no account, no read access to orders. The order number on the confirmation screen is their proof. |
| **Realtime instead of polling** | Visibility is a 3-second poll (now with an in-flight guard, sequencing, abort and a stale flag). Realtime is an optimisation, not a requirement. |
| **A product-ordering *feature*** | Note: the *plumbing* is no longer missing — `products.sort_order` is written and read (including by the guest route) and the wizard has category reorder arrows. What is deferred is a richer ordering UX. |
| **Signup rate-limit tuning, abuse hardening, etc.** | They exist and work; hardening beyond the current limits is a scaling concern, not a first-customer one. |

---

## 9. Verification commands

What "green" looks like, after **any** change. Run these before you push.

```powershell
npm run check              # typecheck + lint + tests
npm run build              # production build
```

| Command | What it must print |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **Nothing at all.** Silence is success. |
| `npm run lint` (`next lint`) | `✔ No ESLint warnings or errors` (a deprecation notice about ESLint 8 on Next 15 is expected) |
| `npm run test` (`vitest run`) | `Test Files 9 passed (9)` / `Tests 181 passed (181)` |
| `npm run build` (`next build`) | `✓ Compiled successfully` plus the route table — **38 routes** |
| `npm run check` | Runs the first three in order, stopping at the first failure |

**The production artefact**, the way the container runs it:

```powershell
npm run build
npm run start:standalone          # node .next/standalone/server.js
```

Then probe it — this is the closest thing to a smoke test you have:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/                 # 200
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/nope             # 404 (branded)
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/dashboard        # 307 -> /auth/login
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/onboarding       # 307 -> /auth/signup?next=/onboarding
curl.exe -s http://localhost:3000/api/health                                 # {"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}
curl.exe -s http://localhost:3000/api/auth/session                           # {"cloud":true,"user":null}
```

**The database contract suite** (run in this exact order; expect
`ALL SCHEMA SMOKE CHECKS PASSED`):

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/_shim_storage.sql   # plain Postgres ONLY — skip on Supabase
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init_schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1002_production_readiness.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1003_live_db_repair.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1004_session_hardening.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/schema_smoke.sql
```

`-v ON_ERROR_STOP=1` makes `psql` exit non-zero at the first failure instead of ploughing on — always
use it when scripting. On a failed check the transaction stays aborted: run `ROLLBACK;` before
anything else.

**Pushing migrations with the CLI:**

```powershell
supabase login
supabase link --project-ref abcdefgh
npm run db:push
```

(Unproven in this repo — see `INFRA-09`. Prefer the SQL-editor path if it complains about filenames.)

**The container:**

```powershell
docker compose up --build
docker compose ps                 # web: Up (healthy)
curl.exe -s http://localhost:3000/api/health
```

The health probe is **liveness only** — `/api/health` returns 200 even with an unreachable database.
`"backend":false` in the body is what tells you the config is missing; `Up (unhealthy)` means the Next
server itself is not answering.

---

## 10. Known-unknowns ledger

The honest handover of risk. Each row is a belief, how much to trust it, and the cheapest way to
prove it wrong.

| Claim | Confidence | How to falsify it |
|---|---|---|
| The migration chain is correct, and creates every table, constraint and default the app needs | **High** — executed against real PostgreSQL 17 with `ON_ERROR_STOP=1`, and 34 contract assertions pass | Run the same chain on the real Supabase project (§0.3) and run `schema_smoke.sql` there (§0.5). Supabase's Postgres differs from the `supabase/postgres` image mainly in its `auth`/`storage` schemas, which the smoke test uses. |
| `1003_live_db_repair.sql` repairs the original developer's database (rogue triggers, missing constraints) | **Low** — written, never executed against the database that has them | On a copy of that database: run `1003`, read every `VERIFY OK`/`VERIFY FAIL`, then re-run §0.4 check 2 (expect exactly `orders \| sufra_orders_set_day`) and place a worker manual order with a custom line (c3). |
| The app works against a real Supabase project | **Unknown** — no live database has ever been exercised against this code | **Phase 0 + Phase 1. Nothing else answers this.** |
| OCR reads a real printed menu accurately | **Unknown** — never measured; no scan has ever been executed | **Phase 2's corpus.** Until then, do not advertise the feature. |
| `document_annotation` arrives as a JSON string (as the code assumed) | **Unknown** — the provider's response reference documents it as `dict\|null`; the code was an inference | One real scan. The fix now accepts both shapes and logs `typeof`, so the log alone settles it (`OCR-15`). |
| A stranger's phone can complete the guest flow | **Medium** — the route validates the `(slug, token)` pair server-side and the order path is server-priced and idempotent, but it has never been walked by a stranger | Phase 1 (b), on a real phone, with the QR generated from the URL the phone will use. |
| The rate limiter actually protects a deployment | **Low** — process-local counters, and an `X-Forwarded-For` trust assumption that has never met a real edge | On a staging deployment: send 11 logins with the same `X-Forwarded-For` and confirm the 11th is throttled; then send 11 with a **fresh** header each time and confirm whether they are throttled. If the second test passes, your edge is not overwriting the header. |
| Logout actually ends a session server-side (owner refresh token revoked; worker token revocable) | **Medium** — the code calls Supabase's logout and clears the worker columns, but it has never been exercised end to end | Owner: sign in, capture the refresh token, log out, then attempt a refresh. Worker: accept an invite, then revoke the worker from `/dashboard/workers` and confirm the terminal bounces on the next request. |
| `npm ci` installs reproducibly | **Medium-high** — the specific missing-`vitest` defect is structurally gone from the lockfile, but `npm ci` has not been run since | Delete `node_modules` and run `npm ci` on a clean clone with Node 20. |
| The Docker image runs correctly | **Medium** — `docker build` succeeds, but the image has never been *run* | `docker compose up --build` then `docker compose ps` and `curl` `/api/health` (§9). |
| `npm run db:push` applies the migrations | **Low** — never executed; needs a global CLI, a linked project, and may object to the 4-digit filenames | Run it against a throwaway project. Do not rename migrations that are already applied anywhere. |
| The 181 tests catch regressions in the flows that matter | **Medium** — they are real tests, but largely pure-logic; there is **no browser/E2E test** | Read the test file list in `src/lib/` to see the scope, then treat §4 as the acceptance suite and re-run it after every change that touches auth, the menu sync, orders or polling. |
| Password-reset emails are actually delivered | **Unknown** — depends on the Supabase project's SMTP configuration, which has never been inspected | Use `/auth/forgot` with a real mailbox. The UI now distinguishes sent / failed / unavailable / rate-limited, so a failure is at least visible (`FE-15`). |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| **OCR gives wrong prices on a real menu** | Medium | **High** — a guest is charged the wrong price and the owner's printed menu stops matching the app. Trust damage, not a crash. | Run the §5.2 corpus before advertising the feature. Review every scanned price against the printed sheet, specifically looking for *wrong but plausible* values (the `Couscous 1 200` class). Keep the "N items already existed and were kept" report visible in the review step. | Any wrong-but-plausible price in the corpus, or any guest dispute about a price. Then stop advertising scans and fix the specific parser case. |
| **A QR code printed against a tunnel URL that later dies** | **High** (if printed from a tunnel) | **High** — every standee on every table 404s at once, and the guest reads it as the restaurant being broken. | Never print from a tunnel. Print only from the final domain. Free ngrok recycles every ~8 h and changes subdomain; reserve a static domain if you must tunnel for a demo. Keep the ability to regenerate and reprint all codes from `/dashboard/tables`. | A subdomain change, a deploy, or *any* printed code you cannot trace back to a domain you control. |
| **The rate limiter is not shared across instances** | Low now (one instance) | Medium — during an incident, twice the traffic reaches an unthrottled login/signup path | Run a **single** instance, with an edge that overwrites `X-Forwarded-For`. If you must scale out, move the counter to a shared store first. | A second instance, an autoscaling platform, or any plan to add capacity. |
| **Worker sessions on a shared tablet** | Medium | Medium — every staff member on the tablet shares one identity; "accepted by" attributions blur | Worker sessions now expire server-side after **7 days** and are revocable: **revoke the worker in `/dashboard/workers` the moment a device is lost or a shift ends** — that cuts the device off immediately. Use a distinct invite per device. | A lost, sold, or reassigned tablet; a departing employee; any unexplained "accepted by" name. |
| **A menu edit deletes data** (the `API-2` class: a swallowed read error served as an empty menu, which the autosave then wrote back) | Low now — the server returns `503 READ_FAILED` on a read error, the client disarms autosave until a body hydrates, and the save badge's error state is reachable | **Critical** — every product and every table, with no undo | Know the regression signature: `GET /api/menu` must **never** answer `200` with empty `categories`/`products` while rows exist. Before/after any edit, run `SELECT count(*) FROM public.products;` and `SELECT count(*) FROM public.restaurant_tables;`. The badge must read **"All changes saved"** — never "Saved locally". Take a `pg_dump` before any change to the menu route or the store. | Any `GET /api/menu` returning `200` with empty collections while the tables hold rows; any product count dropping after an edit; the badge showing anything other than "All changes saved". |
| **Losing the service-role key** | Low | **Critical** — it is the keys to the whole database, including every guest's order and the owner's account | Store it in a password manager, never paste it anywhere a browser can read, never prefix it `NEXT_PUBLIC_`, never commit it (`.env.local` is gitignored). Keep a second copy of the *location* (not the value) so a lost laptop is recoverable. | Device loss, a screenshot, a support thread, or any suspicion of exposure → **rotate in the Supabase dashboard and redeploy** (the running process holds the old value until restart). |
| **Printing a QR code for a restaurant that was never created** | Low now — the publish/print chain is gated on the server confirming the save | High — the owner hands out dead codes and cannot tell why | Before printing, open the QR URL and confirm it renders the menu; confirm the URL's slug matches `SELECT slug FROM public.restaurants;`. Trust only the "All changes saved" badge. | Any mismatch between the printed URL's slug and the stored slug, or the badge reading anything but "All changes saved". |
| **A schema regression silently empties the order board** | Low | Medium — the owner sees zero orders while orders exist in the table | `DB-05` (two discarded embed errors) is open; until it is fixed, treat "board is empty" as a data question: `SELECT count(*) FROM public.orders;` first. | Empty board with a non-zero `orders` count. |
| **Deleting a table silently deletes its order history** | Low | Medium — order history for that table is gone immediately (no soft delete) | Pending a product decision, do not delete a table through the editor once the café is live; rename it to "out of service" instead. | Before the first real service: decide whether the cascade is wanted. |
| **Nobody notices an outage** | Medium | Medium — no error tracker, no alert; failures are discovered by a customer complaint | Capture stdout with rotation and check it daily for the first two weeks (§7 item 5). | Any day you do not check the log during the first two weeks. |
| **A regression ships because the only E2E test is manual** | Medium | High — the flows that matter have no automation | Re-run §4 in full after any change to auth, `PUT /api/menu`, order creation/patching, polling, or the worker session. Keep `npm run check` green as the floor, not the ceiling. | Any change to those files that ships without a §4 walk. |
