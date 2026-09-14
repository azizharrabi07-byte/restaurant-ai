# API Routes Audit

Scope: every file under `src/app/api/**` (19 route files, 1939 lines), the helpers they depend on
(`src/lib/owner-auth.ts`, `worker-auth.ts`, `rate-limit.ts`, `order-utils.ts`, `menu-sync-guard.ts`,
`worker-permissions.ts`, `supabase-admin.ts`), and every client call site that consumes them
(`src/components/**`, `src/app/**`).
Method: full read of every route + every caller, cross-checked against README §1–§3 and the three
prior reports (`FINAL-AGENT2-AUDIT.md`, `SECURITY-REPORT-ROUND-2.md`, `PERFORMANCE-OCR-REPORT.md`).
No code was modified. No build/test/lint/typecheck was run (orchestrator-owned); the app cannot run
locally anyway — there is no `.env.local` and no base schema.

## Verdict

The API layer is architecturally sound and mostly hardened: every protected route verifies the
session server-side via the service-role client, pricing is server-authoritative and
restaurant-scoped, the order PATCH ownership/role logic is real, and the menu sync IDOR guard works
on the happy path. It is **not shippable as-is**, for two independent reasons found here: (1) the
worker manual-order flow is dead on arrival — the dialog posts `tableNumber` while the API requires
`tableToken`, so every worker-created order returns 400 (API-1); (2) a swallowed PostgREST error in
`GET /api/menu` is reported to the client as "empty menu", and the client's autosave then PUTs that
empty state, which makes the sync route **delete every product and every table** (API-2). A third
class of defects is caller-side: `use-orders` and the invite-accept page both ignore non-2xx
responses, so failures render as success (API-6, API-8).

## Required behaviour

Derived from the code, the README contract, and the in-code role matrix:

- Every non-public route authenticates the caller before doing any work and scopes every id it reads
  from the URL/body to the caller's own restaurant (README:35-37, "every protected route verifies
  the caller's session server-side").
- `POST /api/orders` is public but server-priced: the browser sends product ids + quantities, the
  server resolves price/name from the DB (README:49-51, 105-106).
- Roles `Cashier`/`Manager` are enforced server-side on every order mutation, client role is display
  only (README:45-48; matrix in `src/app/api/orders/[id]/route.ts:71-74`).
- Menu sync is validated and ownership-checked before it writes (`src/app/api/menu/route.ts:234-235`
  states this intent explicitly).
- A route must never return 2xx for a state the caller then treats as truth (all callers key off
  `res.ok` or `data.cloud`).
- 429s are rate-limit signals; the client is expected to back off on `Retry-After` where sent
  (inconsistent today — API-11).

### Per-route contract (reconstructed from code)

