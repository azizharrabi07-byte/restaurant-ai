# Sufra — Consolidated Audit

**Repo:** `resto` (Sufra, QR menu & table ordering) · **Branch:** `rag-option` @ `3b8ad43`
**Scope:** the whole repository as handed over — application code, SQL, infra, content.
**This document is the index.** Per-slice detail lives in `docs/audit/01..07`; the product the code
was trying to be lives in `docs/INTENT.md`; the machine-readable findings index is `docs/FINDINGS.tsv`.

> **Provenance — this audit describes the repository as it was handed over.** The severity counts
> below, and the verdict that **the application cannot be stood up from the repository**, are
> statements about *that* state. A remediation pass has since closed most of the findings recorded
> here. For what is fixed and what is still open **now**, read `docs/PLAN.md` §"Status right now".
> In particular, §3's measurement table (124 tests / 7 files, 29 routes, a failed `npm ci`, a failed
> `docker build`) records the **pre-fix measurements deliberately**, as the evidence behind the
> findings — it is not a description of the current tree.

---

## 1. Executive summary

Sufra is a Next.js 15 / TypeScript / Tailwind v4 / Supabase QR-menu and table-ordering app for a
single café or restaurant: the owner builds a menu (optionally by photographing the printed one and
letting Mistral OCR read it), prints a QR code per table, and guests scan it to browse and order
without an account, with those orders arriving on an owner/worker dashboard where they are accepted
and marked paid. The architecture is, in places, genuinely good — server-authoritative pricing,
per-table token-validated QR routes, opaque server-minted worker sessions, an idempotent order path
keyed on `client_ref`, and an OCR pipeline that pairs a stochastic AI annotation with a deterministic
parser — and the pure logic is well covered by 124 unit tests.

**The single most important fact: the application cannot be stood up from the repository as handed
over.** There is no base schema anywhere — `supabase/migrations/1002_production_readiness.sql` is an
incremental patch that assumes eight tables already exist, so its first statement fails on a fresh
project (`DB-01`, `1002:28`); `npm ci` fails outright because the committed lockfile never contained
`vitest` and its dependency tree, which means CI has never actually run (`INFRA-02`); and the
documented Docker path fails twice — once on a `.env.local` that is not in the repo (`INFRA-03`) and
then on `COPY --from=builder /app/public` when no `public/` directory exists (`INFRA-01`).

Above that floor, the two flows the product exists for are broken end to end rather than merely
rough. The owner's funnel terminates in silence: `/onboarding` has no session check, every save is
discarded, and the UI reports "Saved locally" — including for the 409/5xx that means the restaurant
was never created (`FE-01`, `FE-02`, `FE-11`). The guest flow is the healthier half, but a
timed-out retry creates a real duplicate order because the client mints a fresh idempotency key per
attempt (`FE-03`), and the counter-order path is dead in code — the worker dialog posts
`tableNumber` while the API requires `tableToken`, so every worker-created order is a 400 (`API-1`).
Counts: **141 findings** across the seven slices — **11 Critical, 33 High, 54 Medium, 43 Low**.

---

## 2. How to read this audit

1. **Start here** for the state of the whole system, the ordered critical path (§6) and the
   corrections to the three prior reports (§7).
2. **`docs/INTENT.md`** reconstructs the product from the code: actors, a route-derived feature
   inventory, the intended journey with break markers, the design decisions that are deliberate, and
   the three levels of "it works" the owner actually cares about.
3. **Per-slice detail**, in the order a new developer should read them:
   `05-infra-devops.md` (can it run at all) → `01-database.md` (schema and every DB call) →
   `02-api-routes.md` (route contracts vs callers) → `04-lib-core.md` (auth, permissions, validation,
   polling) → `03-frontend-ux.md` (the two broken flows) → `07-ocr-pipeline.md` (the flagship feature)
   → `06-i18n-content.md` (3 locales, RTL, currency).
4. **`docs/FINDINGS.tsv`** is the flat index (`id, severity, slice, component, summary,
   source_report`) for automation; IDs are preserved exactly as each report writes them
   (`DB-01`, `API-1` unpadded, `INFRA-01`, `I18N-01`, `OCR-01` …).

---

## 3. Verification methodology, and its limits

**Verified by EXECUTING something** (measured by the orchestrator on this machine, Node 24.18 /
npm 11.16 / Docker 29.6.2 / Compose 5.3.1):

| Measurement | Result |
|---|---|
| `npx next build` | **Succeeds with zero environment variables**; 29 routes |
| `npx vitest run` | **124/124 passing**, 7 files, all under `src/lib/` |
| `npx tsc --noEmit` | 0 errors |
| `npx next lint` | clean |
| `npm ci` | **FAILED, `EUSAGE`** — the committed lockfile was missing `vitest` and its whole dependency tree (the lockfile was subsequently regenerated by the orchestrator) |
| `docker build` | **FAILED** at `Dockerfile:28` (`COPY --from=builder /app/public ./public` → `/app/public: not found`; no `public/` directory exists) |
| Repo state | no `.env.local`, no `supabase/config.toml`, and `docker-compose.yml` demanded a `.env.local` that did not exist |

**Verified by READING code, SQL and configuration only.** Everything in `docs/audit/01..07` is a
read of the tree, with each claim marked `VERIFIED` (read directly in a file) or `INFERENCE`
(derived, not directly observed). The OCR slice additionally *executed* pure functions
(`menu-scan.ts`, `menu-import.ts`, `ocr-quality.ts`) in a scratch REPL against constructed inputs.

**NOT verified — stated plainly:**

- **No live database was exercised.** There is no base schema and no credentials, so no SQL was run
  against any project, `pg_policies` / `pg_trigger` listings were never obtained, and the
  prior reports' live-schema probes describe the *original developer's* project, which is not this
  tree. Findings marked `INFERENCE` (for example `DB-14` column types, `DB-17` legacy triggers)
  remain inferences.
- **No paid Mistral call was made.** The OCR provider path was never exercised, so **OCR accuracy
  against the real provider is UNMEASURED** — both for the AI annotation and for the deterministic
  parser on real photographs. Every OCR conclusion below comes from executing the pure stages on
  constructed inputs plus the provider's published contract.
- **No browser was driven and no route was probed live.** There was no `.env.local`, so the dev
  bypass was inert and nothing was running; UI conclusions come from reading components and call
  sites, corroborated by the prior reports' live probes where they agree.
- **No load, soak, concurrency or memory measurement was performed by the new audits.** Prior-art
  numbers (100-way idempotency, limiter throughput, ~3.5 orders/s) were read and are cited as prior
  art, not re-measured — except where a new audit corrects them (§7, `OCR-07`).
- **The rate limiter, logout revocation, worker expiry and the reopen gate were not exploited
  end to end.** They are code-level findings (`LIB-01`, `LIB-02`, `LIB-03`, `LIB-08`) with stated
  repro paths.

The three prior reports at the repo root were read and treated as **prior art whose claims are not
ground truth**. Several of their claims were refuted; §7 lists them. They were also written against
the *original developer's live Supabase project*, which is no longer reachable from this repository
truth — so their live findings (C1–C3, H1–H5) must not be read as statements about this tree.

---

## 4. Findings by severity — master index

All 141 findings from the seven slices. IDs are each report's own string; click-through detail is in
the slice report named in §2. "Component" is the report's own component label.

