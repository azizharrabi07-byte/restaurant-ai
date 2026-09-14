# Live Verification — real Supabase project, real Mistral provider

This document is the record of what was actually proven by running Sufra against the live
Supabase project `uejxcwsusinkkejhuuyp.supabase.co` and the real Mistral OCR provider. Every
claim made about this repository until now was one of three weaker things: a read of the source,
an execution of a pure function in isolation, or SQL run against a scratch Postgres. This is the
first evidence produced by the assembled system with real credentials, so it is deliberately
literal: it states the exact error codes, the exact log lines, the exact values, and the exact
things that failed. It exists because the recommendation to run the migrations on the operator's
live database rests on the measurements below, and that recommendation must be traceable to
observations rather than to inference.

## 1. Environment and method

- **Live Supabase project** `uejxcwsusinkkejhuuyp.supabase.co`, reached with the service-role key.
- **Mistral OCR** with a real API key, model `mistral-ocr-latest`.
- **Application**: a production standalone build (`node .next/standalone/server.js`) run with
  those credentials and probed over real HTTP on port 3100.
- **Health check**: `GET /api/health` returned

  ```json
  {"ok":true,"backend":true,"ocr":true,"version":"0.1.0"}
  ```

  so the running app was genuinely connected to both providers; no measurement below was taken in
  a degraded/no-credentials mode.
- **Database inspection** was read-only against the PostgREST OpenAPI spec and targeted queries.
  **End-to-end flows** were driven over HTTP. **OCR** was measured with 6 scans plus 1 raw
  provider probe.
- No load, soak, concurrency or memory measurement was performed (see §10).

## 2. Live database state

Read-only inspection of the live project found:

- **All 9 tables exist**, including `sufra_daily_counters`. This matters: a prior report recorded
  that table as invisible to PostgREST (see §6), and it is reachable now. Its presence also means
  `1002_production_readiness.sql` has been at least partially applied at some point.
- **Exact column sets** were read from the PostgREST OpenAPI spec. `workers.session_expires_at`
  is **absent** — migration `1004` has not been applied.
- **Extra live-only columns exist** that this repository's schema does not create. They are
  additive and harmless, and are listed here so nobody is surprised by them:
  `restaurants.telegram_chat_id`, `products.tags`, `orders.updated_at`, `categories.created_at`,
  `restaurant_tables.created_at`, `order_items.created_at`.
- **Data**: **1** restaurant (`ahmed coffeee`, slug `ahmed-coffeee`, owned, published), **0**
  categories, **0** products (the menu in the DB is empty), **6** restaurant_tables, **1** order
  (`#1001`, `pending`, total `9`, `order_day` `2026-09-08`), **1** order_item (`3 × kahwa kahla @
  3`), **0** workers, **0** worker_invites, **7** auth users.

The empty menu (0 categories, 0 products) is a data state, not a code failure: all six live OCR
scans and every end-to-end flow below were exercised against this same project.

## 3. The three legacy blockers, each reproduced live

Each blocker was reproduced by injection against the live database, and each reported a concrete
PostgreSQL error code. Two were then reproduced again through the running application.

| Blocker | Injected | Observed | Error code |
|---|---|---|---|
| Worker creation impossible | `POST workers` with `role='Cashier'` | Rejected: `workers_role_check` accepts lowercase only | **`23514` check_violation** |
| Worker creation impossible | The same insert **without** an `id` | Rejected: no `DEFAULT` on `workers.id` | **`23502` not-null_violation** |
| Worker invite through the app | `POST /api/auth/worker/invite` | `{"cloud":false,"error":"CREATE_INVITE"}`; `worker_invites` stayed empty | clean failure (see below) |
| Rogue ticket trigger | Insert an order with explicit `daily_order_number: 9999` | Stored as **`1`** — the trigger overwrote it with a per-day, 1-based `max+1`, defeating the atomic `sufra_next_order_number()` RPC | no error; silent wrong value |
| Rogue ticket trigger (real flow) | A guest order through the app | Came back as `number: 1` | no error; silent wrong value |
| Rogue price trigger | Insert `order_items` row with `product_id: null`, `price_snapshot: 0.01` | Rejected: the trigger NULLs the snapshot for a manual line | **`23502`** |

Notes that matter:

- The app-level invite failure is a **clean** failure — `CREATE_INVITE`, no partial row, and the
  `worker_invites` table remained empty. That absence of a partial row is itself evidence that the
  invite-burn fix works.