| Route | Methods | Auth | Request | Responses | Side effects |
|---|---|---|---|---|---|
| `auth/login/route.ts` | POST | none (public) | `{email,password}` zod: email/trim/lowercase, pw ≥6 | 503 `NO_BACKEND`; 429 `RATE_LIMITED` (10/10min, **no** `Retry-After`); 400 `BAD_BODY`; 401 `INVALID_CREDENTIALS`; 200 `{cloud:true,user}` | Supabase password sign-in; sets `sufra_owner_session` cookie |
| `auth/signup/route.ts` | POST | none (public, **unlimited**) | `{email,password(8–72),name?}` | 503; 400; 409 `OWNER_EXISTS` / `EMAIL_TAKEN`; 500 `CREATE_USER`; 200 `{cloud:true,user}` (even if cookie not set) | `auth.admin.createUser`, rebinds placeholder/unowned restaurants (update errors ignored), auto sign-in + cookie |
| `auth/logout/route.ts` | POST | none | — | 200 `{cloud:true}` | clears owner + worker cookies |
| `auth/session/route.ts` | GET | none (self-describing) | — | 200 `{cloud,user}` | none; README:131 documents it as a curl check |
| `auth/password/route.ts` | POST | owner session | `{password(8–72)}` | 503; 401; 429 (10/10min, no `Retry-After`); 400; 500 `UPDATE_FAILED`; 200 `{cloud:true}` | `admin.updateUserById` password; cookie rotation |
| `auth/recover/route.ts` | POST | none | `{email}` | 200 `{cloud:true}` always (incl. unknown email, bad body, no backend) except 429 (5/10min) | `resetPasswordForEmail` with `redirectTo=<origin>/auth/reset` |
| `auth/reset/route.ts` | POST | none (token possession) | `{token_hash,type:"recovery",password}` | 503; 429 (10/10min); 400 `BAD_BODY`/`INVALID_LINK`; 500; 200 `{cloud:true}` | `verifyOtp` → password update → auto sign-in + cookie |
| `auth/callback/route.ts` | POST | none (implicit-grant token) | `{access_token,refresh_token?}` | 503; 429 (10/10min); 400; 401 `INVALID_SESSION`; 200 `{cloud:true,user}` | `auth.getUser(token)` verify, then sets owner cookie |
| `auth/worker/invite/route.ts` | POST | owner session | `{role:"Cashier"\|"Manager"}` | 503; 401; 400; 404 `NO_RESTAURANT`; 500 `CREATE_INVITE`; 200 `{cloud:true,inviteToken,role}` | inserts `worker_invites` row, 24 h TTL; **no rate limit** (API-9) |
| `auth/worker/invite/[token]/route.ts` | GET | none (token) | path token (trimmed, ≤128) | 503; 404; 200 `{cloud:true,invite:{role,restaurantName,brandColor,expiresAt}}` | none; embed `restaurant: restaurants(name, primary_color)` |
| `auth/worker/accept/route.ts` | POST | none (invite token) | `{token(8–128),name(1–80)}` | 503 `NO_BACKEND`/`NEEDS_MIGRATION`; 429 (20/min, **with** `Retry-After`); 400; 404; 409 `ALREADY_USED`; 500 `CREATE_WORKER`; 200 `{cloud:true,worker}` | inserts worker incl. `session_token`, then conditional claim `is_used=false→true`, orphan delete on lost race, sets `sufra_worker_session` cookie |
| `auth/worker/me/route.ts` | GET | worker session | — | 503; 401; 200 `{cloud:true,worker:{id,name,role,restaurantId}}` | none |
| `menu/route.ts` GET | GET | owner **or** worker | — | 200 `EMPTY` (no backend / no restaurant / owner-lookup error); 401 `EMPTY`; 200 `MenuGetResponse{source:"supabase",restaurant,categories,products,tables}` | none; **errors of the 3 collection queries are swallowed** (API-2) |
| `menu/route.ts` PUT | PUT | owner only | `MenuSyncPayload` (validated by `validateSyncPayload`) | 200 `{cloud:false,error:"NO_OWNER"}` when no backend; 401; 400 `BAD_PAYLOAD{issues}`; 409 `SLUG_TAKEN`; 500 `INSERT_RESTAURANT`/`UPSERT_*`/`NO_RESTAURANT`; 403 `FORBIDDEN{conflicting}`; 200 `{cloud:true,restaurantId}` | updates/creates restaurant **before** slug + IDOR checks (API-3); upserts then deletes categories/products/tables not in the payload |
| `menu/scan/route.ts` | POST | owner session | multipart `files` (≤`MAX_FILES`), `venue` (≤200 chars) | 503 `NO_BACKEND`; 401; 429 `RATE_LIMITED` (10/min, **with** `Retry-After`); 503 `NO_KEY`; 413 content-length; 400 `BAD_BODY`/`TOO_MANY_FILES`; 413 per-file; `MenuScanError`→mapped status (see `STATUS` map); 500 `UNKNOWN`; 200 `{ok:true,result}` | buffers files in memory, calls Mistral OCR; no DB write |
| `orders/route.ts` GET | GET | owner or worker | — | 200 `{cloud:false,orders:[]}` (no backend/no restaurant); 401 `{cloud:false,error,orders:[]}`; 200 `{cloud:true,orders:[…≤60]}` | none; first restaurant by `created_at` for owners |
| `orders/route.ts` POST | POST | public; custom lines require worker session | `{slug,tableToken,tableNumber?,clientRef?,items[]}` | 503 `NO_OWNER`; 429 (60/min, no `Retry-After`); 400 `BAD_BODY`; 404 `NOT_FOUND`/`BAD_TABLE`/`PRODUCT_NOT_FOUND`; 409 `PRODUCT_UNAVAILABLE`; 422 `BAD_AMOUNT`; 500 `CREATE_ORDER`/`CREATE_ITEMS`; 200 `{cloud:true,order}` | allocates daily number (RPC → max+1 fallback, ≤8 attempts), inserts `orders` + `order_items`, deletes the order if the items insert fails, idempotent replay on `client_ref` 23505 |
| `orders/[id]/route.ts` PATCH | PATCH | owner or worker | `{status?,isPaid?,acceptedBy?,acceptedByName?}` | 503 `NO_OWNER`; 401; 400 `BAD_BODY`; 404 `NOT_FOUND`; 403 `FORBIDDEN` (cross-restaurant / role cannot pay); 500 `UPDATE`; 200 `{cloud:true}` | ownership check → role matrix → `update`; worker attribution stamped from session |
| `upload/route.ts` | POST | owner or worker | multipart `file` (≤5 MB, jpeg/png/webp) | 503 `NO_BACKEND`/`STORAGE_UNAVAILABLE`; 401; 429 (30/min, **with** `Retry-After`); 404 `NO_RESTAURANT`; 400 `BAD_BODY`; 415 `BAD_IMAGE`; 413 `IMAGE_TOO_LARGE`; 500 `UPLOAD_FAILED`; 200 `{cloud:true,url,path}` | creates the `menu-images` bucket if missing, uploads `<restaurantId>/<uuid>.<ext>` |
| `workers/route.ts` | GET | owner session | — | 503; 401; 500 `LIST_WORKERS`; 200 `{cloud:true,workers:[{id,name,role,createdAt}]}` | none; **no client caller** (API-13) |
| `workers/[id]/route.ts` | DELETE | owner session | path id | 503; 401; 400; 404 (not owned / unknown); 500 `REVOKE_WORKER`; 200 `{cloud:true}` | deletes the `workers` row (the only session-revocation path); **no client caller** (API-13) |

