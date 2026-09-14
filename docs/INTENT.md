# Sufra — What this application was trying to be

Reconstructed from the code, not from the README. The owner's own description of the goal:
let a restaurant or coffee shop photograph its printed menu, have it turned into a digital menu,
print one QR code per table so guests scan it to browse **and order**, and have those orders go
straight to the owner so he can prepare them with minimal effort — well enough to win the first
customers, and to satisfy his brother.

Every claim below is anchored to `file:line` or to a finding ID from `docs/audit/01..07`.
Where the audits disagree, the finding IDs are kept, and the disagreement is called out.

> **Provenance — this reconstruction describes the repository as it was handed over.** It was
> written by re-reading the tree rather than the README, so it records the product the code was
> *trying* to be at that point — including the defects that stood in its way. A remediation pass has
> since closed most of those findings; treat the blockers named here as history, not as the current
> state. For what is fixed and what is still open **now**, read `docs/PLAN.md` §"Status right now".

---

## 1. The product in one paragraph

Sufra is a QR-menu and table-ordering tool for a single café or restaurant. The owner signs in with
an email and password, builds a menu (by hand, or by pointing the phone at the printed menu and
letting an OCR service read it), picks a brand colour and one of four guest themes, and prints a
sheet of QR codes — one per table. A guest sitting at table 7 scans that code with their phone
camera, gets the restaurant's menu in their own language, fills a cart and sends the order without
installing anything or creating an account. The order appears seconds later on a screen behind the
counter, where a worker accepts it and, when the guest pays, marks it paid. There is no money in
the app: it replaces the waiter's notepad and the walk to the counter, not the cash register.
(`src/app/page.tsx:369` landing; `src/app/onboarding/page.tsx:165` menu builder;
`src/app/menu/[slug]/[token]/page.tsx:9` guest menu; `src/app/(worker)/worker/dashboard/page.tsx:48`
order board; `src/app/api/orders/route.ts:185` order intake.)

---

## 2. The actors, and what each one actually does

### Guest — unauthenticated, ordered by table

| Capability | Where |
|---|---|
| Open the menu from a QR code, with no account | `src/app/menu/[slug]/[token]/page.tsx:9` — a server component that resolves the `(slug, qr_token)` **pair** (`:23`, `:41-49`) and calls `notFound()` on a mismatch (`:26`, `:49`) |
| Browse categories/products, switch language | `src/components/guest-menu.tsx` (only `is_available = true` rows, filtered server-side at `menu/[slug]/[token]/page.tsx:39`) |
| Add to cart and submit an order | `src/components/guest-menu.tsx:119-148` → `POST /api/orders` (`src/app/api/orders/route.ts:185`), public by design |
| Order without trusting the client | The browser sends product ids + quantities only; prices/names are resolved from `products` and the total recomputed (`src/app/api/orders/route.ts:138-181`; `src/lib/order-utils.ts:21-32,165-181`) — confirmed sound by `LIB`/`API` verified-working lists |

The guest has **no** identity, no account, no order history and no read access to orders:
`GET /api/orders` is owner/worker only (`src/app/api/orders/route.ts:38-40`, `FE-05`).

### Owner — Supabase email/password, HttpOnly cookie