- The rogue price trigger means **100% of worker-created custom orders fail**: there is no path
  that stores a manual line.

## 4. The money-precision defect (a new finding)

No prior audit had found this. Writing a product at **`4.755` DT read back as `4.76`**. The value
was confirmed to be rounded by the **column**, not by the application, by reading the raw row
directly. The live money columns are `numeric(x,2)`.

This is a defect because the currency is the Tunisian dinar, which is millime-based
(1 DT = 1000 millimes), and every other layer already works at 3 decimals:

- `src/lib/format.ts` renders 3 decimals,
- the OCR import rounds to 3,
- the scan parser rounds to 3,
- `lineTotal` / `computeOrderTotal` round at 3.

The fix was applied to this repository:

- `supabase/migrations/0001_init_schema.sql` now declares `numeric(10,3)` /
  `numeric(12,3)` for the money columns.
- `supabase/migrations/1003_live_db_repair.sql` gained a guarded, idempotent widening section.

Verified on a legacy-shaped Postgres: scale **2 → 3**, existing values preserved (an
already-rounded `4.76` stays `4.760` — lost precision is **not** invented back), and `4.755`
round-trips exactly afterwards.

## 5. End-to-end flows: what works and what is blocked

Exercised live through the running app over HTTP.

### Working

| Flow | Evidence |
|---|---|
| Owner **login** | `POST /api/auth/login` → session cookie; `GET /api/auth/session` returns the user |
| **Menu publish** | `PUT /api/menu` with 2 categories, 4 products, 2 tables → `{"cloud":true,"restaurantId":"…"}`; `GET /api/menu` round-tripped every category with its `sort_order`, every product with its `position` and price, and both tables with their tokens |
| **Guest menu page** | Real restaurant + real `qr_token` → **200** with the restaurant name rendered; a wrong token → **404**; a wrong slug → **404** |
| **Guest ordering** | `POST /api/orders` for 2 × 4.50 + 1 × 3.20 → **200** with a **server-computed total of `12.2`** (the client sent no price), correct per-line snapshots, and the table number resolved from the token |
| **Dashboard** | `GET /api/orders` returned that order with its items — the FK-backed PostgREST embeds resolve on the live project |
| **Order mutations** | Owner `PATCH {status:"accepted"}` → `{"cloud":true}`; `{status:"paid"}` → `{"cloud":true}`; the row persisted `status=accepted, is_paid=true, total=12.2` |
| **Unknown product** | Ordering a nonexistent product → `404 PRODUCT_NOT_FOUND` (clean error, no crash) |
| **Auth rejection** | Unauthenticated requests to `/api/orders` and `/api/menu` were rejected; a forged `sufra_worker_session` cookie and a forged `Bearer` token both returned `{"cloud":false,"orders":[]}` / empty data rather than any data |

### Blocked (by the live schema, as listed in §3)

| Flow | Cause |
|---|---|
| Worker invite → accept | `workers_role_check` (`23514`) and the missing `workers.id` default (`23502`) |
| Correct ticket numbering | the rogue `orders` trigger overwrites `daily_order_number` |
| Worker custom lines | the rogue `order_items` trigger NULLs the price snapshot (`23502`) |

## 6. What the live run contradicts in the earlier reports

