# Sufra — QR Menu & Table Ordering

Sufra (سُفرة, "the laid dining table") is a QR-menu and table-ordering platform for
restaurants. The owner builds a branded digital menu on the owner platform, prints a
unique QR code per table, and guests scan to browse and order straight to the
dashboard in real time.

- **Stack:** Next.js 15 (App Router, `--turbopack`), TypeScript, Tailwind CSS v4, Zustand, Supabase (Postgres).
- **UI:** dark premium editor (owner platform) + themes for the guest menu (`classic`, `minimal`, `vibrant`, `gallery`).
- **Branding:** all prices are shown in dinars on the guest menu; the public landing page switches English / French / Arabic and $ / €.

---

## 1. Local development

```bash
cd restaurant-ai
npm install            # installs deps
cp .env.example .env.local   # then fill in the values below
npm run dev            # http://localhost:3000
```

Environment (`.env.local`):

| Var | What it's for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** service role key. Never commit a real value. |
| `MISTRAL_API_KEY` | **server-only** Mistral key for menu OCR scanning |
| `MISTRAL_OCR_MODEL` | optional OCR model override (default `mistral-ocr-latest`) |
| `NEXT_PUBLIC_APP_URL` | canonical app URL (used for password-recovery links; defaults to the browser origin) |
| `SUFRA_RATE_LIMIT_DISABLED` | set to `1` to disable rate limiting (dev/tests only) |
| `SUFRA_PLACEHOLDER_OWNER_EMAIL` | optional override for the legacy auto-provisioned owner email matched at signup |

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
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest run
npm run build       # production build
```

### Docker (optional)

A `Dockerfile` and `docker-compose.yml` are included:

```bash
docker compose up --build   # serves on :3000
```

---

## 2. Supabase — schema and migration

The schema lives in versioned SQL, not in this README:

- `supabase/migrations/1002_production_readiness.sql` — the production
  migration. Run it once in the Supabase SQL editor (it is idempotent, safe
  to re-run). It creates:
  - `sufra_daily_counters` + `sufra_next_order_number()` — atomic daily
    ticket numbers (first ticket of the day is #1001),
  - unique backstop on `orders (restaurant_id, day, daily_order_number)`,
  - `orders.client_ref` — idempotent re-submission (double-click safe),
  - `products.sort_order` — stable menu ordering,
  - `workers.session_token` — server-side worker sessions,
  - money/quantity `CHECK` constraints,
  - RLS lockdown (the app runs on the service role, which bypasses RLS;
    these policies exist so an exposed anon key can't read private data),
  - the public `menu-images` Storage bucket for menu photos.

Live tables (columns the app actually uses): `restaurants` (incl.
`owner_id → auth.users.id`, `slug`, `business_type`, `currency`,
`primary_color`, `cover_image`, `menu_layout_theme`, `is_published`),
`categories` (`sort_order`), `products` (`category_id`, `price`,
`image_url`, `image_source`, `is_available`, `sort_order`),
`restaurant_tables` (`table_number`, `qr_token`), `orders` (`status`,
`total`, `daily_order_number`, `is_paid`, `paid_at`, `client_ref`),
`order_items` (`product_id` nullable for manual lines,
`product_name_snapshot`, `price_snapshot`, `quantity`), `workers`
(`restaurant_id`, `full_name`, `role`, `session_token`), `worker_invites`
(`invite_token`, `role`, `is_used`, `used_by`, `expires_at`).

> **RLS note:** the app talks to these tables with the **service role key**
> (server-only), which bypasses RLS. The migration enables RLS with
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

**Why it "just works" with Sufra:** the app never hard-codes `localhost`. Every URL it
generates is derived from the browser's origin via `appBaseUrl()` in
`src/lib/utils.ts` (`window.location.origin`), so scan-the-QR links and menu URLs
automatically carry whatever origin the request came through — localhost
during development, the ngrok URL on the open internet, and a real domain in
production. No config change is needed when switching.

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

## 5. Where is what

| Area | Path |
| --- | --- |
| Public landing (EN/FR/AR + $/€) | `src/app/page.tsx`, `src/lib/landing-i18n.tsx` |
| Owner onboarding wizard | `src/app/onboarding/` |
| Owner auth (signup/login/logout) | `src/app/auth/`, `src/app/api/auth/` |
| Owner dashboard | `src/app/(owner)/dashboard/` |
| Worker terminal + invite accept | `src/app/(worker)/worker/`, `src/app/api/auth/worker/` |
| Guest menu (scan → order) | `src/app/menu/[slug]/[token]/`, `src/components/guest-menu.tsx` |
| Menu sync API (validation + IDOR guard) | `src/app/api/menu/`, `src/lib/menu-mapping.ts`, `src/lib/menu-sync-guard.ts` |
| Orders API (server pricing, atomic numbers) | `src/app/api/orders/`, `src/lib/order-utils.ts` |
| Image upload → Supabase Storage | `src/app/api/upload/`, `src/components/image-dropzone.tsx` |
| Auth sessions + worker permissions | `src/lib/owner-auth.ts`, `src/lib/worker-auth.ts`, `src/lib/worker-permissions.ts` |
| Rate limiting | `src/lib/rate-limit.ts` |
| Phone preview component | `src/components/phone-mockup.tsx` |
| Brand mark / wordmark | `src/components/brand-logo.tsx` |
| Supabase server client | `src/lib/supabase-admin.ts` |

---

## 6. Menu scanning (AI photo/PDF → menu) — how it works

The onboarding wizard has a **"Scan your menu"** button (`MenuScanButton` in
`src/components/onboarding/menu-scan-dialog.tsx`, mounted in
`step-categories.tsx` and `step-products.tsx`). The flow:

```text
Browser:  user picks photos/PDFs, client-side prepareUploadFile() → POST /api/menu/scan (FormData: files + venue)
Server:   upload each file to Mistral Files  →  OCR (markdown + whole-document json_schema annotation)
          → quality gate (ocr-quality.ts)  →  buildMenuImport(annotation)  [stats.source = "ai"]
          → parseOcrMarkdown() deterministic parser  [stats.source = "fallback"]
          → reconcileImports(ai, parser)  →  one MenuImportResult → onboarding store (mergeMenuImport)