Cross-cutting: no route declares `export const dynamic`/`runtime` except `menu/scan`
(`runtime="nodejs"`, `maxDuration=120`). This is **not** a defect here: Next 15 tracks request usage
via a proxy (`node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js`, `nextRequestHandlers`
switch includes `headers`,`cookies`,`url`,`body`,`json`,`formData` → `trackDynamic`) and every route
in this tree touches `req.headers` (cookie parsing in `owner-auth.ts` / `worker-auth.ts`) or
`req.json()`/`req.formData()`, which forces dynamic rendering instead of a prerendered shell. No
`next.config.mjs` runtime override and no middleware exist.

## Findings

### API-1 · Critical · `POST /api/orders` × `worker-new-order.tsx` · VERIFIED
- Evidence: the route's schema requires a non-empty `tableToken` —
  `src/lib/order-utils.ts:61-65` (`tableToken: z.string(...).min(1, "tableToken must not be empty")`,
  not `.optional()`); the worker dialog posts only a number:
  `src/components/dashboard/worker-new-order.tsx:105-116` → `body: JSON.stringify({ slug, tableNumber, items })`.
  `src/app/api/orders/route.ts:212-215` rejects the request at validation, so the table branches at
  `orders/route.ts:234-243` (`else if (typeof parsed.tableNumber === "number")` / `else BAD_TABLE`)
  are **unreachable dead code**.
- Impact: every worker-created order — including every custom/manual line, the only way to enter an
  off-menu item — returns 400 `BAD_BODY` ("tableToken must be a string"). The feature is 100 %
  broken and the dialog reports only the generic `wo_failed` toast
  (`worker-new-order.tsx:119-121`). This is independent of, and survives, the DB blockers C1–C3 in
  the prior reports; every prior live test of worker orders used a hand-built body with `tableToken`,
  which is why it was missed.
- Fix: send the token from the dialog — the tables are already delivered to the client with their
  tokens (`GET /api/menu` maps `token: t.qr_token`, `menu/route.ts:122-126`), so
  `tableToken: tables.find(t => t.number === tableNumber)?.token` in
  `worker-new-order.tsx:108-116`. Also make the intent explicit in the schema: keep `tableToken`
  required for anonymous callers, and accept `tableNumber` when `opts.allowCustomLines` (worker) is
  set, e.g. `.refine()` on `orderBodySchema` — which simultaneously revives `route.ts:234-243`.

### API-2 · Critical · `GET /api/menu` + `onboarding-store` autosave · VERIFIED
- Evidence: the three collection queries destructure only `data`
  (`src/app/api/menu/route.ts:67-84`); a PostgREST error leaves `data` null and it is silently mapped
  to `[]` at `menu/route.ts:104-127`, then returned as a normal `{source:"supabase", restaurant, …}`
  body with status 200. The client hydrates that body straight into state without any error signal
  (`src/lib/onboarding-store.tsx:130-159`). The hydration sets a new `products`/`tables` identity,
  which re-runs the debounced autosave effect (`onboarding-store.tsx:252-270`), and `saveNow`'s only
  guard is `hasMenuContent`, which passes whenever the restaurant name is non-empty
  (`onboarding-store.tsx:84-85, 209`). The resulting PUT carries empty collections, and the sync
  route deletes everything not present in the payload: products `menu/route.ts:345-350`, categories
  `menu/route.ts:291-298`, tables `menu/route.ts:374-384`.
- Impact: a single transient DB error (or a column error such as `42703` on `sort_order` while a
  half-applied migration is in place) on the products or tables query makes the dashboard **delete
  every product / every table** of the restaurant ~900 ms later, with no user action and no
  confirmation. Deleting tables invalidates every printed QR code; deleting products silently
  destroys the menu. The owner sees a menu that "disappeared".
- Fix: fail closed. Check `error` on each of the three queries and return 503/500 (never an empty
  collection) — and never return a body that is indistinguishable from a legitimately empty menu.
  Client side, only arm the autosave after a fetch that returned `res.ok` **and** a body whose
  collections are present; treat an unhydrated state as unsavable.

### API-3 · High · `PUT /api/menu` · VERIFIED
- Evidence: the restaurant row is written before any uniqueness or ownership check — the existing
  row is updated with the new `slug` at `src/app/api/menu/route.ts:176-190` (new row inserted at
  `192-212`), and only afterwards is the slug clash detected (`menu/route.ts:223-232`, 409
  `SLUG_TAKEN`) and the IDOR conflict scan run (`menu/route.ts:243-262`, 403). There is no DB unique
  constraint on `restaurants.slug` (the route itself notes "DB lacks a constraint",
  `menu/route.ts:221`), and the guest page resolves the slug with `.single()`
  (`src/app/menu/[slug]/[token]/page.tsx:20-26`).