| Earlier claim | Source | What the live run shows |
|---|---|---|
| `sufra_daily_counters` "invisible to PostgREST (schema cache)", `PGRST205` on the table | `SECURITY-REPORT-ROUND-2.md:26`, `:86` (M4), `:96` (L6); `FINAL-AGENT2-AUDIT.md:118-119` | **Superseded.** The table is reachable now; all 9 tables exist. |
| `restaurants.owner_id` FK may abort on an orphan and DB-14 recommends `numeric(10,2)` / `numeric(12,2)` money | `docs/AUDIT.md:183` (`DB-14`), `docs/audit/01-database.md:488-490` | **Superseded.** The live measurement shows scale 2 loses precision on a millime currency, so the recommendation is now `numeric(x,3)` (§4), and `0001` guards the owner FK (§8). |
| The order layer rounds to 2 decimals while the display layer uses 3 | `docs/AUDIT.md:161` (`LIB-04`), `docs/audit/04-lib-core.md:47` | **Superseded by the fix.** `lineTotal` / `computeOrderTotal` now round at 3, matching `format.ts`, the OCR import and the scan parser; the binding conflict is now the column type, which §4 addresses. |
| The OCR pipeline "was never measured live" | `docs/INTENT.md:90` | **Superseded.** 6 scans against the real provider are recorded in §7. |
| The rogue legacy triggers are `INFERENCE (repo) + prior art (live)` | `docs/audit/01-database.md:519` (`DB-17`) | **Superseded for this project.** Both triggers were reproduced against the current live database (§3). |
| Table-formatted menus arrive via `pages[].tables[*].markdown` and the pipeline discards them | `docs/audit/07-ocr-pipeline.md:355-377` (`OCR-04`) | **Diagnosis confirmed, proposed fix corrected.** The pipeline does discard table bodies, but the provider returns them in **`content`**, not `markdown` (§7). |
| Leading-currency-symbol and Arabic-Indic prices import at price 0, and digit runs corrupt names | `docs/audit/07-ocr-pipeline.md:199-203` (`OCR-02`/`OCR-03`) | **Not observed on this path.** On the measured AI path the Arabic-Indic prices (`٢٫٥٠٠`, `١٫٨٠٠`, `٠٫٧٠٠`) parsed correctly and the feared name-corruption cases did not occur (§7). |
| `document_annotation` shape may differ and silently disable the AI path | `docs/audit/07-ocr-pipeline.md:635` (`OCR-15`) | **Not the observed cause.** The observed silent fallback was caused by an **empty** annotation (`{"categories": []}`) passing a validator that checks shape but not emptiness (§7). |
| "The app cannot run locally anyway — there is no `.env.local` and no base schema" | `docs/audit/02-api-routes.md:7-10` | **Superseded as a blanket statement.** A production standalone build was run against the live project and probed over HTTP (§1). |

The claim that the project has "eight, not nine" tables (`docs/PLAN.md:222-226`) is not
contradicted: the ninth is the `sufra_daily_counters` helper. What is superseded is only the
statement that the helper was unreachable through PostgREST.

## 7. OCR measured against the real provider

Six scans plus one raw provider probe were run against `mistral-ocr-latest`.

### Accuracy

| Document | Items expected | Extracted | Correct names | Correct prices | Missing | Invented |
|---|---|---|---|---|---|---|
| plain menu (AI path live) | 19 | 21 | 19 | 19 | 0 | 2 |
| plain menu (AI path empty) | 19 | 21 | 19 | 19 | 0 | 2 |
| table-laid-out (AI path empty) | 19 | 7 | **0** | **0** | **19** | 7 |
| table-laid-out (AI path live) | 19 | 26 | 19 | 19 | 0 | 7 |
| Arabic/French (AI path empty) | 15 | 2 | **0** | **0** | **15** | 2 |
| Arabic/French (AI path live) | 15 | 17 | 15 | 14 | 0 | 2 |

All six scans returned **HTTP 200** with no provider or pipeline error.

### Per-scan facts

- **3 of 6 scans returned `aiItems: 0`** and silently degraded to the deterministic parser
  (`stats.source: "fallback"`, `model: "local-parser"`).
- **Root cause, isolated with a controlled A/B on the SAME image — two independent defects:**

  1. `documentText` (`src/lib/menu-scan.ts:386-394`) reads `t?.markdown`, but the provider
     returns table bodies in **`t.content`**. The raw payload proves it:

     ```json
     {"id":"tbl-0.md","content":"|  Espresso | 1.200  |…","format":"markdown"}
     ```

     while `page.markdown` keeps only `[tbl-0.md](tbl-0.md)` placeholders; the log showed
     `chars=280 tables=5`, i.e. five tables contributed nothing.
  2. The annotation prompt tells the model to return only the dishes of the **target venue**, so
     a typed venue that does not match the name printed on the document yields
     `{"categories": []}`. `annotationCategories` validates shape but not emptiness, so that
     empty result produced **no log line** and silently fell back. The A/B on the same PNG:
     venue `"ZZ Test Cafe"` → `aiItems=0`; the venue printed on the image → `aiItems=19`.

- **Prices parse correctly where they are found**: `6 500→6.5`, `1,500→1.5`,
  `4.500 DT→4.5`, and Arabic-Indic `٢٫٥٠٠→2.5`, `١٫٨٠٠→1.8`, `٠٫٧٠٠→0.7` were all correct, with
  no currency symbols left inside item names. The audit's feared name-corruption cases did not
  occur on this path.