| Capability | Where |
|---|---|
| Sign up / sign in | `POST /api/auth/signup` (`src/app/api/auth/signup/route.ts:24`), `POST /api/auth/login` (`src/app/api/auth/login/route.ts:12`); session cookie built and parsed in `src/lib/owner-auth.ts` (`:80-98`, `:215-221`) |
| Every `/dashboard/*` page is server-guarded | `src/app/(owner)/dashboard/layout.tsx:5-8` (`getOwnerSessionForRsc()` → `redirect("/auth/login")`) |
| Build the menu by hand, in a 5-step wizard | `src/app/onboarding/page.tsx:165`; autosave via `src/lib/onboarding-store.tsx:252-270` |
| Read a printed menu with OCR | `POST /api/menu/scan` (`src/app/api/menu/scan/route.ts:45`; owner-only, 10/min, `maxDuration = 120` at `:16-17`) |
| Edit the menu afterwards | `src/app/(owner)/dashboard/menu/page.tsx:25` → `PUT /api/menu` (`src/app/api/menu/route.ts:134`), ownership-checked and validated (`src/lib/menu-sync-guard.ts`) |
| Upload dish photos | `src/app/api/upload/route.ts:73` (owner or worker; 5 MB, jpeg/png/webp; `menu-images` bucket) |
| Generate and print one QR per table | `src/app/(owner)/dashboard/tables/page.tsx:16` (`generateTables`, QR built as `${base}/menu/${slug}/${token}` at `:24-25`) |
| Mint a one-time invite so a worker can log in | `src/app/(owner)/dashboard/workers/page.tsx:55` → `POST /api/auth/worker/invite` (`src/app/api/auth/worker/invite/route.ts`), 24 h TTL |
| See revenue/order stats | `src/app/(owner)/dashboard/page.tsx:24` (stat cards + charts, `:55-63`) |
| Accept orders and mark them paid | `src/app/(owner)/dashboard/orders/page.tsx:22` → `PATCH /api/orders/[id]` (`src/app/api/orders/[id]/route.ts:25`) |
| Revoke a worker | `DELETE /api/workers/[id]` (`src/app/api/workers/[id]/route.ts:13`) — implemented, **no caller anywhere** (`API-13`) |

### Worker / cashier — invite-token session, not a Supabase user

| Capability | Where |
|---|---|
| Redeem an invite and pick a name | `src/app/(worker)/worker/invite/[token]/page.tsx:292` → `POST /api/auth/worker/accept` (`src/app/api/auth/worker/accept/route.ts:32`); worker row inserted, then the invite is claimed conditionally (`:103-114`) |
| Carry an opaque server-minted session | 256-bit token on `workers.session_token` (`supabase/migrations/1002_production_readiness.sql:148-149`; `src/lib/worker-auth.ts:65-69`), delivered as the `sufra_worker_session` HttpOnly cookie (`accept/route.ts:130-136`) |
| Resolve its own identity from the session | `GET /api/auth/worker/me` (`src/app/api/auth/worker/me/route.ts`) — identity is never taken from the request body (`src/lib/worker-auth.ts:31-57`) |
| Work the order board | `src/app/(worker)/worker/dashboard/page.tsx:48`; accept (`:85`) and mark paid behind a Manager check (`:95`) |
| Take an order at the counter (walk-in) | `src/components/dashboard/worker-new-order.tsx` → `POST /api/orders` — **100 % broken today**: the dialog posts `tableNumber`, the API schema requires `tableToken` (`API-1`) |
| Role matrix | `src/lib/worker-permissions.ts` + `PATCH` gate at `src/app/api/orders/[id]/route.ts:71-79` (`canMarkPaid` is enforced; the documented "owners alone may reopen" gate is **not** — `LIB-01`, `API-5`) |

---

## 3. Feature inventory, derived from the routes

Sources: `src/app/**/page.tsx` (13 pages) and `src/app/api/**/route.ts` (19 route files), then
cross-checked against `README.md`. "Works today" means *per the audits*, with the app properly
configured (base schema + env) unless stated otherwise.

