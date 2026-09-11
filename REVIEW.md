# Sufra — Full Code Review, Bug Hunt & Stress Test Report

**Date:** 2026-09-11 · **Branch:** `arena/01a08dea-restaurant-ai` (from `489c7d3`)
**Scope:** every feature — landing, onboarding wizard, AI menu scan (Mistral OCR), owner dashboard, guest QR menu + ordering, tables/QR, workers/invites, orders pipeline, Supabase sync, Docker setup, docs.

---

## 1. Verdict: is it ready to be released?

# ❌ Not yet — not for a public release.

**It is an excellent, well-built demo/prototype** (clean build, clean typecheck, clean lint, 72 passing unit tests, a genuinely smart OCR pipeline) — but the stress tests found **3 critical and 8 high-severity issues** that would cause real business damage (free orders, wrong ticket numbers, menu hijacking) the moment it touches the internet.

| Release target | Verdict |
| --- | --- |
| Local demo / development | ✅ Ready today |
| Single trusted café pilot on a private network | ⚠️ Only after Fix #1 (server-side prices) and Fix #2 (ticket numbers) — both corrupt business data |
| Public internet (real QR codes printed, strangers can reach it) | ❌ Blockers: auth, price validation, rate limiting, input validation, image pipeline |

**The good news:** everything blocking is concentrated in the 4 API routes (~700 lines total). The frontend, the OCR pipeline and the data model are in good shape. This is roughly 1–2 weeks of focused work to release-ready.

---

## 2. How this was tested