- **Invented rows on 6/6 scans** (2–7 each): the address/phone line became a product priced
  **9999** (the phone digits assembled and clamped by `sanitizePrice`'s ceiling) and the footer
  `Prix en dinars · Service compris` became a product at price 0.
- **Verbatim `FINAL` log lines** (real, field names as logged). Failed AI, deterministic fallback:

  ```
  [menu-scan] FINAL strategy=reconcile source=fallback model=local-parser categories=6 items=21 aiItems=0 parserItems=21 ms=3375
  ```

  Working AI scan:

  ```
  [menu-scan] FINAL strategy=reconcile source=ai model=mistral-ocr-latest categories=5 items=21 aiItems=19 parserItems=21 ms=3296
  ```

## 8. Migration rehearsal, and why the live run is safe to recommend

A fixture reproducing the live shape was built and migrated with the repository's four migration
files, in order:

`_shim_storage` → fixture → `0001_init_schema.sql` → `1002_production_readiness.sql` →
`1003_live_db_repair.sql` → `1004_session_hardening.sql`

The fixture reproduced the live hazards: PKs without defaults, a lowercase-only role check, a
`workers.id` FK to `auth.users`, two rogue triggers with names unlike anything in the repository,
`numeric(x,2)` money, no uniqueness, and the extra live-only columns.

**Result: every file exited 0 with no error.**

Convergence was verified afterwards:

- only `sufra_orders_set_day` remains on `orders`, and nothing on `order_items`;
- an inserted `9999` now stays `9999`;
- a manual line's `0.010` price survives;
- a worker with role `Cashier` inserts and receives a generated id;
- the four UNIQUE constraints exist;
- money is scale 3;
- `workers.session_expires_at` exists;
- the original data (1 restaurant, 6 tables, slug `ahmed-coffeee`) is intact.

The rehearsal exposed and fixed a **real robustness bug in `0001_init_schema.sql`**: its
`restaurants.owner_id` FK was added unguarded, so a single orphan `owner_id` would raise
**`23503`** and abort the entire schema migration, taking every later object with it. It now
counts orphans first and degrades to a loud, actionable warning while letting the rest of the
migration proceed.

Live preconditions were checked before recommending the run:

- the restaurant's `owner_id` **does exist** in `auth.users` (so the FK will apply, with no orphan
  warning);
- there are **zero duplicates** on all four new UNIQUE rules (so none of them can raise).

## 9. Cleanup proof

Every fixture created during verification was removed, and the database was returned to its exact
prior state, re-verified by count and by content:

- 1 restaurant
- 0 categories
- 0 products
- 6 tables
- 1 order (`#1001`)
- 1 order item (`3 × kahwa kahla @ 3`)
- 0 workers
- 0 worker_invites
- 7 auth users, with no test account remaining

## 10. Still not verified

Stated plainly — none of the following was proven, and no claim in this document should be read
as covering them:

- **No load, soak, concurrency or memory measurement** was performed against the live project.
- **No browser was driven.** The onboarding wizard, the worker terminal and the guest cart were
  never exercised through the UI, only through their HTTP endpoints. There is still no automated
  end-to-end UI test.
- **Google OAuth was not exercised** (deliberately deferred).
- **Password-reset email delivery** depends on the project's SMTP configuration, which was not
  inspected; the link **generation** path was not exercised either.
- **The OCR fixes for the two root causes were not re-measured against the provider** afterwards
  — the scan quota budget was spent. The accuracy table in §7 describes the code as it was when
  measured, not as it is after the fixes.

## 11. Running against a real Supabase stack: what only that could reveal

§8 rehearsed the migrations on **plain Postgres, connected as the superuser**. §1–§9 ran the app
against the **hosted** project, where Supabase's own defaults had already granted the app's role
what it needed. Neither environment can reproduce what a **self-hosted Supabase stack** produces,
because neither runs the app as the role it actually uses, against a database nobody has
pre-granted anything on. A local stack (Postgres 17 + GoTrue + PostgREST + Storage in Docker, with
the four migrations applied by `supabase db reset`) was therefore run as a third environment. It
found two genuine defects that neither a source read nor a superuser rehearsal had surfaced.

Findings (a) and (b) are defects. (c) and (d) are environment facts that will otherwise cost an
afternoon. (e) and (f) are the positive result: the fresh-project track works, and the flows the
live database blocked (§3, §5) pass.

### (a) `service_role` had no table privileges on a fresh project