- Impact: on a slug clash the request returns 409 but the write already landed, so two restaurants
  now share a slug; `.single()` then fails with `PGRST116` (`multiple rows returned`) → `notFound()`
  → **the public menu 404s for both owners**, including already-printed QR links. The 403 IDOR path
  has the same shape: a payload with a foreign product id is rejected after the owner's restaurant
  row (name/slug/theme) was already mutated, and the insert path can leave a freshly created
  restaurant row behind.
- Fix: move both checks above the first write (slug clash and `findSyncConflicts` only need
  `ownerId`, not `restaurantId`-after-write), and make `slug` a DB uniqueness constraint; ideally
  run the whole reconcile in one RPC/transaction so a partial sync is impossible.

### API-4 · Medium · `fetchForeignRows` ownership guard · VERIFIED
- Evidence: `src/app/api/menu/route.ts:36-42` — `const { data, error } = await …; if (error) return [];`.
- Impact: the IDOR guard **fails open**. Any error from that ownership query (transient, schema
  cache, malformed filter) is interpreted as "no foreign rows", so a payload containing another
  restaurant's category/product/table ids proceeds to the `upsert(..., {onConflict:"id"})` calls and
  rewrites foreign rows. This is the one place where an infrastructure error silently disables a
  security control.
- Fix: return a sentinel that aborts the request (`throw`/`{ok:false}`) and answer 500; only a
  successful, empty result may mean "no conflicts".

### API-5 · Medium · `PATCH /api/orders/[id]` role matrix · VERIFIED
- Evidence: `src/app/api/orders/[id]/route.ts:10` (`VALID_STATUSES` includes `"pending"`), the
  mapping at `:82-90` writes `updates.status = "pending"` with no role check, and the helper that
  encodes "owners alone may reopen" is never called (`src/lib/worker-permissions.ts:26-28`,
  `canSetArbitraryStatus`). The in-code matrix at `orders/[id]/route.ts:71-74` claims
  "owner → accept, paid, reopen; manager → accept, paid; cashier → accept only".
- Impact: any Cashier or Manager can reopen an order (and a rejected 403 never happens), so an
  accepted order can be pushed back to the pending column by any worker, across devices. The
  documented matrix and the enforcement disagree; the prior report dismissed both unused helpers as
  "PATCH enforces equivalently" (ROUND-2 L2) — that is wrong for `canSetArbitraryStatus`. Secondary
  wrinkle: reopening a paid order leaves `is_paid=true`, which the client re-renders as `status:"paid"`
  (`src/lib/use-orders.ts:35-43`), so the reopen is invisible in the UI.
- Fix: `if (body.status === "pending" && !canSetArbitraryStatus(role)) return 403;` (or remove
  `"pending"` from `VALID_STATUSES` if reopen is not a product feature).

### API-6 · Medium · `POST /api/auth/worker/accept` × accept page · VERIFIED
- Evidence: the page only inspects `res.ok` and, separately, `401`/`404`:
  `src/app/(worker)/worker/invite/[token]/page.tsx:127-144`. `409 ALREADY_USED`, `429`, `500
  CREATE_WORKER` and `503 NEEDS_MIGRATION` fall through to the local demo branch (`:155-158`) and then
  unconditionally show the success toast `inv_welcomeToast` (`:159-163`). With the live schema, the
  accept route 500s on `workers_role_check` (prior report C1), so this is the current production path.
- Impact: a worker whose invite was already claimed, rate-limited, or rejected by the DB is told
  "welcome" and lands on `/worker/dashboard` **with no server session** — `WorkerShell` then bounces
  them (`worker-shell.tsx:40-42`). The worker believes they joined and cannot understand why nothing
  works. A burned invite is also indistinguishable from a successful join.
- Fix: degrade to the local path only for a network failure or `503 NO_BACKEND`; surface
  `ALREADY_USED` (409), `NEEDS_MIGRATION` (503) and `429` as errors ("this invite was already used",
  "ask the owner to finish the database update", "try again in Xs"). Do not toast success unless
  `server.worker` exists.

### API-7 · Medium · `POST /api/auth/signup` · VERIFIED
- Evidence: the route has no `checkRateLimit` (contrast every sibling: `login/route.ts:17`,
  `password/route.ts:25`, `recover/route.ts:26`, `reset/route.ts:22`, `callback/route.ts:23`,
  `worker/accept/route.ts:37`), and it answers `409 EMAIL_TAKEN` for an existing address
  (`signup/route.ts:75-80`) while `500 CREATE_USER` covers the rest.
- Impact: (a) an unauthenticated, scriptable account-existence oracle; (b) unbounded creation of
  *confirmed* auth users through the service-role client (`email_confirm: true`,
  `signup/route.ts:67-73`) — one HTTP request per user, no throttle, no captcha; (c) each such user
  also gets a session cookie.
- Fix: add `checkRateLimit(req, "signup", { limit: 5, windowMs: 600_000 })` before the DB work and
  send `Retry-After` (API-11). Consider collapsing the existence answer into the generic path.

### API-8 · Medium · `PATCH /api/orders/[id]` × `use-orders` · VERIFIED
- Evidence: `src/lib/use-orders.ts:57-68` — `await fetch(...)`; the response is never read. Callers
  apply the optimistic mutation and toast success immediately:
  `src/app/(owner)/dashboard/orders/page.tsx:38-46` and
  `src/app/(worker)/worker/dashboard/page.tsx:80-91`.