```

Key files:

| File | Role |
| --- | --- |
| `src/app/api/menu/scan/route.ts` | Route contract + error→HTTP mapping |
| `src/lib/menu-scan.ts` | Orchestration: upload, OCR(+retries), parse, reconcile, logs |
| `src/lib/ocr-quality.ts` | Pure deterministic gate that rejects degraded OCR responses |
| `src/lib/menu-import.ts` | Pure pipeline: normalize → sanitize → build → reconcile |
| `src/lib/ocr-quality.test.ts` / `menu-import.test.ts` | Unit tests (72 total) |
| `src/lib/image-utils.ts` | `prepareUploadFile()` — client-side upload prep |
| `src/components/onboarding/menu-scan-dialog.tsx` | The scan dialog UI + error display |

Environment: `MISTRAL_API_KEY` (server-only) and optional `MISTRAL_OCR_MODEL`
(see `.env.example`). **Only Mistral OCR is used — chat completions are never
called** (the current subscription rate-limits chat completions with 429 code
1300 while the OCR quota is separate). Structure comes from the OCR endpoint's
built-in `document_annotation` (`json_schema`, strict) — prices in TND, EUR/USD
converted approx (1 € ≈ 3.4 DT, 1 $ ≈ 3.1 DT).

Design decisions (do not casually undo):

- **Both extraction paths always run.** The annotation (an LLM) is stochastic and
  can under-extract; the deterministic parser always runs as a baseline, and
  `reconcileImports` merges them (union of categories, product identity by
  normalized name with `name\0category` disambiguation for the same dish in two
  sections; parser price wins on disagreement; AI spelling wins on names).
- **Quality gate before annotation/parser.** `assessOcrQuality` flags responses
  that are near-empty (`EMPTY_TEXT`), have no items (`NO_ITEMS`), have ≥3 item
  lines but zero headings (`NO_STRUCTURE`), or end mid-section (`TRUNCATED`).
  It is purely structural — a real 1-category / 2-product menu passes. On a bad
  response the OCR call re-runs (up to `OCR_QUALITY_ATTEMPTS=3`) on the same
  file, then throws a typed error. Never import garbage silently.
- **Never hard-code the restaurant or a category count.** The tests use generic
  menus, not "Café Aziz".
- **Pure logic lives in modules free of `"server-only"` and React** so vitest can
  import them. `menu-scan.ts` is `"server-only"` and is *not* unit-tested.

API contract of `POST /api/menu/scan` — `{ files: File[], venue?: string }` →
`{ ok: true, result: MenuImportResult }` or `{ ok: false, error, detail }`:

| error | HTTP | Meaning | UI message |
| --- | --- | --- | --- |
| `NO_KEY` | 503 | `MISTRAL_API_KEY` not set | ms_error_NO_KEY |
| `TOO_MANY_FILES` | 400 | 0 or >6 files | ms_error_TOO_MANY_FILES |
| `FILE_TOO_LARGE` | 413 | > 12 MB | ms_error_FILE_TOO_LARGE |
| `BAD_TYPE` | 422 | not image/PDF | ms_error_BAD_TYPE |
| `UPLOAD_FAILED` | 502 | Mistral upload failed | ms_error_OCR_FAILED |
| `OCR_FAILED` | 502 | OCR degraded/empty after retries | ms_error_OCR_FAILED |
| `NETWORK` | 502 | `api.mistral.ai` unreachable after 6 tries | ms_error_NETWORK |
| `RATE_LIMITED` | 429 | HTTP 429 after retries | ms_error_RATE_LIMITED |
| `EMPTY` | 422 | no dishes/drinks extractable | ms_error_EMPTY |

Messages live in `src/lib/i18n.tsx` (EN/FR/AR) under `ms_error_*`; the dialog maps
codes via `ERROR_MSG_KEY` in `menu-scan-dialog.tsx`. Add a key to all three
locales when you add a code.

---

## 7. Troubleshooting — every issue we hit and its fix

> All scanner traces (stage logs, no secrets) go to the **server console** and
> `.dev.log` / `.dev.err.log` in the project root (git-ignored). Grep
> `.dev.log` for `FINAL ... categories= aiItems= parserItems=` to see exactly
> what happened on a scan.

1. **"Scan gives only 1 category (or catches all 4 only once in a while)".**
   Cause: the old client code downscaled every image to max **800px JPEG q0.82**
   (`1131×1600 → 566×800`). With such a small re-encode, Mistral returns full
   markdown but its **annotation comes back `{"categories":[]}`** (~5/6 runs),
   so the fallback parser alone collapses the result. Fix (done): images already
   ≤ 2048px are sent **unchanged** via `prepareUploadFile` (only really large
   photos are downscaled, at q0.9). Verified 10/10 scans return the full 4
   categories / 20 products. Further down the road, if you see `annotationBytes`
   of ~18 with good OCR, that's this signature.

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
   200 but only ~3 markdown lines, no headings. Now blocked by the quality gate
   (re-OCRs up to 3× then `OCR_FAILED`).

4. **`Mistral /v1/ocr → 400` "File could not be found or may have expired"**
   (code 3310). Mistral file-cache race/expiry on a repeat OCR of the same
   `file_id`. Transient; a retry of the request succeeds. The retry/backoff loop
   covers it. If it becomes common, re-upload the document on `3310`.

5. **`POST /api/menu/scan` 500 `UNKNOWN`.** Any non-`MenuScanError` escaping the
   route. Should no longer happen for transport failures (fixed with NETWORK);
   if you see one again, the `detail` is the real exception — investigate, don't
   ignore.

6. **`/login` returns 404.** Intended: this app has no `/login` page
   (`/` + `/onboarding` are the only public routes relevant here).

7. **Port 3000 not answering after edits.** The dev server can die silently.
   Restart with logging:
   `Start-Process cmd -ArgumentList '/c','npm run dev > .dev.log 2> .dev.err.log'`,
   then check `Get-NetTCPConnection -LocalPort 3000 -State Listen`.

8. **`next lint` prints a deprecation warning.** Next 15 still runs ESLint 8;
   the warning is expected. `npm run typecheck`, `npm run test`, `npm run lint`
   all run clean (72 vitest tests).

9. **ngrok is only needed to expose the dev server** (webhooks / real phone).
   The scanner itself needs no tunnel: browser → `localhost:3000` → Mistral.

---

## 8. For the next developer — getting up to speed fast

- **Run it:** `npm install`, `cp .env.example .env.local` (fill Supabase keys +
  a real `MISTRAL_API_KEY`), `npm run dev` → http://localhost:3000.
- **Verify a scan end-to-end without the UI:**
  `POST http://localhost:3000/api/menu/scan` with `FormData` fields `files`
  (1 image/PDF) + `venue`. A ready probe lives at
  `C:\Users\DELL\AppData\Local\Temp\opencode\aziz-route.js` (uses the real menu
  photo). Watch `.dev.log` for `OCR QUALITY`, `NETWORK RETRY`,
  `OCR RESPONSE PARSE`, `FINAL`.