`0001_init_schema.sql` created the tables but granted nothing on them. On the fresh stack the role
the application actually runs as — `service_role` — came out holding only **`REFERENCES`,
`TRIGGER` and `TRUNCATE`** on `public.restaurants`, and every query failed:

```
42501  permission denied for table restaurants
```

PostgREST logged the same code. `POST /api/auth/signup` folded it into a generic `500`, so the UI
said "Couldn't create this account." and gave no hint that the cause was a missing `GRANT` rather
than bad input.

Why the hosted project never showed this: creating a table does **not** grant access to it — the
creating role owns it and that is all. The hosted project already carried Supabase's default
privileges for `service_role`; a freshly reset database does not.

Fixed in this repository:

- `0001_init_schema.sql` **§7** — `GRANT USAGE ON SCHEMA public` plus `ALL` on all tables,
  sequences and functions, and `ALTER DEFAULT PRIVILEGES` so a later migration that adds a table
  cannot silently reintroduce the `42501`.
- `1002_production_readiness.sql` **§11** — the same grants, idempotent, so an already-migrated
  database is repaired by re-running the file.

`anon` and `authenticated` are deliberately **not** granted: this product has no anon or user-JWT
database path, and leaving them unauthorised is strictly safer than granting access that RLS would
then have to contain.

**Why the earlier rehearsal missed it: it connected as the superuser, which bypasses privilege
checks entirely. A plain-Postgres rehearsal cannot validate grants.** Privileges are only enforced
for a role that is neither the superuser nor the table's owner — which is exactly the role the app
runs as, and exactly the role no earlier environment used.

### (b) The shared-client session contamination (a live-only, process-wide defect)

`supabaseAdmin` is a module-level **singleton** built with the service-role key. In supabase-js,
`signInWithPassword` and `verifyOtp` store the resulting session **on the client they are called
on**, and that client then sends the session's access token as the `Authorization` header on every
later PostgREST request from it. Three routes were calling those methods on the shared client —
`/api/auth/login`, `/api/auth/signup`, and `/api/auth/reset` (which calls `verifyOtp` *and*
`signInWithPassword`).

The consequence was not "one request signs in". It was that **one sign-in re-authenticated the
entire long-lived server process as that user**, so every later database request — including other
users' — ran as `authenticated` under RLS instead of as the service role. Proven on the local
stack, same process, same request:

```
before any sign-in:  GET /api/menu -> 200 ; PostgREST logged 200
after one login:     GET /api/menu -> 503 ; PostgREST logged
   403 {"code":"42501",
        "hint":"... GRANT SELECT ON public.restaurants TO authenticated;"}
```

Note the tell: this is the same SQLSTATE as (a), but the `hint` names a **different identity** —
`authenticated`, not `service_role`. The request had silently changed who it was.

**Why the live database masked it.** Supabase's default privileges give `authenticated` broad table
access, and the RLS owner policies happened to allow the owner's own rows. Signing in as the owner
of the only restaurant therefore produced correct-looking responses, and nothing in §1–§9 exercised
a second identity. The defect was invisible on a single-tenant live project with permissive
defaults, and fatal on a database whose privileges are explicit — which is what a hardened
production project will be.

Fix location: `src/lib/supabase-admin.ts` now exports `createSessionAuthClient()`, a fresh
throwaway client, and the four call sites use it. The file's header comment carries the full
explanation, including why `resolveOwnerSession`'s `auth.getUser(jwt)` and every `admin.*` call are
**not** affected (they pass the token per request and install no session).

Guard: `src/app/api/__tests__/session-client-isolation.test.ts` asserts, per client, that
`signInWithPassword` (login, signup, reset) and `verifyOtp` (reset) run on the throwaway client
**and not** on the shared `supabaseAdmin` client. That negative assertion is the one that fails if a
route reverts; while the test fake handed the same object back for both names, the two assertions
could not disagree, which is precisely why every earlier suite passed with the defect in place.

### (c) `NEXT_PUBLIC_SUPABASE_URL` is baked in at BUILD time

Next inlines `NEXT_PUBLIC_*` into the server bundle as well as the client bundle. A build made while
`.env.local` (or the shell) held one project's URL produces an application that talks to **that**
project forever, no matter what the runtime environment says, and **nothing in the UI indicates
which database it is talking to**. Observed directly: a bundle built with the production URL present
kept calling production after the runtime env was repointed at the local stack.