- Impact: a `401` (expired session), `403` (cashier marking paid, cross-restaurant), `400`
  (malformed `acceptedBy`) or `500` is invisible. The dashboard shows "Order accepted/paid" and the
  optimistic card state, then the 3 s poll silently reverts it
  (`use-orders.ts:33-53`) — a phantom success loop the operator cannot diagnose. This makes API-5
  and the role matrix unobservable to the user.
- Fix: check `res.ok` in `patch()`; on failure surface `data.message ?? data.error` via the existing
  toast and roll back the optimistic update (reuse the last poll snapshot). The route already returns
  a `message` for the 403 role case (`orders/[id]/route.ts:78`) — it is simply never read.

### API-9 · Medium · `POST /api/auth/worker/invite` · VERIFIED
- Evidence: the file imports no rate limiter (`src/app/api/auth/worker/invite/route.ts:1-11`) and
  inserts a redeemable credential unconditionally (`:59-68`).
- Impact: an authenticated owner (or anyone who obtained an owner session) can mint unlimited
  redeemable worker credentials — 256-bit tokens, but no throttle, no cap, and no cleanup of
  unclaimed rows. Refutes ROUND-2's "Login/order/scan/worker-accept/invite all limited"
  (`SECURITY-REPORT-ROUND-2.md:113`): invite has no limiter at all.
- Fix: `checkRateLimit(req, "worker-invite", { limit: 20, windowMs: 60_000 })` + `Retry-After`.
  A table-level cap on live invites per restaurant would be cheaper than a limiter at scale.

### API-10 · Medium · `POST /api/auth/signup` partial provisioning · VERIFIED
- Evidence: the restaurant rebinding updates ignore their results —
  `src/app/api/auth/signup/route.ts:84-90` (`await supabaseAdmin.from("restaurants").update(...)`
  with no error check) — and the response is `{cloud:true, user}` regardless of whether the auto
  sign-in produced a session (`signup/route.ts:93-106`: the cookie is set only `if (!sessionErr &&
  sessionData.session)`, yet 200 is always returned).
- Impact: on a binding failure the account is created but owns nothing (login lands on an empty
  dashboard with no explanation, and there is no retry path — a second signup is refused by design
  or binds nothing new); on a sign-in failure the client sees success, redirects to `/dashboard`
  (`src/components/auth-form.tsx:35-40`) and is bounced to `/auth/login`, i.e. "signup worked but I'm
  not logged in".
- Fix: check both update results and return `500 PROVISION_FAILED` (the user row exists; the client
  can then be told to re-run signup/login); return `{cloud:false, error:"SESSION"}`/non-2xx when the
  auto sign-in fails instead of a cookie-less 200.

### API-11 · Low · rate-limit response consistency · VERIFIED
- Evidence: `Retry-After` is attached on only 3 of the 9 limited routes — `menu/scan/route.ts:67`,
  `upload/route.ts:52`, `worker/accept/route.ts:41`. It is missing on `login/route.ts:17-22`,
  `orders/route.ts:192-202`, `password/route.ts:25-29`, `recover/route.ts:26-30`,
  `reset/route.ts:22-26`, `callback/route.ts:23-27`, all of which return 429 with only a `message`.
- Impact: callers cannot back off uniformly; the two client-side retry UIs that exist (guest order
  submit, scan dialog) read `message` prose instead. Refutes ROUND-2's "header-correct (`Retry-After`
  on login/scan paths)" (`SECURITY-REPORT-ROUND-2.md:113`) for login.
- Fix: return `headers: { "Retry-After": String(rate.retryAfterSeconds) }` from every 429 — best done
  by having `checkRateLimit` return the headers object so the pattern cannot drift again.

### API-12 · Low · `POST /api/menu/scan` error detail leak · VERIFIED
- Evidence: `src/app/api/menu/scan/route.ts:142-145` returns `detail: String(err)` for non-`MenuScanError`
  throwables, and `:136-141` returns `detail: err.message`; the provider-facing errors embed the raw
  upstream response body — `src/lib/menu-scan.ts:149-156`
  (`` `Mistral ${path} → ${res.status} ${detail}` `` with `detail = JSON.stringify(res.data).slice(0,200)`).
- Impact: internal/provider detail (endpoint paths, provider error payloads, stack-derived messages
  from `String(err)`) is returned to the browser. No secret is exposed (the key is only ever in a
  header), but it is unnecessary disclosure and it is the one place this otherwise-tidy layer leaks.
- Fix: log `err` server-side; return `{ok:false, error: code}` (`detail` only for the fixed, curated
  strings already in `menu-scan.ts`).

### API-13 · Low · unreferenced endpoints → no worker revocation · VERIFIED
- Evidence: no caller for `/api/workers` or `/api/workers/[id]` anywhere in `src` (grep for
  `api/workers` matches only the route files themselves). The owner workers page reads the local
  store instead — `src/app/(owner)/dashboard/workers/page.tsx:55-61` uses
  `useOnboarding().workers/invites` — and the store initialises those to `[]` and never hydrates them
  from the server (`src/lib/onboarding-store.tsx:77-78`, only `restaurantId` is set from
  `GET /api/menu`, `:159`).