| Feature | Where it lives | Works today? | Blocked by |
|---|---|---|---|
| Landing page, EN/FR/AR + $/€ demo switcher | `src/app/page.tsx:369` | Renders | `I18N-17` (English-only metadata), `I18N-19` (demo prices authored in USD) |
| Onboarding wizard (identity → branding → categories → products → preview) | `src/app/onboarding/page.tsx:165` | Renders and is fully interactive, but **nothing is saved** | `FE-01` (no session, no signup hand-off), `FE-02` (first-save failure invisible), `FE-12` (no flush on unload) |
| Publish a menu to the server | `src/lib/onboarding-store.tsx:226-270` → `PUT /api/menu` (`api/menu/route.ts:134`) | Write path exists and is ownership-checked | `FE-01`/`FE-02`, `DB-01` (no base schema), `DB-02` (column contract), `API-2` (empty-menu wipe), `API-3` (write before checks) |
| Menu OCR scan (photo/PDF → menu) | `src/app/api/menu/scan/route.ts:45`, `src/lib/menu-scan.ts`, `src/lib/menu-import.ts`, `src/lib/ocr-quality.ts` | Implemented, never measured live | `OCR-02`, `OCR-03`, `OCR-04` (parser mis-reads real price/table layouts), `OCR-05` (gate rejects real menus), `OCR-06` (no timeout), `OCR-01` |
| Image upload → Supabase Storage | `src/app/api/upload/route.ts:73` | Works (rate-limited, allow-listed) | `API-17` (failure silently becomes a `data:` URL that breaks later saves); prior-art residual: MIME is client-declared |
| Restaurant signup (binds the account to a restaurant row) | `src/app/auth/signup/page.tsx` → `api/auth/signup/route.ts:24` | Works against a database | `API-7` (no rate limit, account-existence oracle), `API-10` (partial provisioning) |
| Owner login / logout | `src/app/auth/login/page.tsx`, `api/auth/login/route.ts:12`, `api/auth/logout/route.ts:5` | Works | `FE-09` (login unreachable from the landing page), `LIB-03`/`LIB-02` (logout revokes nothing server-side) |
| Password recover / reset / change | `api/auth/recover/route.ts:21`, `reset/route.ts:17`, `password/route.ts:15`; `src/app/auth/{forgot,reset}/page.tsx` | Endpoints work; **the form lies** | `FE-15` (reports success when nothing was sent), `INFRA-07` (shipped `NEXT_PUBLIC_APP_URL=localhost` breaks the link) |
| Owner dashboard overview (stats, charts) | `src/app/(owner)/dashboard/page.tsx:24` | Renders zeros after a client-side sign-in | `FE-08` (hydration runs once, auth change does not re-run it) |
| Menu editor | `src/app/(owner)/dashboard/menu/page.tsx:25` | Renders | `FE-13(c)` (failed hydration looks like an empty menu, then autosaves), `LIB-06`/`API-14` (slug rewritten on every save), `LIB-05`/`LIB-09` (unvalidated fields reach the DB) |
| Tables + QR codes | `src/app/(owner)/dashboard/tables/page.tsx:16` | Generates and prints | `FE-11` (toasts success and prints even when nothing was published), `FE-10` (wizard shows a `menuos.app` URL that does not exist), `LIB-06` (renaming breaks printed codes) |
| Guest menu (browse, cart, submit) | `src/app/menu/[slug]/[token]/page.tsx:9`, `src/components/guest-menu.tsx` | Renders and submits | `FE-03` (duplicate orders), `FE-04` (dead-end 409/404), `FE-05` (cart and order number vanish on refresh), `FE-16` (unbranded 404) |
| Order intake, server-priced and idempotent | `src/app/api/orders/route.ts:185` | Sound at the API level | Client defeats idempotency (`FE-03`); worker path dead (`API-1`) |
| Order board (owner + worker), 3 s polling | `src/lib/use-orders.ts:31-55`; `(owner)/dashboard/orders/page.tsx:22`; `(worker)/worker/dashboard/page.tsx:48` | Polls and renders | `LIB-07` (stale overwrite, pile-up), `FE-14`/`API-8` (false success), `FE-13` (silent failures), `FE-08` (local mode) |
| Accept / mark paid | `PATCH /api/orders/[id]` (`orders/[id]/route.ts:25`) | Role gate and ownership are real | `FE-14`/`API-8` (client toasts before the server answers), `LIB-01`/`API-5` (reopen unguarded) |
| Worker invite create | `src/components/dashboard/invite-dialog.tsx` → `api/auth/worker/invite/route.ts` | Works when the DB accepts the row | `API-9` (no rate limiter), `FE-06` (5xx fabricates a local-only link), `DB-13`/`DB-17`/`DB-20` (live-schema blockers on the original project) |
| Worker invite accept | `(worker)/worker/invite/[token]/page.tsx:292` → `api/auth/worker/accept/route.ts:32` | Server-validated | `FE-06`/`API-6` (429/5xx degrade to a fabricated local session) |
| Worker terminal | `(worker)/worker/dashboard/page.tsx:48` | Renders | `FE-07` (client-only gate; a forged `localStorage` entry yields an interactive terminal) |
| Worker take-order at the counter | `src/components/dashboard/worker-new-order.tsx` | **Broken** | `API-1` (posts `tableNumber`, API requires `tableToken` → 400 every time) |
| Worker list / revocation endpoints | `api/workers/route.ts:9`, `api/workers/[id]/route.ts:13` | Implemented | `API-13` (no caller; the owner page reads the local store instead) |
| Owner settings | `src/app/(owner)/dashboard/settings/page.tsx:13` | Renders | No slug or currency control (`FE-02`, `I18N-14`) |
| `/api/health` (declared by `docker-compose.yml:45`) | **does not exist** | — | `INFRA-04` |
| Rate limiting on paid/abusive endpoints | `src/lib/rate-limit.ts` | Present on 8 of 9 routes | `API-9` (invite has none), `API-11` (inconsistent `Retry-After`), `LIB-08` (spooffable key), `LIB-20` (env kill-switch) |
| Auth session introspection | `src/app/api/auth/session/route.ts:4` | Works | — |

