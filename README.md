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