- Impact: the owner's worker list is permanently empty on the device that created the invite (and
  after any localStorage clear), and **worker revocation is unreachable from the product** even
  though `DELETE /api/workers/[id]` is the only mechanism that invalidates a worker session
  (`workers/[id]/route.ts:8-12, 47-50`). A lost or hostile staff device cannot be cut off.
- Fix: wire the workers page to `GET /api/workers` and add a revoke action calling
  `DELETE /api/workers/[id]`; fold server worker rows into the store on hydration. (If the intent was
  to keep the local demo list, then the two routes should be deleted rather than left as a
  false-safety surface.)

### API-14 · Low · menu sync rewrites the public slug · VERIFIED
- Evidence: `slug` is derived from the display name on every save
  (`src/lib/menu-mapping.ts:96-101`, `slug: slugify(state.restaurantName || "my-cafe")`) and written
  unconditionally by the route (`src/app/api/menu/route.ts:179` on update, `:196` on insert). The QR
  URLs the owner prints are built from the same client-derived slug at render time
  (`src/app/(owner)/dashboard/tables/page.tsx:23-25`) and the guest route resolves by slug
  (`src/app/menu/[slug]/[token]/page.tsx:20-24`). `slugify` strips all non-ASCII
  (`src/lib/utils.ts:16-26`).
- Impact: renaming the restaurant silently changes its public URL, so every already-printed or shared
  `/menu/<slug>/<token>` link 404s. Names with Arabic or accented characters collapse to `my-cafe`
  (or collide with each other), which funnels straight into API-3's duplicate-slug state.
- Fix: make the slug immutable once created (write it only on insert; keep the old row on save), or
  keep a `slug_history` table and redirect. Add a fallback suffix for names whose slugify result is
  the default `my-cafe`.

### API-15 · Low · owner-supplied `acceptedBy` is not scoped to the restaurant · VERIFIED
- Evidence: `src/app/api/orders/[id]/route.ts:101-112` validates the value as a UUID but never checks
  that it belongs to `order.restaurant_id`; the name displayed to other staff comes from the
  client-supplied `acceptedByName` (`order-card.tsx:42-46` renders it verbatim), and the id is echoed
  back to every dashboard (`orders/route.ts:27-28`).
- Impact: an owner can attribute an order to an arbitrary UUID — including a worker of another
  restaurant — and pair it with any name, so the "Accepted by <name>" attribution on the board is not
  trustworthy. Low because only owners can do it, and the value appears in the board only.
- Fix: before writing, verify the id exists in `workers` with `restaurant_id = order.restaurant_id`;
  take the display name from that row instead of the body.

### API-16 · Low · `POST /api/auth/callback` refresh-token fallback · VERIFIED
- Evidence: `src/app/api/auth/callback/route.ts:50-56` — `setOwnerSessionCookie(res, parsed.data.access_token, parsed.data.refresh_token ?? parsed.data.access_token)`.
  The rotation path always attempts the refresh grant with the stored token
  (`src/lib/owner-auth.ts:171-176`, `resolveOwnerSession`).