- **Static:** `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅ (all 17 routes compile) · `npm test` ✅ (72/72 vitest) · `npm audit` ⚠️ (2 known vulns in postcss via Next 15.5 — build-time only, fix lands with Next 16).
- **Dynamic:** built a production server (`next start`) against an in-memory Supabase/PostgREST emulator (`stress/mock-supabase.mjs`) and ran a 53-check end-to-end + security + concurrency + load suite (`stress/run-stress.mjs`).

Reproduce everything with:

```bash
npm run build
node stress/mock-supabase.mjs 54321            # terminal 1
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=mock-service-role-key \
npm run start                                  # terminal 2
node stress/run-stress.mjs http://127.0.0.1:3000   # terminal 3
```

---

## 3. Stress test results (summary)

| Area | Result |
| --- | --- |
| Menu sync round-trip (PUT→GET→guest page) | ✅ All pass, data reconciles correctly (categories/products/tables add **and delete** correctly) |
| Order lifecycle (create→list→accept→pay) | ✅ Works end-to-end |
| Guest page 404s (bad slug / bad token) | ✅ Correct |
| Menu scan error contract (0 files, bad type) | ✅ Correct codes |
| Mixed load: 2 000 requests, concurrency 25 | ✅ **0 server errors**, ~230–300 req/s, p50 ≈ 55 ms, p99 ≈ 490 ms |
| Order flood: 400 orders in ~1.5 s | ⚠️ All accepted — **no rate limit of any kind** |
| 40 concurrent orders, same table | ❌ **39/40 got the same ticket number** (two separate bugs, see F2/F3) |
| 2 devices syncing menus simultaneously | ❌ One device's categories **silently deleted** (last-writer-wins) |
| Large menu: 200 products + 8 real-size photos | ⚠️ 12.9 MB sync payload; **guest page HTML = 25.9 MB** — unusable on 4G |
| XSS payloads through the menu | ✅ React escapes them; no executable injection found |
| Malformed/hostile JSON bodies | ✅ Orders route returns 400 correctly; ❌ menu PUT crashes 500 (see H1) |

---

## 4. Findings

### 🔴 CRITICAL

**F1. Orders trust client-sent prices — guests can order for free, or for negative money.**
`src/app/api/orders/route.ts:133` computes `total` from the browser's `items[].price` and never checks it against the `products` table.

Demonstrated live:
- `price: 0` → **5 items accepted, total 0**
- `price: -10, qty: 3` → **total −30 accepted** (poisons revenue stats/balances)
- `qty: -4` → negative totals accepted
- `price: 1e9, qty: 1e9` → total 1e18 accepted
- `price: "abc"` → `total: null` stored

*Fix (small):* in `POST`, look up each `productId` in `products` filtered by the resolved restaurant, recompute `price_snapshot` server-side, validate `qty` as an integer 1–99, reject unavailable products. (The README's `recalc_order_total` trigger does **not** save you — the item snapshots themselves carry the attacker's prices.)

**F2. Every order in a day gets the same ticket number (#1001).**
`src/app/api/orders/route.ts:143`:
```ts
const nextNumber = (lastToday?.[0]?.daily_order_number as number) ?? 1000 + 1;
```
`??` binds looser than `+`, so this is `currentMax ?? 1001` — it returns the **current** max, not max+1. Verified: 5 sequential orders → `1001, 1001, 1001…`. Every kitchen ticket prints #1001.

*Fix:* `const nextNumber = (lastToday?.[0]?.daily_order_number ?? 1000) + 1;`

**F3. The ticket-number allocator is also a read-then-insert race.**
The `select max` and the `insert` are two separate calls; 40 concurrent orders produced 39 duplicates *in addition* to the F2 bug. Needs a single atomic statement (e.g. `insert … select coalesce(max(daily_order_number),1000)+1 … where created_at >= date_trunc('day',now())` inside one query) or a unique index `(restaurant_id, order_day, daily_order_number)` with retry.

**F4. There is no authentication anywhere.**
- `PUT /api/menu` — anyone who discovers the URL can rewrite the entire menu, tables, QR tokens. **Demonstrated:** renamed the restaurant to "HACKED CAFÉ" anonymously, and the guest menu served it.
- `PATCH /api/orders/[id]` — anyone can mark any order paid/accepted. Demonstrated.
- `GET /api/orders` — anonymous dump of the full order feed.
- Workers/invites are **client-side fiction**: worker identity lives in `localStorage` (`sufra.worker`), invites are accepted on a URL like `/worker/invite/anything?role=Manager&r=Name` — roles are self-granted, never sent to the server, and have no server-side meaning.

*Fix:* add Supabase Auth (magic-link for the owner; a real `workers` table with invite tokens for staff). Check the session in each route; keep service-role calls but scope every query by the caller's `restaurant_id`. RLS becomes your second line of defense.

### 🟠 HIGH

**H1. `PUT /api/menu` has zero input validation → 500 crashes.** Demonstrated: body without `restaurant` → unhandled `TypeError` (500); `categories: null` → 500. `zod` is already in `package.json` but unused in routes. A 500 here is worse than usual: the client treats it as a sync failure while **part of the write may already have landed** (restaurant row is written before categories/products/tables — the route is not transactional).

**H2. Missing `MISTRAL_API_KEY` is misreported as a network failure after ~24 s of futile retries.**
`src/lib/menu-scan.ts:105` — `apiKey()` is called *inside* `postWithRetry`'s try-block, so `NO_KEY` is swallowed as a "network error", retried 6 times with backoff, and surfaces as `NETWORK`/502 instead of the documented `NO_KEY`/503. (Found by the stress suite; README documents NO_KEY=503.)

**H3. Images are base64 data URLs end-to-end.** `ImageDropzone` → canvas → data URL → JSON payload → `products.image_url` text column → RSC payload. Measured: 8 realistic photos → 12.9 MB `PUT` payload and a **25.9 MB guest-page HTML**. Worse, `saveNow()` (`src/lib/onboarding-store.tsx:212`) writes that payload to `localStorage` **outside any try/catch** — past ~5 MB (i.e., a menu with several photos) `setItem` throws `QuotaExceededError`, the promise rejects unhandled, and **autosave silently stops working**.
*Fix:* upload images to Supabase Storage, store URLs; wrap `localStorage.setItem` in try/catch today.

**H4. The README's Supabase DDL does not match the code's schema.** Code uses `primary_color`, `cover_image`, `tagline`, `business_type`, `is_published`, `updated_at`, `categories.sort_order`, `orders.accepted_by*` — the README DDL creates `brand_color`, `cover_url`, `is_active`, `categories.position`, and none of the others. Anyone following the README gets a completely broken app, and the *real* schema exists nowhere in the repo. **Handover blocker.** (Related: the n8n/WhatsApp webhook is documented in §3 of the README and even wired as env var `N8N_WEBHOOK_URL` — but **no code ever calls it**. `grep N8N_WEBHOOK_URL src/` → 0 results.)

**H5. `/api/menu/scan` is an unauthenticated paid-API proxy.** Each request can carry 6 × 12 MB files that get uploaded to Mistral OCR (paid quota). No rate limit, no auth, no captcha. Trivially abusable once public.

**H6. Single-tenant architecture with a cached global owner.** `resolveOwnerUserId()` returns the *first* restaurant row's owner for **every** request, cached process-wide. Onboarding of a second restaurant is impossible, and every client is effectively the same "owner". Fine for one café demo; a redesign for anything multi-tenant.

**H7. Guest menu ignores `is_published`.** `/menu/[slug]/[token]` serves any existing slug+token regardless of publish state; tokens are 8 hex chars (32 bits, from `crypto.randomUUID` — OK-ish, but a draft menu is publicly visible once anyone sees a QR).

### 🟡 MEDIUM

- **M1. Concurrent menu sync loses data** (demonstrated): full-replace upsert+delete with no `updatedAt` guard; two devices → last writer deletes the other's rows. Also, right after hydration the debounced autosave re-PUTs the just-loaded state — every dashboard load rewrites the whole menu.
- **M2. No rate limiting on any endpoint** — order flood accepted at ~450 orders/s; dashboard renders thousands of fake tickets.
- **M3. "Revenue today" stats are wrong by design** — `GET /api/orders` returns the last 60 orders **of all time** (no date filter) and the dashboard labels them "today". After 60 orders the KPIs/charts are permanently stale/wrong.
- **M4. Product display order is not persisted** — `menu-mapping.ts` drops `position` for products (only categories have `sort_order`); DB sorts by `created_at`, so editor order ≠ guest order after re-imports/multi-device edits.
- **M5. `PUT /api/menu` forces `image_source: "pending"` on every product on every save** — wipes any future AI/manual distinction.
- **M6. Tables page foot-gun:** generating fewer tables than exist **silently deletes** the extra tables on next sync — printed QR codes for those tables die with no warning dialog.
- **M7. `makeToken()` uses `Math.random()`** (`src/lib/utils.ts:27`) for invite tokens — predictable; use `crypto.randomUUID()` (the tables page already does).
- **M8. `next.config.mjs` allows images from every host** (`hostname: "**"`, http+https) — combined with API-accepted arbitrary `imageUrl`s, guest pages can be made to load arbitrary third-party assets/tracking pixels. Restrict to your storage host.
- **M9. 2 npm-audit advisories** (1 high) in postcss via Next 15.5.25 — build-time only; resolved by Next 16 (breaking). Track it.

### ⚪ LOW / polish

- `window.alert()` for order errors on the guest menu (breaks the premium feel; use a toast).
- Settings page shows a hardcoded fake domain `*.menuos.app` (`src/app/(owner)/dashboard/settings/page.tsx:57`).
- GET routes swallow DB errors and return 200-empty — hard to diagnose outages.
- `next start` warns about `output: "standalone"` (works, but the Docker path should use `node .next/standalone/server.js` as intended).
- `next lint` deprecation (ESLint 8) — migrate to ESLint CLI.
- No CI: tests exist but nothing enforces them on push.
- QR "Download all" fires N sequential browser downloads — browsers may block after the first few; zip them instead.

---

## 5. What is genuinely good (keep this)

- **Build/type/lint/tests all green**, and the 72 vitest tests encode real business rules.
- The **OCR pipeline design is excellent**: deterministic parser + AI annotation reconciled by union, structural quality gate with retries, typed error contract, IPv4-first DNS workaround, stage logging. The "do not casually undo" notes in the README are spot-on.
- **Reconciliation logic** (`menu-import.ts`) is pure, deterministic and well-tested — a model for how the rest of the codebase should be structured.
- Nice i18n (EN/FR/AR incl. RTL), theme system, live phone preview, sensible empty-states.
- Origin-aware URLs (`appBaseUrl()`) — QR links survive ngrok/domain changes. Good instinct.
- Route-level error mapping for the scan endpoint is clean and fully documented.

---

## 6. Recommendations — prioritized roadmap

### P0 — release blockers (≈ 2–4 days)
1. **Server-side pricing** in `POST /api/orders`: resolve products by id + restaurant, ignore client prices, validate qty (int, 1–99), reject unavailable products, round to 3 decimals.
2. **Fix the ticket number**: precedence fix (F2) + atomic allocation (F3) + unique index.
3. **Add auth**: Supabase Auth for owner (magic link), real `workers` table + hashed invite tokens; enforce in `PUT /api/menu`, `GET/PATCH /api/orders`, `POST /api/menu/scan`; scope queries by the caller's restaurant.
4. **Validate all API bodies with zod** → 400, never 500; make menu PUT transactional (single RPC or sequential-with-cleanup).
5. **Hoist the API-key check** in `menu-scan.ts` before any network work so a missing key is an instant `NO_KEY`.

### P1 — before you print QR codes (≈ 1 week)
6. **Supabase Storage for images** (kill data URLs), wrap the localStorage write in try/catch, cap image weight.
7. **Rate limiting** on `POST /api/orders` (per IP + per table) and `/api/menu/scan`; add a lightweight honeypot/turnstile.
8. **Fix the README DDL** (or ship `supabase/migrations/*.sql` that matches the code) and implement or delete the n8n webhook section.
9. Persist **product `position`**; filter dashboard stats to "today" server-side; paginate orders.
10. Respect `is_published` on the guest page (404 or preview-mode for drafts).

### P2 — quality (ongoing)
11. Optimistic-concurrency guard for menu sync (ETag/`updated_at`), stop the post-hydration autosave echo.
12. CI (GitHub Actions): typecheck + lint + vitest + build on every push; add the stress suite in nightly mode.
13. Playwright E2E: onboarding → publish → guest order → accept → pay.
14. Swap `Math.random` tokens for `crypto.randomUUID`; lengthen table tokens.
15. Toasts instead of `window.alert`; zip QR downloads; confirm-dialog before table regeneration.
16. Error reporting (e.g. Sentry) + a `/api/health` endpoint.

---

## 7. Release checklist

- [ ] F1 server-side prices
- [ ] F2/F3 ticket numbers
- [ ] F4 auth on all mutating/reading routes
- [ ] H1 zod validation (no 500s)
- [ ] H5 NO_KEY fix
- [ ] H2 rate limits (orders + scan)
- [ ] H3 Storage-backed images + localStorage guard
- [ ] H4 README DDL / migrations match code; n8n implemented or removed
- [ ] H7 is_published honored
- [ ] M3 "today" stats filtered by date
- [ ] CI green: typecheck, lint, vitest, build, stress suite

**Bottom line:** strong prototype, honest docs, smart AI pipeline — but do not publish it as-is. Fix P0 (a few days of work) and it becomes a legitimately releasable single-café product; fix P1 before scaling beyond one trusted device set.