- **Real menu fixtures used during development** (kept outside the repo because
  they're user photos): `Downloads\1131w-vQnxH5Nxwgc.webp` is **the production
  menu** — 4 categories **Coffee / Non Coffee / Pastries / Add-ons**, 20
  products (dollar prices). `cafe-menu-photo.png` is a *different* 3-category
  fixture (Coffees / Salades / Sandwiches) — do not confuse the two. If a scan
  "regresses to 3 categories", it's using the wrong photo.
- **Unit tests:** `npm test` (`vitest run`) — `src/lib/menu-import.test.ts` (58)
  and `src/lib/ocr-quality.test.ts` (14). Keep them green; they encode the
  reconcile + sanitize + quality-gate rules.
- **If you touch an error code**, update: the `ScanErrorCode` union in
  `menu-scan.ts`, the `STATUS` map + `errorFromStatus` in `route.ts`,
  `ERROR_MSG_KEY` in `menu-scan-dialog.tsx`, and the `ms_error_*` keys in all
  three locales of `src/lib/i18n.tsx`.
- **If you change OCR tuning**, look at `OCR_QUALITY_ATTEMPTS`,
  `MAX_PAGES_PER_FILE`, and `ocr-quality.ts` thresholds
  (`MIN_NON_WS_CHARS=8`, `MIN_ITEMS_FOR_STRUCTURE=3`).
- **Product reality to respect:** owner is building a Tunisian café menu; prices
  in scanner annotations arrive in TND by design. Do **not** hard-code the
  restaurant name, the 4 categories, or any fixture file into the pipeline — the
  tests will (rightly) call that out.
- **The 1-category bug has cost real time — before "fixing" a scan result again,
  reproduce with the actual user photo through the live route and read the
  `FINAL` line.**