- Impact: when the link carries no `refresh_token`, the access token is stored as the refresh token;
  the grant then fails deterministically and the session dies at the access-token TTL (~1 h) with no
  refresh (matching the file's own warning that layouts can only verify, not rotate). The user is
  logged out mid-work.
- Fix: reject the request (`400`/`401`) when no `refresh_token` is present, or store an explicit null
  and skip rotation for it rather than persisting a token that can never be used.

### API-17 · Low · `POST /api/upload` failures degrade to a data URL · VERIFIED
- Evidence: `src/components/image-dropzone.tsx:49-69` — any non-OK response (401, 413, 415, 429, 503)
  throws and falls into the `downscaleImage(file)` → `onChange(dataUrl)` fallback. The sync guard
  rejects non-http(s) image URLs (`src/lib/menu-sync-guard.ts:173-175`) and the route surfaces it as
  `400 BAD_PAYLOAD` (`menu/route.ts:153-159`), which the store only reflects as a generic "error"
  saving badge (`onboarding-store.tsx:239-245`).
- Impact: after a rejected upload (e.g. a GIF passes the client's `image/*` check but not the
  server's MIME allowlist at `upload/route.ts:79-82`), the menu carries a `data:` URL and **every
  subsequent autosave fails** — the whole menu silently stops persisting until the owner removes the
  image, with no message telling them why.
- Fix: don't fall back to a data URL when the server responded (only for network failure), and
  surface the route's `error`/`message` (415 "Only JPEG, PNG or WebP images", 413, 429). Long term,
  keep the local-only image out of the synced payload entirely.

### Caller ↔ route mismatch list

| # | Caller | Expectation | Route reality | Verdict |
|---|---|---|---|---|
| 1 | `components/dashboard/worker-new-order.tsx:105-116` | `{slug, tableNumber, items}` → 200 `{cloud,order}` | `tableToken` is required (`order-utils.ts:61-65`) → **400 BAD_BODY every time** | **Broken** (API-1) |
| 2 | `lib/use-orders.ts:57-68` | ignores status entirely | 401/403/400/500 possible | **Silent failure** (API-8) |
| 3 | `app/(worker)/worker/invite/[token]/page.tsx:127-163` | success toast unless 401/404 | 409/429/500/503 → "local" branch → success toast, no session | **Misleading success** (API-6) |
| 4 | `components/image-dropzone.tsx:52-60` | `{cloud,url}`; else local data URL | 415/413/429/503 with `error`+`message` → fallback breaks later saves | **Broken UX** (API-17) |
| 5 | `lib/onboarding-store.tsx:130-159` | any body with `restaurant` is truth | error responses are flattened to empty collections with 200 | **Data loss** (API-2) |
| 6 | `components/guest-menu.tsx:119-143` | `{cloud:true,order:{number,total}}`; else `data.message` | matches exactly (`orders/route.ts:298-309`); all failure paths carry `message` | OK |
| 7 | `components/onboarding/menu-scan-dialog.tsx:101-112` | `{ok:true,result}` / `{ok:false,error}` | matches the `ScanResponse` contract; unknown codes fall back to `ms_error_generic` | OK |
| 8 | `components/dashboard/invite-dialog.tsx:62-83` | `{cloud,inviteToken}` on 200; local link otherwise | matches; but a 500 `CREATE_INVITE` becomes a **local** link that only works in demo mode | Acceptable, documented fallback |
| 9 | `lib/onboarding-store.tsx:226-245` | `{cloud,restaurantId}` / `error` | matches (`menu/route.ts:137, 141-143, 387-390`) | OK |
| 10 | `components/dashboard/worker-shell.tsx:26-42` | `{cloud,worker}`; bounce on 401 | matches (`worker/me/route.ts:10-21`); a forged localStorage session still suppresses the bounce (prior H5) | OK w/ known H5 caveat |
| 11 | `components/auth-form.tsx:29-40`, `auth/reset/page.tsx:105-123` | `!res.ok \|\| !data.cloud` → error | matches; signup can return 200 `cloud:true` without a session (API-10) | Mostly OK |
| 12 | `components/forgot-form.tsx:17-21`, `owner-shell.tsx:71` | response unused | recover always 200; logout always 200 | OK |
| 13 | nobody | — | `GET /api/workers`, `DELETE /api/workers/[id]` | **Unreachable** (API-13) |

### Prior-report claims, re-verified

| Claim | Verdict |
|---|---|
| `POST /api/orders` is server-priced | **Confirmed** — catalog lines are `.strict()` (`order-utils.ts:21-32`) so client `price`/`total`/`name` are rejected, prices come from `products` (`orders/route.ts:138-165`), the total is recomputed (`order-utils.ts:165-181`). |
| `POST /api/orders` is restaurant-scoped | **Confirmed** — `.eq("restaurant_id", restaurantId).in("id", catalogIds)` (`orders/route.ts:141-144`); a foreign product resolves to no row → 404 `PRODUCT_NOT_FOUND` (`:155-157`). |
| `PATCH /api/orders/[id]` rejects a non-UUID `acceptedBy` with 400 | **Confirmed** — `UUID_RE` at `orders/[id]/route.ts:11`, gate at `:101-104`. |
| `PATCH /api/orders/[id]` never lets a client forge worker attribution | **Confirmed** — the worker branch stamps `session.workerId`/`session.fullName` and ignores the body (`:97-100`); the retry-without-attribution path fires only on a missing-column error (`:14-19, 119-132`), not on any write error, so the ROUND-2 H3 bug is genuinely closed. Residual owner-side gap is API-15. |
| `POST /api/menu/scan` orders its guards auth → rate limit → `NO_KEY` fail-fast → size checks | **Confirmed** — `menu/scan/route.ts:54-59` (auth), `:63-69` (10/min + `Retry-After`), `:72-77` (`NO_KEY` before any body read), `:80-86` (Content-Length), `:109-117` (per-file, before `arrayBuffer()`). |
| `PUT /api/menu` verifies ownership before writing | **Refuted in part** — the *row-level* IDOR scan does run (`menu/route.ts:243-262`) and no foreign row is ever upserted on the happy path, but the restaurant row is written **before** that scan and before the slug check (API-3), so "before writing" is not true and 403/409 responses leave a partial write. |
| "Login/order/scan/worker-accept/invite all limited and header-correct (`Retry-After` on login/scan paths)" | **Refuted on two counts** — invite has no limiter at all (API-9) and login sends no `Retry-After` (API-11). |
| Dead helpers `canAcceptOrder`/`canSetArbitraryStatus` are harmless ("PATCH enforces equivalently") | **Refuted for `canSetArbitraryStatus`** — reopen is unguarded (API-5). `canAcceptOrder` is genuinely redundant. |

## Verified-working

- Every protected route rejects unauthenticated callers before touching the DB: `menu` GET 401
  (`menu/route.ts:50`), `menu` PUT 401 (`:141-143`), scan 401 (`scan/route.ts:54-59`), upload 401
  (`upload/route.ts:41-44`), orders GET 401 (`orders/route.ts:38-40`), orders PATCH 401
  (`orders/[id]/route.ts:28-32`), workers 401 (`workers/route.ts:13-16`), worker-me 401
  (`worker/me/route.ts:11-13`), password 401 (`password/route.ts:19-21`).
- Ownership scoping is correct and non-trivial where it exists: PATCH compares
  `workerSession.restaurantId !== order.restaurant_id` (`orders/[id]/route.ts:52-55`) and, for
  owners, verifies the order's restaurant is owned by the caller rather than assuming "their first
  restaurant" (`:58-68`); `DELETE /api/workers/[id]` checks the worker's restaurant against the
  owner's full set (`workers/[id]/route.ts:38-45`) and returns 404 (not 403) to avoid an oracle.
- Server-side role enforcement works where it is implemented: `canMarkPaid` blocks Cashier from
  marking paid, with a UUID-tagged message (`orders/[id]/route.ts:71-79`), and the worker path always
  wins over the body for attribution (`:94-100`).
- No route pulls the service-role client into client code: the complete importer set of
  `src/lib/supabase-admin.ts` is all 17 route files under `src/app/api/**`, the RSC guest page
  `src/app/menu/[slug]/[token]/page.tsx`, and the two server libs
  (`owner-auth.ts`, `worker-auth.ts`) — zero `"use client"` modules.
- Rate limiting is present on the routes that call paid/expensive/costly resources, with sane
  budgets: login 10/10 min, order 60/min, scan 10/min, upload 30/min, accept 20/min, recover 5/10 min,
  password/reset/callback 10/10 min.
- `POST /api/orders` validates the entire payload before any write (`orders/route.ts:204-256`),
  verifies the table belongs to the restaurant via `qr_token` (`:227-233`), and cleans up a
  half-written order when the items insert fails (`:289-294`, mirrored in the 42703 fallback at
  `:341-348`). Idempotent replay on `client_ref` returns the original order rather than a duplicate
  (`:358-393`).
- `POST /api/auth/worker/accept` creates the worker before claiming the invite and deletes the orphan
  on a lost race (`accept/route.ts:74-104`), so a concurrency loser burns nothing and gets 409; the
  role always comes from the stored invite (`:61, 78`). Session tokens are 256-bit and invite tokens
  128-bit CSPRNG hex (`worker-invite.ts:5-13`).
- Cross-restaurant reads are absent from the list endpoints: orders are filtered by the resolved
  `restaurantId` (`orders/route.ts:60-63`), menu collections likewise (`menu/route.ts:69-83`).
- Response shapes are consistent *within* each route family and every caller keys off the correct
  discriminant (`cloud` for `/api/*`, `ok` for `/api/menu/scan`); no route returns a bare JSON array
  or a shape a caller cannot parse (the failures above are about *status semantics*, not shape).
- No `TODO`/`FIXME`/`HACK` markers in `src/app/api/**`; no `error && !data` treated as success except
  the two cases reported (API-2, API-4).
- `GET /api/menu` returns worker-safe data only: the owner's session check is separated from the
  worker's (`menu/route.ts:48-64`) and a worker's view is scoped by `worker.restaurantId`.

## Open questions

1. **Is `tableNumber` a supported public path?** The route implements it (`orders/route.ts:234-243`)
   but the schema forbids reaching it. If the intent was worker-only, the fix is the `.refine()`
   proposed in API-1; if guests were meant to order by table number, that bypasses the QR token and
   needs an explicit decision (it would let anyone with a public slug order to any table).
2. **`GET /api/menu` embed on invites.** `invite/[token]/route.ts:33-37` relies on PostgREST
   resolving `restaurant: restaurants(name, primary_color)`. Without the base schema I cannot confirm
   `worker_invites.restaurant_id` has a detectable FK; if it does not, every invite lookup returns
   `PGREST200` → `{data:null}` → 404 and the accept page silently degrades to demo mode. Worth one
   probe once a database exists.
3. **Should a paid order be reopenable at all?** API-5's fix assumes reopen is owner-only; the UI
   renders `is_paid=true` as `status:"paid"` (`use-orders.ts:35-43`), so a reopen of a paid order has
   no visible representation — either the status model or the UI mapping is wrong.
4. **`restaurants.slug` uniqueness** exists only in application code (`menu/route.ts:221`). The base
   schema slice should add a unique index; without it API-3 stays exploitable by race even after the
   ordering fix.
5. **Rate-limit state is per-process and trusts `X-Forwarded-For`** (`rate-limit.ts:1-12, 25-34`).
   Confirmed as documented behavior by ROUND-2 M1; not re-reported here, but every per-route budget
   above is void behind an untrusted proxy or with more than one instance.
6. **`status: "paid"` bodies.** The route accepts `{status:"paid"}` and maps it to `is_paid=true`
   (`orders/[id]/route.ts:82-86`) while the orders table only allows `pending`/`accepted`; the client
   never sends it (it sends `{isPaid:true}`). Dead-but-supported input — harmless, but a candidate for
   removal if the status model is ever tightened.
