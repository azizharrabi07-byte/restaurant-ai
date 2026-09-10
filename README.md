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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public anon key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** service role key. Never commit a real value. |
| `NEXT_PUBLIC_APP_URL` | canonical app URL (defaults to the browser origin) |

The server resolves ownership via `resolveOwnerUserId()` in `src/lib/supabase-admin.ts`:
it takes `owner_id` from the first `restaurants` row (email-independent) and only
auto-provisions an auth user when no restaurant exists yet.

Checks:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

### Docker (optional)

A `Dockerfile` and `docker-compose.yml` are included:

```bash
docker compose up --build   # serves on :3000
```

---

## 2. Supabase — the DDL the app needs

These tables/constraints match the API routes (`/api/menu`, `/api/orders`,
`/api/menu/[slug]`). Adjust column types to your project if needed — the app only
requires the columns listed below.

```sql
-- Users auto-provisioned by the app (service role).
-- restaurants.owner_id -> auth.users.id

create table if not exists public.restaurants (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  name               text not null,
  slug               text not null unique,
  brand_color        text not null default '#D97706',
  logo_url           text,
  cover_url          text,
  menu_layout_theme  text not null default 'classic',  -- classic | minimal | vibrant | gallery
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  name           text not null,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  category_id    uuid references public.categories (id) on delete set null,
  name           text not null,
  description    text not null default '',
  price          numeric(10,3) not null default 0,
  image_url      text,
  image_source   text not null default 'none'
                  check (image_source in ('none','pending','ai','manual','external')),
  is_available   boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_products_restaurant on public.products (restaurant_id, position);

create table if not exists public.restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number  integer not null,
  qr_token      text not null
);
create unique index if not exists idx_tables_restaurant_number
  on public.restaurant_tables (restaurant_id, table_number);
create unique index if not exists idx_tables_qr_token on public.restaurant_tables (qr_token);

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants (id) on delete cascade,
  table_id            uuid references public.restaurant_tables (id),
  status              text not null default 'pending'
                        check (status in ('pending','accepted','paid')),
  total               numeric(10,3) not null default 0,
  daily_order_number  integer not null,
  is_paid             boolean not null default false,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_orders_restaurant_created
  on public.orders (restaurant_id, created_at desc);

create table if not exists public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  product_id            uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  price_snapshot        numeric(10,3) not null default 0,
  quantity              integer not null default 1,
  created_at            timestamptz not null default now()
);

-- Keep the order total in sync with its line items.
create or replace function public.recalc_order_total()
returns trigger language plpgsql as $$
begin
  update public.orders o
     set total = coalesce((
       select sum(i.price_snapshot * i.quantity) from public.order_items i where i.order_id = NEW.order_id
     ), 0)
   where o.id = NEW.order_id;
  return NEW;
end; $$;

create trigger trg_recalc_order_total
  after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_total();
```

> **RLS note:** the app talks to these tables with the **service role key** (server-only),
> which bypasses RLS. If you enable RLS, add policies for the `service_role`/`anon` users
> or keep the tables readable by the anon key for the public guest menu (`/api/menu/[slug]`).
> Orders are always written through `/api/orders` (server-side), never directly from the browser.

---

## 3. n8n workflow (the DSL code) — order → WhatsApp/notification

Sufra can fire an order webhook that n8n receives for WhatsApp / Slack / Telegram alerts.
Point `N8N_WEBHOOK_URL` at a published n8n Webhook workflow, and it is POSTed a JSON
body from `POST /api/orders` on every new order.

The workflow is written with the `@n8n/workflow-sdk` (the n8n Workflow DSL):

```javascript
import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

// 1. Webhook trigger — POST body:
//    { slug, tableToken, items: [{ productId, name, price, qty }], total, number }
const newOrderWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'New Order Webhook',
    parameters: {
      path: 'sufra-order',          // → https://<n8n>/webhook/sufra-order
      httpMethod: 'POST',
      responseMode: 'onReceived'
    }
  }
});

// 2. Build the human-readable alert text.
const formatMessage = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Format Message',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'sufra-alert',
            name: 'alertText',
            value: expr("'🛎️ Nouvelle commande #' + $json.number + ' — ' + $json.total + ' DT'"),
            type: 'string'
          }
        ]
      }
    }
  }
});

// 3. Send it (WhatsApp Cloud API via generic HTTP Request — swap for a Slack
//    or Telegram node if you prefer). executeOnce keeps it to ONE message
//    even when the webhook receives multiple items.
const sendWhatsApp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Send WhatsApp',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: 'https://graph.facebook.com/v19.0/<phone-number-id>/messages',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: 'Bearer <WHATSAPP_TOKEN>' }
        ]
      },
      contentType: 'json',
      jsonBody:
        "{ \"messaging_product\": \"whatsapp\", \"to\": \"<owner-phone>\", " +
        "\"type\": \"text\", \"text\": { \"body\": \"{{ $json.alertText }}\" } }"
    }
  }
});

// 4. Wire it together.
export default workflow('sufra-order-alert', 'Sufra Order Alert')
  .add(newOrderWebhook)
  .to(formatMessage)
  .to(sendWhatsApp);
```

Import + activate the workflow (Webhook trigger must be **Active**), then set
`N8N_WEBHOOK_URL=https://<n8n-host>/webhook/sufra-order` in `.env.local` and restart
the app. Everything after the webhook is yours to change — the DSL is just the
plumbing that turns a new order into a notification.

---

## 4. Connecting to the internet with ngrok

In development the app only listens on `http://localhost:3000`. To let a phone on
a different network (or n8n / Supabase) reach it, we exposed it to the internet with
**ngrok**:

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
curl https://abc123-ngrok.ngrok-free.app/api/menu     # 200 — same JSON as localhost
```

**Why it "just works" with Sufra:** the app never hard-codes `localhost`. Every URL it
generates is derived from the browser's origin via `appBaseUrl()` in
`src/lib/utils.ts` (`window.location.origin`), so scan-the-QR links, order webhooks,
and menu URLs automatically carry whatever origin the request came through — localhost
during development, the ngrok URL on the open internet, and a real domain in
production. No config change is needed when switching.

Tips/limits for the free plan:

```bash
# Fixed subdomain (recommended once your tunnel URL is shared anywhere):
ngrok http --url=sufra-table-order-01.ngrok-free.app 3000

# Exposing a local n8n (port 5678) the same way, when building the WhatsApp flow:
ngrok http 5678
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
| Owner dashboard | `src/app/(owner)/dashboard/` |
| Guest menu (scan → order) | `src/app/menu/[slug]/[token]/`, `src/components/guest-menu.tsx` |
| Menu sync API (supabase round-trip) | `src/app/api/menu/`, `src/lib/menu-mapping.ts` |
| Orders API | `src/app/api/orders/` |
| Phone preview component | `src/components/phone-mockup.tsx` |
| Brand mark / wordmark | `src/components/brand-logo.tsx` |
| Owner resolution (server) | `src/lib/supabase-admin.ts` |

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