The Docker path is safe only because the image builds with **no** env present — the builder stage in
`Dockerfile` injects nothing, and `docker-compose.yml` supplies `NEXT_PUBLIC_SUPABASE_URL` at
runtime via `env_file`/`environment`, so there is no build-time value to bake in. That is a property
of the build, not of the code: adding an `ARG`/`ENV` for that variable before `npm run build` would
reintroduce the problem silently.

**If you ever see the app talking to the wrong database, check the build env first.** Before
debugging DNS, credentials or the stack, rebuild with no `NEXT_PUBLIC_*` in the environment and
point the runtime variables at the project you meant.

### (d) Local Supabase ports, and the two services that must stay off

`supabase/config.toml` uses **54421–54424** (with shadow port 54420) rather than the CLI defaults.
This is not cosmetic: another Supabase project on this machine (`fundu`) already holds
54321–54324, and `supabase start` refuses to boot when a port is taken. Shifting this project's four
public ports lets both stacks run at once. Set them back to 543xx on a machine where nothing else is
listening.

`[analytics]`, `[realtime]` and `[edge_runtime]` are disabled there. The app uses Postgres, Auth,
PostgREST and Storage and nothing else — there is no Realtime subscription, no edge function and no
Logflare client in `src/`. Leaving them on is also how `supabase start` fails on this machine: the
**analytics (Logflare) container comes up `unhealthy` and the CLI then tears the whole stack down**,
even though Postgres, Auth, REST and Storage were already up and the migrations had applied
successfully.

### (e) The fresh-project track works, and the resulting schema is correct

All four migrations applied cleanly to an **empty** database via `supabase db reset`
(`0001_init_schema.sql` → `1002_production_readiness.sql` → `1003_live_db_repair.sql` →
`1004_session_hardening.sql`). The resulting schema was then verified directly:

| Check | Observed |
|---|---|
| Tables | **9** |
| Triggers on `orders` | only `sufra_orders_set_day` — no rogue trigger |
| Money columns | scale **3** |
| `workers.id` | defaulted (an insert without an `id` succeeds) |
| `workers` → `auth.users` | **no FK** (token-session worker model) |
| `workers_role_check` | accepts `Cashier` / `Manager` |
| `workers.session_expires_at` | present |
| UNIQUE constraints | **5** — `restaurants_slug_key`, `restaurant_tables_restaurant_id_qr_token_key`, `restaurant_tables_restaurant_id_table_number_key`, `worker_invites_invite_token_key`, `workers_session_token_key` |
| `menu-images` bucket | public, 5 MB (`5242880`), MIME allowlist `image/jpeg`/`image/png`/`image/webp` |

### (f) End-to-end flows that now pass on the local stack

Driven through the running app against the local stack, with the observed values:

| Flow | Observed | Previously possible against the live DB |
|---|---|---|
| Owner **signup** on an empty database | account created, session cookie set | yes |
| **Menu publish** with a `4.755` price | persisted and read back as exactly `4.755` | **no** — live money columns were `numeric(x,2)` and rounded it to `4.76` (§4) |
| **Guest menu page** | **200** for a real `qr_token`; **404** for a bad token; **404** for a bad slug | yes |
| **Guest order** | received ticket **`#1001`** — the designed atomic number | **no** — the live rogue trigger overwrote it and returned `1` (§3) |
| **`client_ref` replay** | returned the **same** order: one row, total `12.200` | partly — replay is idempotent, but the ticket number was wrong live |
| **Worker invite → accept → `/me`** | invite accepted, `/me` resolved the worker, the invite **burned**, a second claim **refused** | **no** — worker creation was impossible live (`23514` role check, `23502` missing `id` default, §3) |
| **Worker manual order** with a custom line | **200**, the line's `0.010` price preserved, total `9.520` | **no** — this failed **100 %** of the time live (rogue price trigger, §3) |
| **Worker attribution** | stamped from the **session**, not from the request body | **no** (needs a worker row) |
| **Reopen gate** | a Manager reopening (`status: "pending"`) was refused with **403** `"Your role cannot reopen orders."` | **no** (needs a worker row) |
| **Mark paid** | Manager allowed, Cashier refused | **no** (needs a worker row) |

Stated plainly: these observations are from the **local** stack, not the hosted project. They are the
evidence that the repository's own migrations produce a working schema and that the application
behaves correctly on it, which is what §8's recommendation rests on. The hosted project still needs
the migration run before the same flows can be expected to pass there.