_Note on counts: the assignment estimated "roughly 115" findings; the audits actually contain **141**
distinct finding IDs (`DB-01..24`, `API-1..17`, `FE-01..20`, `LIB-01..25`, `INFRA-01..18`,
`I18N-01..19`, `OCR-01..18`). Nothing has been sampled or omitted._

| Severity | ID | Component | One-line impact |
|---|---|---|---|
| Critical | `API-1` | POST /api/orders × worker-new-order.tsx | the worker New-order dialog posts tableNumber while POST /api/orders requires tableToken, so every worker-created order (including all custom lines) returns 400 BAD_BODY — 100% broken. |
| Critical | `API-2` | GET /api/menu + onboarding-store autosave | a swallowed PostgREST error in GET /api/menu is reported as an empty menu, and the client autosave then PUTs that empty state — deleting every product and every table of the restaurant ~900 ms later. |
| Critical | `DB-01` | migrations/base-schema | Nobody can stand the app up from the repo. |
| Critical | `DB-02` | schema contract | app writes columns no committed DDL accounts for (products.updated_at, orders.table_id, worker_invites.used_by, restaurants.updated_at), so PUT /api/menu 500s and every read can fail 42703. |
| Critical | `FE-01` | Onboarding wizard | a first customer clicks the hero CTA, builds an entire menu, sees "Saved locally" (which reads as success), and none of it ever leaves the browser. |
| Critical | `FE-02` | SaveStatus / onboarding-store | the first save is exactly the one that can fail (409 SLUG_TAKEN or 5xx) and the "Saved locally" pill hides it, so the owner prints QR codes for a restaurant that was never created. |
| Critical | `INFRA-01` | Dockerfile runner stage | COPY with a source path that does not exist in the source stage is a hard build failure, not a silent skip (failed to compute cache key: ... |
| Critical | `INFRA-02` | package.json / package-lock.json | npm ci (.github/workflows/ci.yml:19) validates lock↔manifest sync and exits non-zero with EUSAGE: ... |
| Critical | `INFRA-03` | docker-compose.yml env_file | env_file defaults to required, so docker compose up --build fails during project load — before any container is created and before the build starts — with env file C:\...\.env.local not found. |
| Critical | `OCR-01` | reconcileImports (reconcile) | reconcileImports drops parser products when an AI and parser product share a name key, so a dish printed in two sections can lose a listing and a whole category can vanish while the UI reports success. |
| Critical | `OCR-02` | parseOcrMarkdown price split | PRICE_SPLIT_RE swallows the digit run before the price, so "Couscous 1 200" becomes a phantom dish named "Couscous 1" at 200 DT — a wrong-but-plausible price in the live menu. |
| High | `API-3` | PUT /api/menu | on a slug clash the request returns 409 but the write already landed, so two restaurants now share a slug; .single() then fails with PGRST116 (multiple rows returned) → notFound() → the public menu… |
| High | `DB-03` | PUT /api/menu | Any failure of the restaurant update (missing column, RLS, oversized value) is reported to the user as a successful save while name/slug/tagline/theme/logo/cover are all discarded. |
| High | `DB-04` | restaurants.slug | Two owners (or one owner with two restaurants) can persist the same slug; from then on .single() returns a PGRST116 error for every guest scan of that slug, data is null and the public menu 404s… |
| High | `DB-05` | PostgREST embeds / FKs | without the FKs PostgREST returns PGRST200, data is null, and the dashboard shows zero orders while orders exist in the table, and every valid worker invite link 404s. |
| High | `DB-06` | 1002 §7 RLS | if the pre-existing schema had a permissive read policy on workers or worker_invites — e.g. |
| High | `FE-03` | Guest menu — order submit | the duplicate-order protection is defeated by the client, because every attempt carries a new key. |
| High | `FE-04` | Guest menu — 409/404 on submit | the guest is told to change something but has no way to learn what; the cart retains the offending line. |
| High | `FE-05` | Guest menu — cart and confirmation durability | (a) any refresh, accidental back-swipe or phone lock-screen eviction wipes an in-progress cart with no warning; (b) the order number and total — the guest's only proof and the only way to reconcile… |
| High | `FE-06` | Worker invite accept / invite create | under rate limiting or a broken backend, the owner hands out a link that yields a worker device holding no server session, and that device's order board is permanently empty (see FE-08). |
| High | `FE-07` | WorkerShell / worker dashboard layout | repro — in any browser, localStorage.setItem("sufra.worker", '{"id":"x","name":"x","role":"Manager"}'), then open /worker/dashboard. |
| High | `FE-08` | useOrders / onboarding hydration | an owner who signs in sees the Overview with zero revenue, zero orders and empty charts (src/app/(owner)/dashboard/page.tsx:55-63) even though the restaurant has live orders; /dashboard/orders shows… |
| High | `FE-09` | Navigation / landing page | a returning owner who opens the site root has no discoverable way back into their dashboard — they must hand-type /auth/login. |
| High | `I18N-01` | Currency (guest menu) | a guest who taps $ on their table sees a coffee listed at $1.40 while the kitchen receives 4.500 TND and the owner's own card shows whatever currency *their* device last selected (same localStorage… |
| High | `I18N-02` | Locale default & persistence | a phone with an ar-TN locale gets the English UI, LTR, on first paint and stays English until the user finds the AR pill inside LangCurSwitcher (lang-cur-switcher.tsx:15-27, labels EN/FR/AR, not… |
| High | `I18N-03` | RTL — dir is never server-rendered | on the guest menu, the onboarding wizard, both dashboards and the auth pages, the rendered direction is LTR until hydration; [dir="rtl"] .font-serif (globals.css:197) cannot match before then, so… |
| High | `I18N-04` | RTL breakage — guest menu | guest menu/search/cart/dialog use physical left/right utilities (left-3.5, pl-10 pr-4, sm:text-left, right-4), so the guest surface is visually broken in Arabic RTL. |
| High | `I18N-05` | Missing key renders a raw string to the owner | Step 5 of the onboarding wizard always shows the literal text prv_menuItemsSub under "6 Menu Items" — in EN, FR and AR alike, on the final step of the first-run flow, immediately before the owner is… |
| High | `I18N-06` | Onboarding headers hard-coded English (keys exist) | a French or Arabic café owner building their first menu sees five English section headers, and step 5's headline/description in English. |
| High | `I18N-07` | Auth surfaces are English-only | the only entry point for an existing owner is unlocalized in a 3-locale product; and because dir is set globally (src/lib/i18n.tsx:1844), an owner whose device is Arabic gets this English form… |
| High | `INFRA-04` | docker-compose.yml healthcheck vs src/app/api/ | the probe gets HTTP 404, r.ok is false, the command exits 1, and after start_period: 20s + 3 × 30s the container is permanently Up (unhealthy). |
| High | `INFRA-05` | docker-compose.yml n8n service | the app never calls n8n, so this is a second container, a second port (:5678), a persistent volume and a hardcoded encryption key in the image config that the product does not use — for a newcomer,… |
| High | `INFRA-06` | .github/workflows/ci.yml | every defect in this report except INFRA-02 ships unobserved: CI would never have caught the missing public/, the phantom /api/health probe, the missing .env.local, the dead n8n service, or a… |
| High | `LIB-01` | worker-permissions.ts + PATCH /api/orders/[id] | any cashier or manager can PUT status:"pending" and pull an accepted — or already paid — order back to the pending column, re-notifying the kitchen. |
| High | `LIB-02` | worker-auth.ts + logout | the 7-day window is client-side only. |
| High | `LIB-03` | owner-auth.ts + logout | a leaked refresh token survives logout for up to 60 days and keeps minting valid access tokens. |
| High | `LIB-04` | order-utils.ts | a product priced from an imported menu at 3 decimals (e.g. |
| High | `LIB-05` | menu-sync-guard.ts + PUT /api/menu | validateSyncPayload returns the raw payload cast as valid, so unvalidated sort_order/isAvailable/isPublished and other fields are written straight to the DB by PUT /api/menu. |
| High | `LIB-06` | menu-mapping.ts + qr.ts call sites | printed QR standees are the product's core artefact and they are not durable. |
| High | `LIB-07` | use-orders.ts | polling every 3s with no in-flight guard, no sequence id, no abort, no visibility handling and a silent error path — stale responses overwrite fresher state and requests pile up. |
| High | `OCR-03` | parseOcrMarkdown currency/digit handling | prices printed with a leading currency symbol or Arabic-Indic digits ("$12.50", "€ 5.500", "١٢٫٥") match nothing, so those items import at price 0. |
| High | `OCR-04` | table-formatted menus | table-laid-out menus arrive via page.tables which the pipeline discards (markdown holds only [tbl-N.md] placeholders), so the deterministic baseline sees nothing and garbage/all-AI rows can be imported. |
| High | `OCR-05` | quality gate contradicts the parser | the quality gate rejects legitimate small menus (3-item headingless board, bold/#### headings) and then fails the scan after three paid OCR calls, while accepting junk panels and truncations. |
| High | `OCR-06` | no timeout on any provider or client fetch | no AbortSignal on any Mistral fetch (or on the client scan POST), so a hung provider parks the request until the platform 504 with no typed error and the paid spend already committed. |
| Medium | `API-10` | POST /api/auth/signup partial provisioning | on a binding failure the account is created but owns nothing (login lands on an empty dashboard with no explanation, and there is no retry path — a second signup is refused by design or binds nothing… |
| Medium | `API-4` | fetchForeignRows ownership guard | the IDOR guard fails open. Any error from that ownership query (transient, schema cache, malformed filter) is interpreted as "no foreign rows", so a payload containing another restaurant's… |
| Medium | `API-5` | PATCH /api/orders/[id] role matrix | any Cashier or Manager can reopen an order (and a rejected 403 never happens), so an accepted order can be pushed back to the pending column by any worker, across devices. |
| Medium | `API-6` | POST /api/auth/worker/accept × accept page | a worker whose invite was already claimed, rate-limited, or rejected by the DB is told "welcome" and lands on /worker/dashboard with no server session — WorkerShell then bounces them… |
| Medium | `API-7` | POST /api/auth/signup | (a) an unauthenticated, scriptable account-existence oracle; (b) unbounded creation of *confirmed* auth users through the service-role client (email_confirm: true, signup/route.ts:67-73) — one HTTP… |
| Medium | `API-8` | PATCH /api/orders/[id] × use-orders | a 401 (expired session), 403 (cashier marking paid, cross-restaurant), 400 (malformed acceptedBy) or 500 is invisible. |
| Medium | `API-9` | POST /api/auth/worker/invite | an authenticated owner (or anyone who obtained an owner session) can mint unlimited redeemable worker credentials — 256-bit tokens, but no throttle, no cap, and no cleanup of unclaimed rows. |
| Medium | `DB-07` | 1002:77-90 dedupe renumbering | a re-run silently renumbers tickets that were already printed/served — two different orders end up sharing/shifting the numbers a kitchen already saw. |
| Medium | `DB-08` | 1002 day boundary | after local midnight while the UTC day is still the same, the counter restarts at 1001 while the index still holds yesterday's-UTC-day numbers 1001.. |
| Medium | `DB-09` | 1002:81 vs 1002:96-97 | with a session TimeZone ≠ UTC, two rows in different local-day partitions can be assigned the same 1000+rn while sharing the same UTC order_day; CREATE UNIQUE INDEX then fails with 23505 and, because… |
| Medium | `DB-10` | 1002:148-153 | uniqueness of a bearer credential silently depends on the order in which the schema was built; two workers could share a token and lookupWorkerByToken's maybeSingle() (src/lib/worker-auth.ts:65-71)… |
| Medium | `DB-11` | uniqueness contract | a duplicate makes the corresponding lookup return a PostgREST error with no message the user can act on: the guest menu 404s (page.tsx:26), guest ordering returns 404 BAD_TABLE, invite acceptance… |
| Medium | `DB-12` | 1002:158-171 CHECK constraints | on any pre-existing project with one out-of-range row — a negative price from an OCR import, a legacy quantity = 0 line — the ADD CONSTRAINT raises 23514 and aborts the whole migration, so the… |
| Medium | `DB-13` | required defaults | on a base schema whose PKs lack defaults, every restaurant/order/line/invite insert fails 23502 not_null_violation — the whole product, not one screen. |
| Medium | `DB-14` | products.price / orders.total column types | if price/total are declared integer or real, PostgreSQL silently rounds fractional prices on assignment — a 2.50 TND item becomes 3.00, and the ticket total no longer matches the sum of the lines the… |
| Medium | `DB-15` | Supabase coupling | the migration is Supabase-only; a developer who follows the README onto RDS/Neon/ docker-postgres gets 42883 at 1002:194-203 and 42P01 at 1002:291. |
| Medium | `DB-16` | PUT /api/menu deletes | when a delete is rejected by a FK from orders.table_id (or any other constraint), the row survives while the client's payload says it is gone; the next GET /api/menu re-adds it (:67-84) and the owner… |
| Medium | `DB-17` | legacy triggers | on that project — and on any project inheriting the same ad-hoc schema — running 1002 does not deliver what the file claims (§1 "atomic daily order numbers"): the rogue trigger still stomps the… |
| Medium | `DB-18` | products.sort_order | the documented capability does not exist. |
| Medium | `FE-10` | StepPreview — scan URL | the wizard's "Scan link" — the one URL the owner is invited to copy and share — points at a domain the product does not own and a path the guest route does not serve. |
| Medium | `FE-11` | StepPreview / onboarding Navbar / Tables page | combined with FE-02, an owner whose first PUT failed still sees "Ready", still gets a "generated" toast and still gets a printable sheet of QR codes for a restaurant that does not exist. |
| Medium | `FE-12` | Onboarding autosave | repro — on /onboarding, type a category name, then within 900 ms close the tab (or, on the owner menu editor, navigate to another route that unmounts the editor). |
| Medium | `FE-13` | useOrders / WorkerNewOrderDialog / store hydration | (a) the operator cannot distinguish "no orders" from "the connection is dead" — the exact failure described in this slice's brief; (b) tapping "Place order" in a busy service simply does nothing… |
| Medium | `FE-14` | useOrders optimistic mutations | a cashier tapping Accept where the server returns 403/401/404 (or the order was already taken) sees the card move to Accepted and a green success toast; 3 seconds later the poll silently snaps it… |
| Medium | `FE-15` | ForgotForm | an owner locked out of their own restaurant is told "a reset link is on its way" with certainty, when nothing was sent and nothing can be sent (no .env.local, no Supabase project — the project's… |
| Medium | `FE-16` | App Router boundaries | a guest who scans a QR from an old print run, or a token that was regenerated, lands on Next's unstyled default 404 — English-only, unbranded, with no "ask your server to rescan" guidance and no link… |
| Medium | `FE-17` | Guest menu, category editor, lang switcher — accessibility | a screen-reader user hears "minus, plus" repeated for every product with no way to tell which dish each belongs to, and cannot adjust a cart line at all; a thumb on a phone in a dim restaurant will… |
| Medium | `FE-18` | I18nProvider — hydration | every user whose stored language is fr or ar — the two locales the product explicitly ships, including the whole Tunisian target market — renders English HTML on the server, then hydrates with… |
| Medium | `I18N-08` | Worker terminal shows the wrong role | a Manager logged into their own terminal is told they are a cashier, in every locale. |
| Medium | `I18N-09` | Role names untranslated in the invite UI | Arabic/French sentences read "دعوة Manager" / "Manager · ينتهي خلال 24 ساعة"; the invite dialog's role picker is English in an otherwise translated dashboard. |
| Medium | `I18N-10` | Hard-coded English timestamps stored as data | worker dashboards in FR/AR show "Just now"; the local invite page shows "In 24 hours" instead of t("inv_expires24") ("Dans 24 heures" / "خلال 24 ساعة"). |
| Medium | `I18N-11` | Scan error codes with no message | an owner whose session expires mid-scan gets "Something went wrong while scanning. |
| Medium | `I18N-12` | RTL breakage — dashboards & wizard | dashboards, wizard and shared UI pin text/padding/arrows to physical left/right, so Arabic switches to RTL but keeps LTR alignment, spacing and arrows in ~20 places. |
| Medium | `I18N-13` | OCR review price ignores the currency setting | with cur = usd the wizard shows the scanned item as "4.500 DT" in the review and "$1.40" two steps later — the same product, two currencies, in one flow. |
| Medium | `I18N-14` | restaurants.currency is written once and never read | the DB column is decorative; an owner cannot choose a currency, a guest's currency is a device preference, and the round-trip OCR rate (menu-scan.ts:195, 1 EUR ~ 3.4 TND, 1 USD ~ 3.1 TND) disagrees… |
| Medium | `INFRA-07` | .env.example:44 | the documented flow is cp .env.example .env.local (README.md:19) — so the shipped default wins. |
| Medium | `INFRA-08` | .env.example vs src/app/api/auth/signup/route.ts:21 | .env.example is the enforced contract for handoff (the DB/compose paths both refer to it). |
| Medium | `INFRA-09` | supabase/ (no config.toml) + migration filename | the locally-hosted-Supabase path that both config files advertise is not runnable: without supabase/config.toml the CLI refuses to start a project (Cannot find project config), and supabase db… |
| Medium | `INFRA-10` | package.json scripts | the three things a newcomer must do that are not npm run dev — create the database, seed it, verify the production artefact the way Docker runs it — have no entry points. |
| Medium | `LIB-08` | rate-limit.ts | an unauthenticated client can send a unique X-Forwarded-For per request, so every request creates a key that survives pruning for the whole window — unbounded memory growth (a self-inflicted OOM)… |
| Medium | `LIB-09` | menu-sync-guard.ts + PUT /api/menu | a payload containing the same product id twice is accepted by the guard and then fails in Postgres — ON CONFLICT DO UPDATE command cannot affect row a second time (SQLSTATE 21000) — surfacing as… |
| Medium | `LIB-10` | menu-sync-guard.ts + POST /api/orders | if two table rows in one restaurant share a qr_token, maybeSingle() errors on >1 row and every order from those tables fails with "Table not found" — permanently, until the owner deletes and… |
| Medium | `LIB-11` | image-utils.ts | (a) a 2048×2048 PNG screenshot (commonly 6–10 MB) passes through byte-for-byte, defeating the size cap and feeding the route's unbounded req.formData() (prior finding #4,… |
| Medium | `LIB-12` | migration 1002 + PUT /api/menu + readers | the advertised capability (owner-controlled dish ordering) is half-built: the column, index and backfill land in the DB and are then dead weight, and every product list is ordered by insertion time… |
| Medium | `LIB-13` | utils.ts + menu-sync-guard.ts | Impact, in a TND/Arabic-first product: (a) any restaurant whose name is entirely non-Latin (e.g. |
| Medium | `LIB-23` | order-utils.ts (dead export with live tests) | the tested contract and the executed contract are different code. |
| Medium | `LIB-24` | utils.ts (appBaseUrl) | (a) on the server-rendered first paint typeof window is undefined, so the initial HTML contains the hardcoded placeholder domain https://sufra.app/menu/<slug>/<token>; a user who copies the visible… |
| Medium | `OCR-07` | per-request memory ≈3× the upload cap | on a 512 MB serverless function or a small VPS, two or three concurrent scans from different IPs OOM the process (killing in-flight orders for other users on the same instance); memory is held for… |
| Medium | `OCR-08` | uploaded documents are never deleted | every scan permanently retains the owner's menu photographs in Mistral's storage — unbounded growth against the account's file quota, and a data-retention exposure for images that may capture staff,… |
| Medium | `OCR-09` | merge silently skips colliding rows | the owner hand-corrects a price after a bad scan, re-scans, and the UI says the import succeeded while those rows were dropped — half-applied state with a success signal. |
| Medium | `OCR-10` | review step hides rows it is about to import | the owner reviews a 40-item scan, sees 8 rows per section, and imports the rest unseen. |
| Medium | `OCR-11` | HEIC/HEIF accepted then fails to decode | on Windows/Android Chrome, picking an iPhone HEIC photo is a dead end: a generic error, the file stays in the list, and retrying re-fails — while the product's own picker advertised the format as… |
| Medium | `OCR-12` | items before the first heading are discarded | on a two-column menu, or a photo whose top line is a "Plat du jour" before the first section heading, that item is silently dropped from the import — a missing product with no signal anywhere in the… |
| Medium | `OCR-13` | truncation detection only catches one shape | the 20-page cap (MAX_PAGES_PER_FILE, :62, pages:"0-${19}" at :263) or a cut-off page produces a fragment that passes every gate and is imported as the complete menu — the owner publishes a menu… |
| Low | `API-11` | rate-limit response consistency | callers cannot back off uniformly; the two client-side retry UIs that exist (guest order submit, scan dialog) read message prose instead. |
| Low | `API-12` | POST /api/menu/scan error detail leak | internal/provider detail (endpoint paths, provider error payloads, stack-derived messages from String(err)) is returned to the browser. |
| Low | `API-13` | unreferenced endpoints → no worker revocation | the owner's worker list is permanently empty on the device that created the invite (and after any localStorage clear), and worker revocation is unreachable from the product even though DELETE… |
| Low | `API-14` | menu sync rewrites the public slug | renaming the restaurant silently changes its public URL, so every already-printed or shared /menu/<slug>/<token> link 404s. |
| Low | `API-15` | owner-supplied acceptedBy is not scoped to the restaurant | an owner can attribute an order to an arbitrary UUID — including a worker of another restaurant — and pair it with any name, so the "Accepted by <name>" attribution on the board is not trustworthy. |
| Low | `API-16` | POST /api/auth/callback refresh-token fallback | when the link carries no refresh_token, the access token is stored as the refresh token; the grant then fails deterministically and the session dies at the access-token TTL (~1 h) with no refresh… |
| Low | `API-17` | POST /api/upload failures degrade to a data URL | after a rejected upload (e.g. a GIF passes the client's image/* check but not the server's MIME allowlist at upload/route.ts:79-82), the menu carries a data: URL and every subsequent autosave fails —… |
| Low | `DB-19` | orders.order_day nullability | in a plain unique index NULLs are distinct, so the "unique backstop for daily ticket numbers" (README.md:81) silently does not constrain rows with a NULL order_day — duplicates can coexist… |
| Low | `DB-20` | worker role vocabulary | a row with role='manager' (accepted by the DB) is silently downgraded to Cashier at order-PATCH time, so a manager gets 403 FORBIDDEN when marking an order paid and has no way to understand why. |
| Low | `DB-21` | configuration surface | the documented local-setup path fails at the first step (no config → no stack), and the first-run ownership transfer depends on an undocumented variable whose default is a stale address from the… |
| Low | `DB-22` | allocateOrderNumber fallback | while the two windows disagree (the local/UTC day boundary) the fallback can compute a number that already exists in the UTC-day group; the insert is rejected 23505 and the loop at :261-415… |
| Low | `DB-23` | dead columns | three columns are required by the schema but carry no behaviour: publication is not a real control (an unpublished menu is still public and unauthenticated), and currency can never be changed from… |
| Low | `DB-24` | storage bucket creation | the bucket accepts any size and any content type for anything holding a service key or an authenticated Storage session; the only guard is the TypeScript handler. |
| Low | `FE-19` | ProductForm / invite accept — silent validation | a worker tapping "Accept invitation" with the name field untouched sees absolutely nothing happen and has no idea a name is required — the accept form has no required attribute and no error slot. |
| Low | `FE-20` | onboarding-store acceptInvite | [INFERENCE] React is permitted to invoke updaters more than once (StrictMode double-invoke, concurrent re-render), so the localStorage write and the setWorkerSession call are not guaranteed to run… |
| Low | `I18N-15` | Dead keys and a duplicated key family | no runtime impact beyond maintenance risk (it is what let I18N-05 ship silently), plus the unused cur_label/lang_label are exactly the labels the switchers never show (see I18N-16). |
| Low | `I18N-16` | Currency/language switcher has no accessible labels | a screen-reader guest hears "$" and "€" with no context; a guest who does not know DT cannot tell what the row does, and there is no visible indication that the currency toggle exists vs the language… |
| Low | `I18N-17` | Static English metadata for every locale | browser tab, search results and link previews (WhatsApp is the primary sharing channel for this market) are always English, even for an Arabic café. |
| Low | `I18N-18` | English fallback copy in localized components | mostly owner-side; menu/[slug]/[token]/page.tsx:70 is guest-visible but only when a restaurant has a null name (the wizard requires one). |
| Low | `I18N-19` | Landing demo prices are not dinar prices | [INFERENCE — judgement about plausible café pricing] the pitch shows "4.750 DT" for an "Oat Cortado" and "$1.47" for the same dish once the visitor taps $, which reads as a 3× discount rather than a… |
| Low | `INFRA-11` | Dockerfile:24 | a maintainer reading the Dockerfile believes the standalone output is toggled at build time by that variable, so moving/removing it looks meaningful and a runner-only env change appears to change the… |
| Low | `INFRA-12` | Dockerfile:8 | two harms. (a) It hides lockfile drift: the image build silently resolves a different dependency tree (npm install rewrites the lock inside the layer) than CI's npm ci — which is why nobody noticed… |
| Low | `INFRA-13` | tailwind.config.ts under Tailwind v4 | Tailwind v4 does not read tailwind.config.ts unless the CSS opts in with @config, so this file is dead configuration. |
| Low | `INFRA-14` | next.config.mjs:13-18 | the Next image optimizer will fetch and re-serve any host, so /_next/image?url=http://<internal-host>/... |
| Low | `INFRA-15` | package.json:16 | an unused runtime dependency is installed in every image, every CI run and every developer's node_modules, and expands the supply-chain surface for zero product value; it also misleads (a reviewer… |
| Low | `INFRA-16` | toolchain pins | there is no declared runtime, so npm install on Node 24/npm 11 (what every local run does) is free to write lockfile content that the Node 20/npm 10 path in CI and Docker reads differently, and… |
| Low | `INFRA-17` | .gitignore | running the documented Docker command drops an untracked n8n/ directory into the working tree, and the audit deliverables show up as untracked noise next to them — so git status offers a commit that… |
| Low | `INFRA-18` | README.md:17 (dev-onboarding path) | the first command a newcomer is told to run fails; the mismatch also means the app name in the handoff docs (Sufra), the npm package (sufra) and the Compose project (restaurant-ai) are three… |
| Low | `LIB-14` | owner-auth.ts | no production deployment built and started normally can enable the bypass, so this is not a live vulnerability. |
| Low | `LIB-15` | PATCH /api/orders/[id] (owner branch) | an owner-initiated accept can stamp an arbitrary (including another restaurant's) worker id onto the order, corrupting the "who accepted this" label the dashboards display (api/orders/route.ts:30-31). |
| Low | `LIB-16` | worker-auth.ts | today's impact is ~nil (a Max-Age=0 deletion over plain HTTP is harmless, and the dead helper is never wired). |
| Low | `LIB-17` | qr.ts | an encoding failure becomes an unhandled promise rejection with no user-visible error — the user clicks "download all" and gets nothing. |
| Low | `LIB-18` | utils.ts | the helper's comment ("must still be unpredictable", implying 8 bytes = 64 bits) overstates the entropy by ~21 bits. |
| Low | `LIB-19` | utils.ts + menu-sync-guard.ts | a #abc or #11223344 brand colour passes validation, then renders a white translucent accent behind the brand elements with no error — a visible theme bug that the validator explicitly allowed. |
| Low | `LIB-20` | rate-limit.ts | a stray value in a production .env (the file is copied from .env.example, which documents the switch next to the auth bypass) silently removes throttling from login, recover, reset, order creation,… |
| Low | `LIB-21` | worker-auth.ts | dead code that advertises a control the app decided not to use (delete or wire it — leaving it invites a future layout to add a redundant, bypass-sensitive guard). |
| Low | `LIB-22` | order-utils.ts | a free (0-priced) catalog product produces an order whose total is 0 and which passes every guard, including the range check. |
| Low | `LIB-25` | worker-invite.ts + invite readers (fail-open TTL) | any invite row whose expires_at is null — pre-existing rows, or any future writer that omits the column — is a credential with an infinite lifetime; combined with LIB-02 (sessions also never expire… |
| Low | `OCR-14` | sanitizePrice mishandles $ and non-ASCII digits | whenever the annotation is missing or fails to parse (OCR-15) the string path is the only one left; $-prefixed prices then silently become 0 (free items), and the parser/sanitizer disagreement on… |
| Low | `OCR-15` | document_annotation assumed to be a JSON string | if the provider's shape differs, the flagship "AI structure" path silently never runs in production while every log looks healthy; quality silently degrades to the regex parser (which is where… |
| Low | `OCR-16` | provider auth failures are reported as a configuration error | an expired, revoked, or plan-limited key (403) tells the owner the feature is unconfigured — the wrong remediation, and it hides a real operational incident from whoever reads the error. |
| Low | `OCR-17` | isJunkHeading drops real headings | dishes land in a section literally named Menu (or in the previous section) instead of their printed heading — the category name is what the guest sees as the section header on the QR menu, so the… |
| Low | `OCR-18` | orphan price lines are discarded | a section-heading-plus-price layout ("Menu du jour\n12.500") loses the price, and the item imports as free with no visible error. |

**Severity mix:** 11 Critical · 33 High · 54 Medium · 43 Low.

---

## 5. Severity conflicts between slices (resolved)

The same underlying defect is occasionally reported by two slices at different severities. Both IDs
are kept everywhere (the TSV preserves each report's own severity, because the fix work references
those IDs); this is how the pair is meant to be read.

| Defect | Slices (severity) | Resolution |
|---|---|---|
| `PATCH /api/orders/[id]` lets any worker reopen an accepted/paid order; `canSetArbitraryStatus` is documented but never called | `LIB-01` (High) · `API-5` (Medium) | **One defect, two views.** `LIB-01` names the unenforced documented gate in the module that owns the rule; `API-5` reports the route's status mapping. The **High** governs remediation order: enforce the gate in the route and add a route-level test. `canAcceptOrder` is genuinely redundant (`API-5`); `canSetArbitraryStatus` is not (`LIB-01`) — do not delete it. |
| Invite accept treats 409/429/5xx as a "local demo" success and fabricates a worker session | `FE-06` (High) · `API-6` (Medium) | **One defect, two views.** `API-6` reports caller/route mismatch; `FE-06` adds the security-relevant half (a fabricated worker device plus the mirror defect on invite *creation*). The **High** governs: restrict the fallback to genuinely-offline conditions. |
| The sync payload rewrites `restaurants.slug` from the display name on every save | `LIB-06` (High) · `API-14` (Low) | **One defect, two views.** `API-14` focuses on the public URL changing; `LIB-06` adds the product-level consequence — every already-printed QR standee dies silently. The **High** governs (freeze the slug on insert, or add a slug alias). |
| Empty-menu data loss via `GET /api/menu` | `API-2` (Critical) and `FE-13(c)` (Medium) | **One failure chain, reported from both ends.** The server flattens a swallowed PostgREST error into a normal 200 with empty collections (`API-2`); the client store then renders an empty editor and autosaves it, deleting products and tables (`FE-13(c)`). Fix the server first: the client cannot distinguish "no menu" from "DB error" while both arrive as `200`. |
| Owner ordering control (`products.sort_order`) | `DB-18` (Medium) · `LIB-12` (Medium) | Same conclusion from both slices: column, index and backfill exist; nothing in `src/` reads or writes it. Keep both IDs (schema view / lib view); one fix removes it or wires it. |
| Base URL for QR codes and invite links | `LIB-24` (Medium) · `FE-10` (Medium) | Not duplicates: `LIB-24` is the shared `appBaseUrl()` returning a hardcoded `https://sufra.app` on the server; `FE-10` is the wizard hardcoding `menuos.app` instead of calling it. Fix both with one resolver. |
| OCR-19 referenced but never defined | `OCR-18` (Low) | The OCR price truth table cites `OCR-19` for the orphan-price-line loss, but the findings section ends at `OCR-18` ("orphan price lines are discarded"). This is a numbering slip for the same defect; **no `OCR-19` row exists** in `docs/FINDINGS.tsv`, deliberately, rather than inventing a finding. |

---

## 6. The critical path — repo to a first paying customer

Ordered by dependency, not by severity. Each step names the findings that must be closed for it and,
where it is not obvious, why it sits where it does.

**Stage 0 — make the repository runnable at all.** Nothing below can be verified, fixed or trusted
until this is done, which is why it is first despite looking like "infra work".
1. **Author and apply the base schema.** `DB-01` (no base schema; `1002:28` fails with `42P01`),
   `DB-13` (PK defaults the app relies on), `DB-11` (the uniqueness the `.single()`/`maybeSingle()`
   call sites depend on), `DB-05` (FKs required by the PostgREST embeds), `DB-02` (the column contract
   the app actually writes). *Precondition for every other verification in this document.*
2. **Repair the lockfile and let CI run for real.** `INFRA-02` (`npm ci` fails; CI has never run),
   `INFRA-06` (CI does not build the image or validate SQL). *Precondition for trusting any green
   signal from here on.*
3. **Fix the container path.** `INFRA-01` (missing `public/`), `INFRA-03` (missing `.env.local`
   contract), `INFRA-04` (health probe on a route that does not exist), `INFRA-05` (dead n8n service),
   `INFRA-09` (`supabase/config.toml` absent; migration filename not CLI-recognised), `INFRA-10`
   (no `db:migrate`/seed entry points). *Precondition for a deployable artefact.*
4. **Close the schema-attack surface before anyone else runs it.** `DB-06` (the RLS "safeguard"
   is an incomplete name denylist that can leave `workers`/`worker_invites` readable, i.e.
   `session_token` exposed), `DB-17` (legacy triggers on `orders`/`order_items` are not audited by
   `1002`), `DB-15` (the migration is Supabase-specific), `DB-07`/`DB-08`/`DB-09` (it is not actually
   idempotent and its day boundary is defined twice).

**Stage 1 — the owner can build and publish a menu (level (a) of `docs/INTENT.md` §7).** Everything
else is downstream of a published restaurant row; no QR code means no product.
5. **Make the write path honest.** `API-3` (the restaurant row is written before the slug/ownership
   checks, so 403/409 leaves a partial write), `DB-03`/`DB-16` (update/delete errors discarded),
   `DB-04` (slug uniqueness races in app code), `LIB-05` (the guard returns the raw payload, so
   unvalidated fields reach the DB), `LIB-09` (duplicate/non-UUID ids brick publishing),
   `API-14`/`LIB-06` (slug rewritten on every save).
6. **Make the wizard save, and say so when it doesn't.** `FE-01` (no session, no signup hand-off on
   the product's main funnel), `FE-02` (the failure state is unreachable by construction),
   `FE-11` ("Publish"/"Live" claim a fact the UI never verified; QR printing is not gated on
   publish), `FE-12` (no flush on unload), `FE-09` (the sign-in page is unlinked from every public
   surface). *This is the single highest-value UX cluster: it is the difference between a demo and
   an owner who has a menu.*
7. **Stop the empty-menu wipe.** `API-2` (a swallowed DB error is served as an empty menu and the
   autosave then deletes the catalogue), `FE-13(c)` (client cannot tell "no menu" from "hydration
   failed"), `FE-08` (post-sign-in hydration never re-runs, so the dashboard shows local-mode zeros).
8. **Make the printed artefact correct.** `FE-10` (the wizard's scan URL is `menuos.app`),
   `LIB-24` (`appBaseUrl()` returns a hardcoded domain on the server), `FE-16` (an old/bad QR yields
   Next's unstyled English 404 — the most likely real-world failure).

**Stage 2 — a worker device can be trusted (prerequisite for level (c)).**
9. **Fix the counter-order contract.** `API-1` (dialog posts `tableNumber`, schema requires
   `tableToken` → 400 on every worker order). *An independent, code-level blocker: even a perfectly
   migrated database does not fix it.*
10. **Close the fabricated-session paths.** `FE-06`/`API-6` (429/5xx degrade to a locally invented
    worker), `FE-07` (the only gate is client-side and a forged `localStorage` entry yields an
    interactive terminal), `API-9` (invite creation has no rate limiter),
    `LIB-02` (worker sessions never expire server-side and logout does not revoke them),
    `LIB-25` (a null `expires_at` invite is a permanent credential), `DB-20` (role vocabulary:
    a DB-accepted `manager` is silently downgraded).
11. **Wire revocation.** `API-13` (`DELETE /api/workers/[id]` exists with no caller, so a lost
    device can never be cut off), which also depends on `LIB-02`.

**Stage 3 — the guest flow is safe to take money for (level (b)).**
12. **Make order submission idempotent from the client.** `FE-03` (a fresh `clientRef` per attempt
    defeats the server's own duplicate guard — the most expensive failure in the product),
    `LIB-23` (the tested predicate is not the executed one).
13. **Make the guest's failures actionable and durable.** `FE-04` (409/404 with no product
    identifiers, and the stale item stays in the cart), `FE-05` (cart and order number are lost on
    refresh; no "my order" view), `FE-16` (branded 404/error boundaries).
14. **Make the boards truthful.** `LIB-07` (3 s poll: no in-flight guard, no sequence id, no
    visibility handling, silent errors), `FE-14`/`API-8` (optimistic mutation + success toast before
    the server answers), `FE-13` (silent failures on all three surfaces), `LIB-01`/`API-5` (reopen
    gate unenforced), `API-11` (`Retry-After` missing where clients are expected to back off).

**Stage 4 — harden before real guests and real money.**
15. `LIB-03` (logout does not revoke the 60-day refresh token), `LIB-08` (the limiter keys on a
    client-controlled `X-Forwarded-For` and can be made to grow without bound), `API-7` (signup has
    no limiter and leaks account existence), `API-10` (partial provisioning on signup),
    `API-12` (provider error detail leaked to the client), `API-15` (owner-supplied `acceptedBy` is
    not restaurant-scoped), `API-16` (access token stored as the refresh token),
    `INFRA-14` (the image optimizer proxies any host), `LIB-04` (money precision conflicts with the
    display layer — needs an owner decision first), `DB-24` (bucket limits enforced only in the route).

**Stage 5 — the flagship feature (OCR) is presentable.**
16. `OCR-02`/`OCR-03` (wrong-but-plausible prices and lost prices on real printed formats),
    `OCR-04` (table-laid-out menus lose their body), `OCR-01` (the reconciler drops parser products,
    violating its own invariant), `OCR-05` (the gate rejects the menus the parser was written to
    rescue and accepts junk), `OCR-06` (no timeout on any provider call),
    `OCR-07`/`OCR-08`/`OCR-10`/`OCR-11`/`OCR-12`/`OCR-13` (memory, retention, review truncation,
    HEIC, pre-heading items, undetectable truncation). *Position: last of the functional work,
    because a wrong price on a printed menu is a trust problem but not a blocker to levels (a)–(c).*
17. **Then the content layer:** `I18N-01` (currency on the guest menu contradicts the README and the
    kitchen total — needs an owner decision), `I18N-02`/`I18N-03` (no locale detection, `dir` never
    server-rendered), `I18N-04`/`I18N-12` (RTL breakage across the guest surface and the dashboards),
    `I18N-05`/`I18N-06`/`I18N-07` (raw keys and English-only wizard/auth surfaces in a 3-locale
    product).

**Cross-cutting rule for the whole path:** do not apply a fix from Stage 1–3 before Stage 0 is
verifiable. Several of the most valuable fixes (empty-menu wipe `API-2`, idempotency `FE-03`) are
silent-failure fixes, and there is currently no working database, no CI and no running container in
which to observe whether the failure has stopped.

---

## 7. Corrections to the prior reports

`FINAL-AGENT2-AUDIT.md`, `SECURITY-REPORT-ROUND-2.md` and `PERFORMANCE-OCR-REPORT.md` are tracked at
the repo root and will otherwise be read as current. These claims were refuted, narrowed or
superseded by the new audits. **Do not trust the old reports for these points.**

| Prior claim (source) | Correction | Refuting finding |
|---|---|---|
| "CI … checkout → Node 20 → `npm ci` → lint → typecheck → test → build. **Valid** (all scripts exist in `package.json`)" (`FINAL-AGENT2-AUDIT.md:167-168`) | The workflow was never valid: it checked that script *names* exist. `npm ci` exits `EUSAGE` because the committed lockfile never contained `vitest` or its tree, so CI died on its first real step and **none** of lint/typecheck/test/build has ever run in CI. | `INFRA-02`, `INFRA-06` |
| "`npm run test`: 7 files, **124/124 passing**" presented as a reproducible handoff fact (`FINAL-AGENT2-AUDIT.md:160`) | The number is right (the orchestrator reproduced 124/124) but it was **not reproducible from the repository**: the runner was not installable from the committed lockfile. It only became true after the lockfile was regenerated. | `INFRA-02` |
| "`canAcceptOrder`/`canSetArbitraryStatus` unused (PATCH enforces equivalently)" / "Dead role helpers … **Harmless**; wire or remove" (`FINAL-AGENT2-AUDIT.md:100`, `SECURITY-REPORT-ROUND-2.md:92`) | True for `canAcceptOrder`; **false for `canSetArbitraryStatus`**. The documented "owners alone may reopen" gate is genuinely unenforced: any worker can `PATCH {status:"pending"}` and pull an accepted or already-paid order back to the pending column. Deleting the helper would delete a document of a real rule. | `LIB-01`, `API-5` |
| "Login/order/scan/worker-accept/invite all limited and header-correct (`Retry-After` on login/scan paths)" (`SECURITY-REPORT-ROUND-2.md:113`) | Refuted on two counts: **worker-invite has no limiter at all**, and login sends **no** `Retry-After` (only 3 of 9 limited routes do). | `API-9`, `API-11` |
| "PUT IDOR 403 with byte-identical menu after (**no partial writes**)" (`FINAL-AGENT2-AUDIT.md:124-125`, `SECURITY-REPORT-ROUND-2.md:101`) | The row-level IDOR scan runs, but the **restaurant row is written before it** and before the slug check, so a 403/409 response leaves a partial write (and the slug clash check runs after the update). "Verifies ownership before writing" is not true. | `API-3` |
| "**What works today**: … server-priced public ordering, atomic ticket RPC, idempotent order creation, menu sync with ownership checks, rate limiting, OCR menu scanning behind owner auth" (`FINAL-AGENT2-AUDIT.md:17-19`) | Holds for server pricing, the RPC design and the scan auth ordering; **not** for idempotency (the guest mints a fresh `clientRef` per attempt and the worker dialog sends none) nor for rate limiting (invite has none, `Retry-After` inconsistent) nor for ownership-before-write (`API-3`). | `FE-03`, `API-1`, `API-9`, `API-11`, `API-3` |
| "The code is correct — [the live schema is] not code bugs" / worker system blocked **only** by live-schema C1–C3 (`SECURITY-REPORT-ROUND-2.md:17`, `FINAL-AGENT2-AUDIT.md:19-21`) | An **additional, independent code-level blocker** was found: the worker New-order dialog posts `tableNumber` while `POST /api/orders` requires a non-empty `tableToken`, so every worker-created order is a 400 regardless of the database. | `API-1` |
| "RLS: migration §7 applied … **no `using(true)` policies** anywhere (the `DROP POLICY public_read_all` safeguard confirms intent)" (`PERFORMANCE-OCR-REPORT.md:374-377`, `SECURITY-REPORT-ROUND-2.md:121`) | True of the *migration source*, not of a live database: the safeguard is a **name-based denylist** that drops only the literal policy `public_read_all` on 6 tables, omits `workers`/`worker_invites`, and removes no differently-named legacy policy — so a pre-existing permissive policy can survive and expose `session_token`. The live policy table was never listed by any report. | `DB-06` |
| "OCR memory bound ≈ **80 MB**/request cap" (`PERFORMANCE-OCR-REPORT.md:181-184, 299`; `FINAL-AGENT2-AUDIT.md:139`) | Undercount: the body is buffered by `req.formData()`, then `Buffer.from(await f.arrayBuffer())` copies every file, then `new Blob([buffer])` copies the in-flight file again — every uploaded byte is live ~3×, **≈170 MB peak per request** (20 concurrent scans ≈ 3.4 GB). | `OCR-07` |
| "**117/117 unit tests green**" (`PERFORMANCE-OCR-REPORT.md:415-416`) | Internally inconsistent with the same session's 124/124 claim elsewhere; the repository holds **124** tests in 7 files. | `INFRA-02` (count reconciled in `docs/audit/04-lib-core.md` "Test quality") |
| "`SUFRA_AUTH_DISABLED=1` live in `.env.local`; dev bypass opens all walls" (`PERFORMANCE-OCR-REPORT.md:402`; `FINAL-AGENT2-AUDIT.md:21-22`) | Inapplicable to the handed-over repository: **there is no `.env.local`** (or any `.env*`) in the tree, so the bypass is inert. Where it is enabled, the audits confirm it cannot fire in a production build (`NODE_ENV` guard) and does not trust client identity. | `INFRA-03` (file absent), `LIB-14`, `LIB-21` |
| "`npm run build` flaky on Windows" (2 of 3 runs failed) (`PERFORMANCE-OCR-REPORT.md:403`) | Not reproduced: the orchestrator's measured `npx next build` **succeeds with zero environment variables**, emitting 29 routes. Treat the flakiness as an environment artefact, not a repo property. | orchestrator measurement (§3) |
| "Signup anti-hijack (`OWNER_EXISTS`) verified by design" presented as complete account protection (`FINAL-AGENT2-AUDIT.md:128-129`) | The anti-hijack check is real, but signup is **unauthenticated with no rate limiter** (an account-existence oracle and an unbounded account-creation path) and provisioning is partial: a rebinding failure leaves an account that owns nothing while still returning `200 {cloud:true}`. | `API-7`, `API-10` |
| "Guest menu renders (200, correct items) … ordering works end-to-end for valid table+products" (`SECURITY-REPORT-ROUND-2.md:117`) | True of the happy path only. The guest cannot retry safely (duplicate orders), cannot act on a 409/404, loses cart and order number on refresh, and any owner whose first publish failed prints QR codes that lead to an unstyled 404. | `FE-03`, `FE-04`, `FE-05`, `FE-16`, `FE-02` |
| "Independence of the two extraction paths is guaranteed — `reconcileImports` keeps the richer result" (`PERFORMANCE-OCR-REPORT.md:321-326`; `README.md:213-217`) | The intent is confirmed, but the invariant `final >= max(ai, parser)` is **not tested and false**: the reconciler can drop parser products (and the orphaned category with them) while reporting success. | `OCR-01` |
| "no AbortSignal / retry budget" analyses assume the sleep budget bounds the request (`PERFORMANCE-OCR-REPORT.md:203-210`) | Correct as far as it goes, but incomplete: there is no timeout on the **client** scan POST either, closing the dialog leaves the request (and the paid provider spend) running, and the same absence of `AbortSignal` applies to the deterministic-parser safety path. | `OCR-06`, `INFRA-04` (platform 504 is the only bound today: `route.ts:16-17` `maxDuration = 120`) |
| Prior art's live findings C1–C3 / H1–H5 (rogue triggers, legacy constraints, worker-dashboard gate) (`SECURITY-REPORT-ROUND-2.md:36-79`) | Not re-verified and not refuted: they describe the **original developer's live project**, which these audits cannot reach. The repo-level counterparts are `DB-17` (triggers unaddressed by `1002`), `DB-20` (role vocabulary) and `FE-07`/prior-H5 (client-only worker gate, now a High). They remain open *for that database* until someone lists `pg_trigger`/`pg_policies` there. | `DB-17`, `DB-20`, `FE-07` |

---

## 8. What the new audits could NOT verify — the residual risk list

Read this as the boundary of the evidence; anything below is unproven in either direction.

1. **Any behaviour requiring a live database.** No base schema exists, so nothing was executed
   against Postgres: no migration was run, no `pg_policies`/`pg_trigger`/`pg_constraint` listing was
   obtained, and the prior reports' live findings (C1–C3, H1–H5, the RLS "applied" claim) are **not
   confirmable from this repo** (`DB` Open questions 1–2; `DB-06`, `DB-17`).
2. **OCR accuracy against the real provider — UNMEASURED.** No Mistral call was made, so the AI
   annotation's fidelity, the parser's behaviour on real photographs, Arabic/French/mixed-script
   documents, and run-to-run repeatability are all unknown. Every OCR finding is either an executed
   pure-function result on constructed input or a provider-contract inference
   (`OCR` "Coverage", `OCR-15`).
3. **`document_annotation`'s wire type (string vs object)** and whether `strict: true` is enforced
   by the provider or advisory — cannot be settled without one paid call (`OCR-15`, `OCR` Open
   question 2).
4. **The `page.tables` shape** for `table_format:"markdown"` (needed to choose the `OCR-04` fix),
   and whether `usage_info` reports total pages (needed to detect the 20-page cap) (`OCR` Open
   questions 3–4).
5. **Any end-to-end browser/route behaviour.** Nothing was served (no env, no DB), so no 401
   battery, no redirect, no form submission and no QR scan was exercised by the new audits;
   UI claims are code reads corroborated by prior-art probes. Prior-auth's local `SUFRA_AUTH_DISABLED`
   live testing cannot be repeated from the handed-over tree (`INFRA-03`).
6. **Concurrency, load, soak and memory behaviour.** No 100-way order run, no limiter hammer, no
   30–60 min soak, no memory profile; the prior numbers were read, not re-measured, and `OCR-07`
   corrects one of them analytically rather than empirically.
7. **Worker-session and invite lifetime exploitation** (`LIB-02`, `LIB-25`), **logout revocation**
   (`LIB-03`), **the reopen gate** (`LIB-01`) and **the limiter bypass** (`LIB-08`) were reasoned
   from code with stated repro paths, not exploited live.
8. **The legacy schema's actual column types and defaults** (`DB-14`, `DB-13`) and **the exact
   legacy trigger bodies** (`DB-17`) — without a dump, the base-schema author must make the
   migration work either way.
9. **Which migration/SQL was ever actually applied to the original project**, and whether its RLS
   policy names match `1002`'s denylist (`DB-06`, `INFRA-09`).
10. **Production deployment characteristics**: the actual host, whether an ingress terminates TLS,
    whether `X-Forwarded-For` is overwritten, and whether more than one instance runs — all of which
    determine whether the rate limiter and `appBaseUrl()` behave as intended (`LIB-08`, `LIB-24`,
    `INFRA` Open questions 4–5).
11. **The n8n service's intent** (roadmap vs template copy) and the repository's intended policy for
    tracking the three prior audit reports — both product/process decisions, not defects
    (`INFRA-05`, `INFRA-17`).
12. **The correctness of the 124 tests as a safety net.** They pass, but 52 of them cover lib
    predicates only; there are **zero** route-level tests, no test for `owner-auth.ts`, and no test
    for `parseOcrMarkdown` — the documented safety baseline for every scan (`LIB` "Test quality",
    `OCR` "Coverage").