### Where the README claims something the code does not do

| README claim | Reality | Finding |
|---|---|---|
| `README.md:10` "all prices are shown in dinars on the guest menu" | The guest menu renders `<LangCurSwitcher />` with TND/USD/EUR and `formatPrice` multiplies by `RATES` (`0.31`/`0.29`), while the kitchen receives unconverted TND | `I18N-01` |
| `README.md:83` "`products.sort_order` — stable menu ordering" | Nothing in `src/` reads or writes `products.sort_order`; the column, index and backfill are dead weight | `DB-18`, `LIB-12` |
| `README.md:77-78` migration "is idempotent, safe to re-run" | The dedupe block renumbers already-issued tickets on every re-run, and the CHECK additions can abort mid-run | `DB-07`, `DB-12` |
| `README.md:82` "`orders.client_ref` — idempotent re-submission (double-click safe)" | The server design is correct, but the guest mints a **new** `clientRef` per attempt and the worker dialog sends none | `FE-03`, `API-1` |
| `README.md:47-48` "Roles (Cashier, Manager) are enforced server-side on every order mutation" | Only `canMarkPaid` is enforced; reopening to `pending` has no role gate | `LIB-01`, `API-5` |
| `README.md:35-37` "every protected route verifies the caller's session server-side" | True for API routes; the worker dashboard is client-guarded only, and `/onboarding` has no guard at all | `FE-07`, `FE-01` |
| `README.md:90-100` "live tables (columns the app actually uses)" | Disagrees with both code and migration: `orders.table_id`, `worker_invites.used_by`, `restaurants.updated_at`, `products.updated_at` are used but unlisted; `products.sort_order` is listed but unused | `DB-02`, `DB-18` |
| `README.md:64-68` "`docker compose up --build` serves on :3000" | Fails twice before producing a container: missing `.env.local`, then `COPY /app/public` on a directory that does not exist | `INFRA-03`, `INFRA-01` |
| `README.md:55-59` the four check commands | The committed lockfile cannot install `vitest`, so `npm ci` (and therefore CI) fails outright | `INFRA-02` |
| `README.md:134-139` "the app never hard-codes `localhost` … every URL is derived from the browser origin" | `appBaseUrl()` returns the hardcoded `https://sufra.app` on the server, and the wizard's "scan link" is hardcoded to `menuos.app` | `LIB-24`, `FE-10` |
| `README.md:26-33` environment table | `SUFRA_PLACEHOLDER_OWNER_EMAIL` is read by signup but missing from `.env.example` (the enforced handoff contract) | `INFRA-08` |
| `README.md:200,326` "Unit tests (72 total)" | The repository actually holds 124 tests across 7 files (`docs/audit/04-lib-core.md` test table; the README counts only the two OCR files) | `INFRA-02` (and the orchestrator's measurement) |
| `README.md:3-6` "order straight to the dashboard in real time" | Visibility is a 3 s full-list poll with no Realtime subscription anywhere, no in-flight guard and no visibility handling | `LIB-07` |

---

## 4. The intended journey, end to end, with where it breaks

```
OWNER                                   GUEST                         WORKER
 1 land on / ..........................
 2 CTA → /onboarding .................. ✗ FE-01 (no session, no signup link)
 3 build menu (5 steps) ...............
 4 optional OCR scan .................. ✗ OCR-02/05/06
 5 "Finish"/"Publish" ................. ✗ FE-11 (no saveNow; "Live" is unconditional)
 6 (silently) autosave → PUT /api/menu ✗ FE-01/FE-02 (401 → "Saved locally")
 7 sign up /auth/signup ............... ✗ FE-09 (nothing links here)
 8 /dashboard ......................... ✗ FE-08 (zeros until a hard reload)
 9 /dashboard/tables → print QR ....... ✗ FE-02/FE-11 dead QR; FE-10 wrong URL
10 mint invite ........................
                                         11 scan QR → /menu/<slug>/<token>
                                         ✗ FE-16 if the restaurant was never created
                                         12 browse, cart, submit → POST /api/orders
                                         ✗ FE-03 dup · FE-04 dead end · FE-05 lost cart
13 board updates within ≤3 s .......... ✗ FE-08 · LIB-07 · FE-13
14 accept → PATCH /api/orders/:id ..... ✗ FE-14/API-8 (false success)
15 mark paid .......................... ✓ role-gated (LIB-01 reopen still open)
16 counter order (walk-in) ............ ✗ API-1 (400 every time)
17 revoke a lost worker device ........ ✗ API-13 (no caller) · LIB-02 (no expiry)
```

**The failed-first-save path — the one that silently destroys the owner's work.** This is the chain
the audits care about most, and it is reproducible with no bad luck at all:

1. The landing page's every CTA points at `/onboarding` (`src/app/page.tsx:117,169,316`) and that
   route has no session check (`src/app/onboarding/page.tsx:1,165-167`; `FE-01`).
2. Autosave fires after any change (`src/lib/onboarding-store.tsx:252-270`) and the `PUT` answers
   `401 UNAUTHORIZED` without an owner session (`src/app/api/menu/route.ts:140-143`).
3. `saveNow` maps that to the `"local"` state (`src/lib/onboarding-store.tsx:240-244`) and the UI
   renders "Saved locally" (`src/components/dashboard/save-status.tsx:11-18`, `i18n.tsx:127`) —
   which reads as success.
4. On the *first* save `restaurantId` is still `null`, so `isCloud` is false
   (`src/lib/onboarding-store.tsx:533`) and **the `"error"` branch of the status pill is
   unreachable** (`save-status.tsx:35-41`) — so a genuine `409 SLUG_TAKEN` or a 5xx is also shown as
   "Saved locally" (`FE-02`).
5. The wizard then reports "Live" unconditionally (`src/components/onboarding/step-preview.tsx:118-121`),
   and `/dashboard/tables` toasts success and prints QR PNGs the moment local state changes
   (`src/app/(owner)/dashboard/tables/page.tsx:27-48`) — for a restaurant that does not exist.
6. Every guest who scans gets a 404 (`FE-16`), and the owner cannot recover from the UI: the slug is
   derived from the restaurant name (`src/lib/menu-mapping.ts:100`) and is editable nowhere
   (`FE-02`).

---

## 5. Design decisions the developer clearly made on purpose

These are recovered from code comments and structure, and each one is a place where the *intent* is
sound. The point of this list is to stop a future maintainer from "fixing" a deliberate design
while the actual defect sits somewhere else.

| # | Decision (with the comment that documents it) | Rationale | Did the audits find it sound? |
|---|---|---|---|
| 1 | **Server-authoritative pricing.** Catalog lines are `.strict()` (extra keys rejected), the total is recomputed from `products.price` × qty (`src/lib/order-utils.ts:21-32,76,165-181`; `src/app/api/orders/route.ts:171-181`) | A browser must never be able to name a price | **Yes.** `LIB`/`API` verified-working: a tampered `price`/`total` is a 400, not a discount; 25 hostile payloads in prior art were all rejected |
| 2 | **No anon Supabase client at all.** One service-role client, server-only (`src/lib/supabase-admin.ts:7-18`); the browser never holds a key | Removes the whole class of RLS-misconfiguration leaks | **Yes** (`DB` verified-working: no client component imports it). Consequence to respect: locale can never be resolved server-side today (`I18N-02`) |
| 3 | **Two extraction paths, always both, merged by a reconciler.** Comment at `src/lib/menu-scan.ts:474-477`; rules in `README.md:213-217` (union of categories, parser price wins, AI spelling wins, `name\0category` disambiguation) | The LLM annotation is stochastic; the deterministic parser is the baseline that guards against "found fewer categories than last time" | **Intent yes, implementation no.** `OCR-01` proves `reconcileImports` can drop parser products, violating the documented invariant `final >= max(ai, parser)` — fix the implementation, do not remove the second path |
| 4 | **`client_ref` as an idempotency key.** Partial unique index `(restaurant_id, client_ref)` (`1002_production_readiness.sql:109-111`) plus a targeted `23505`-on-`client_ref` recovery branch that returns the existing order (`src/app/api/orders/route.ts:368-405`) | A double-tap on flaky mobile data must not create two orders | **Yes at the DB/API layer** (`DB`, `API`, and the 100-way concurrency run in prior art: 100× same ref → 1 order). Defeated by the client (`FE-03`) and unused by the worker dialog (`API-1`) — fix the callers, keep the mechanism |
| 5 | **Atomic ticket numbering via an RPC**, with a max+1 fallback and retry (`1002:27-44`; `src/app/api/orders/route.ts:103-116`) | Daily ticket numbers must be unique under concurrency, and the fallback keeps the app alive on a half-migrated DB | **Yes.** `DB` calls the single-statement `INSERT … ON CONFLICT … RETURNING` race-free under concurrency; the fallback and the `order_day`-trigger design are correct. Risks are environmental: legacy triggers (`DB-17`) and the non-idempotent renumber step (`DB-07`) |
| 6 | **A quality gate before anything is imported**, "purely structural … never assumes a minimum number of categories or products" (`src/lib/ocr-quality.ts:9-14`), re-OCR up to `OCR_QUALITY_ATTEMPTS = 3` (`src/lib/menu-scan.ts:69`) | Never import garbage silently | **Intent yes, thresholds no.** `OCR-05`: the gate rejects legitimate 3-item menus and bold/`####` headings (after paying for three OCR calls) and accepts promo panels and 8-char junk |
| 7 | **Worker sessions are opaque server tokens on the `workers` row, not Supabase auth users.** `session_token text UNIQUE` (`1002:148-149`), resolved from Bearer/cookie (`src/lib/worker-auth.ts:31-69`), and `workers.id` is deliberately **not** an FK to `auth.users` (dropped at `1002:309-313`; prior-art F1) | A cashier must not need an email account, and must be revocable | **Yes** (`LIB` verified-working: CSPRNG tokens, Bearer precedence, identity never read from the body, unknown role degrades to least privilege). The gap is lifetime, not model: no server-side expiry and logout does not revoke (`LIB-02`) |
| 8 | **Owner sessions in an HttpOnly cookie, with the access token re-verified against Supabase on every request** (`src/lib/owner-auth.ts:80-98,215-221`) | A tampered cookie cannot mint a session, and rotation is lazy | **Yes**; the defect is termination — logout clears the cookie and the 60-day refresh token keeps minting access tokens (`LIB-03`) |
| 9 | **Slug uniqueness enforced in application code, with the missing constraint acknowledged in a comment** (`src/app/api/menu/route.ts:221` "in-app uniqueness; DB lacks a constraint") | Ship without a migration dependency | **No — this one is a real defect**, not a taste call: the check races (`DB-04`), runs *after* the write (`API-3`), and the slug is regenerated from the name on every save, breaking printed QR codes (`LIB-06`) |
| 10 | **Order payloads are `.strip()`, not `.strict()`** (`src/lib/order-utils.ts:76`) | Unknown fields are dropped rather than rejected, so an old client cannot be broken by a new field | **Yes** in effect (a forged `total`/`status` is dropped); note `LIB-23` — the test named "rejects stray top-level fields" asserts success and never checks the field was dropped |
| 11 | **A dev auth bypass that is impossible in production**: `NODE_ENV !== "production"` **and** `SUFRA_AUTH_DISABLED === "1"` (`src/lib/owner-auth.ts:28-39`) | Local work without a Supabase project | **Yes** (`LIB-14`, `LIB-21`: bypassed routes still resolve their restaurant from the DB; no client-supplied identity). Do not delete it — it is currently the only way to run the app at all (`LIB` open question 1). `LIB-20` flags the env flag's blast radius |
| 12 | **An offline/demo mode for worker devices**, documented in the shell and the layout (`src/components/dashboard/worker-shell.tsx:18-21`; `src/app/(worker)/worker/dashboard/layout.tsx:4-9`: "No server redirect here by design") | A worker tablet with no connectivity must still show a usable terminal | **Intent defensible, boundary wrong.** `FE-07` shows the gate is client-writable, and `FE-06` shows the fallback also triggers on 429/5xx — i.e. on the server *refusing*, not just on being offline. Keep the demo, restrict the trigger |
| 13 | **Millime (3-decimal) money in the display and OCR layers** (`src/lib/format.ts:1-8`; `src/lib/menu-import.ts:95`; `src/lib/menu-scan.ts:377`) | Tunisian dinar prices are quoted to the millime (e.g. 4.500) | **Contradicted by the order layer**, which rounds to 2 decimals (`src/lib/order-utils.ts:161-176`) — `LIB-04`. The audits flag this as an owner decision (2 vs 3 decimals), not something a maintainer should silently pick |
| 14 | **A per-table QR built from the `(slug, qr_token)` pair and validated server-side** (`src/app/(owner)/dashboard/tables/page.tsx:24-25`; `src/app/menu/[slug]/[token]/page.tsx:23,41-49`) | A code from an old print run, or a token from another restaurant, must not open a menu | **Yes** — this is one of the soundest parts of the app (`FE` verified-working). Its fragility comes from the *mutable* slug, not the design (`LIB-06`, `API-14`) |
| 15 | **Google OAuth deferred**, with the callback seam already built (`README.md`-era intent; `src/app/api/auth/callback/route.ts:18`, prior-art FINAL §1) | Scope control for a first customer | **Accepted** as a deliberate deferral; the seam is real but nothing links to it (`FE-09`) |

---

## 6. What the developer did NOT build

Factual gaps between the intent and the code — all confirmed by the audits, no product suggestions:

- **No payments.** Nothing integrates a payment processor; "paid" is a boolean flag flipped by
  `PATCH` (`src/app/api/orders/[id]/route.ts:82-86`), and `{status:"paid"}` is accepted even though
  the table's status domain is `pending`/`accepted` (`API` open question 6).
- **No printer or kitchen integration.** No ESC/POS, no receipt printing, no outbound webhook
  anywhere; the `n8n` service in `docker-compose.yml:51-66` is wired to nothing (`INFRA-05`).
- **No multi-branch / multi-restaurant UX.** Owner queries resolve a single restaurant row
  (`.eq("owner_id", …)` at `src/app/api/menu/route.ts:57`, orders "first restaurant by
  `created_at`" per the `API` route table), and there is no restaurant switcher; signup can rebind
  several placeholder rows (`API-10`).
- **No analytics beyond the overview stat cards and charts** (`src/app/(owner)/dashboard/page.tsx:55-63`).
- **No customer accounts, no guest order history and no "my order" view.** Guests cannot read
  orders at all (`src/app/api/orders/route.ts:38-40`; `FE-05`, `FE` open question 5).
- **No real-time transport.** Polling only — there is no Supabase Realtime subscription anywhere in
  `src/` (`LIB-07`, `PERFORMANCE-OCR-REPORT.md:38-49`).
- **No worker revocation wiring.** `DELETE /api/workers/[id]` exists with no caller; the owner
  workers page reads the local store instead (`API-13`).
- **No draft/published control.** `is_published` is always written `true`
  (`src/lib/menu-mapping.ts:107`) and the guest route never filters on it — an unpublished
  restaurant still serves its full menu publicly (`DB-23`).
- **No currency selection.** `restaurants.currency` is written `"TND"` once at insert and read
  nowhere (`src/app/api/menu/route.ts:198`; `I18N-14`).
- **No product ordering control**, despite the column, index and backfill shipped for it
  (`DB-18`, `LIB-12`).
- **No locale detection and no server-rendered locale.** `localStorage` only, so `dir="rtl"` is
  applied after hydration (`I18N-02`, `I18N-03`).
- **No route-level or end-to-end tests**, and `owner-auth.ts` has no test file at all; the
  deterministic OCR parser (`parseOcrMarkdown`) — the documented safety baseline — is untested
  (`docs/audit/04-lib-core.md` "Test quality"; `docs/audit/07-ocr-pipeline.md` "Coverage").
- **No error/not-found/loading boundaries** anywhere in `src/app` (`FE-16`).
- **No operational tooling**: no `db:migrate`, no seed script, no `format` script, no
  `start:standalone`, and CI never builds the Docker image or validates SQL (`INFRA-10`, `INFRA-06`).
- **No data-retention story for uploaded menu photos**: scanned documents are never deleted from
  Mistral's storage (`OCR-08`).

---

## 7. The three levels of "it works" — the punchline

The owner's acceptance criteria, in the order he cares about, with today's status:

**(a) An owner can build a menu, publish it, and print a working QR code. — NOT REACHABLE.**
The wizard is unreachable behind no auth at all and its saves are silently discarded (`FE-01`,
`FE-02`); the failure state is unreachable by construction (`FE-02`); "Publish"/"Live" are
cosmetic and "Finish" never calls `saveNow()` (`FE-11`); the wizard's own scan URL points at a domain
the product does not own (`FE-10`); the login page is unlinked from every public surface (`FE-09`).
Underneath it all, the repository ships **no base schema** — the only migration is an incremental
patch whose first statement fails on a fresh project (`DB-01`) — so even a correct owner cannot
persist a restaurant row. This level is the prerequisite for the other two, and it is the level that
is furthest from working.

**(b) A guest can scan the code and place an order. — PARTIALLY REACHABLE, once (a) holds.**
This is the healthiest slice of the product: the guest route validates the `(slug, token)` pair
server-side (`src/app/menu/[slug]/[token]/page.tsx:41-49`), the order endpoint is public but
server-priced and restaurant-scoped with real idempotency (`src/app/api/orders/route.ts:138-181`,
`:368-405`), and the cart is rendered from server-filtered, available products. It is still not
reliable enough for a paying customer: a timed-out retry creates a real duplicate order (`FE-03`),
an item that goes unavailable produces an unactionable 409/404 (`FE-04`), any refresh destroys the
cart and the order number the guest needs to prove their order (`FE-05`), and a bad token or a
restaurant that never reached the database lands on an unbranded English 404 (`FE-16`). With
Supabase unconfigured — the state of the repo as handed over — the only guest surface renders
"not live" (`menu/[slug]/[token]/page.tsx:16-18`).

**(c) The order reaches a screen, and can be accepted and marked paid. — PARTIALLY REACHABLE.**
The write path is the sound part: ownership is checked, the role matrix blocks a Cashier from
marking paid, and worker attribution is stamped from the verified session
(`src/app/api/orders/[id]/route.ts:58-79`, `:94-112`). What blocks it: the counter-order path is
100 % broken in the client (`API-1`), an owner who signs in sits in front of a local-mode board
showing zeros until a hard reload (`FE-08`), both dashboards toast success for mutations that the
server refused (`FE-14`, `API-8`), the 3 s poll can overwrite fresher state and piles up when the
backend is slow (`LIB-07`), and the documented "owners alone may reopen" rule is not enforced at all
(`LIB-01`, `API-5`).

**Summary.** None of the three levels is complete today. Level (b) is closest to working and
(c) is close behind it, but both depend on (a) — and (a) depends on the two facts the repository
cannot hide: there is no base schema (`DB-01`) and the project cannot even install its own test
runner from the committed lockfile (`INFRA-02`). The product's *architecture* was aimed at the
right target — server-priced ordering, per-table QR, opaque worker sessions, an idempotent order
path, and an OCR pipeline with a deterministic fallback — and most of that intent is intact in the
code. What is missing is the floor under it: a database, a working build path, and honest success
signals on the flows the owner and the guest actually walk.
