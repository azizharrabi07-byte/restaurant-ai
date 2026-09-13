# Final Agent 2 Audit — Public Handoff Report

**Date:** 2026-09-13 · **Branch:** `rag-option` · **Repo:** `azizharrabi07-byte/restaurant-ai`
**Auditor:** Agent 2 (adversarial QA, independent second pass + final handoff audit)
**Companion reports (all in this repo):** `SECURITY-REPORT-ROUND-2.md` (live-attack detail),
`PERFORMANCE-OCR-REPORT.md` (polling/OCR/capacity detail).
**Note:** the original pre-hardening audit `SECURITY-REPORT.md` (541 lines) was present at the
start of the audit session and later removed during cleanup; its substance (open routes,
client-trusted prices, dead-code fixes, unapplied migration) was independently re-verified
live and is preserved here and in Round-2.

## 1. Purpose and project status

**This repository is being handed to another developer for continued development. It is NOT
being released to production.**

What works today: owner email/password auth with HttpOnly sessions, server-priced public
ordering, atomic ticket RPC, idempotent order creation, menu sync with ownership checks,
rate limiting, OCR menu scanning behind owner auth. What does NOT work against the live
database: the entire worker system (invite → accept → login → manual orders), blocked by
legacy schema objects (§4, blockers C1–C3). The dev login bypass is ON in the local
`.env.local` (untracked, never pushed); production builds enforce auth. Google OAuth is
deferred by the owner. Verdict: **NOT READY — expected, accepted; this is a development
handoff, not a release.**

## 2. Agent 1 work reviewed

Agent 1 (hardening pass) implemented, per code inspection of the current tree:

- **Fixed:** owner gotrue-cookie sessions (`owner-auth.ts`, login/signup/logout/session
  routes + pages, dashboard layout guard); orders GET/PATCH owner protection + ownership
  checks; orders POST server pricing (`order-utils.ts`), atomic RPC ticketing with
  fallback + retry, `client_ref` idempotency, worker-gated custom lines; worker session
  model (`worker-auth.ts`: Bearer + HttpOnly cookie `sufra_worker_session`); invite/accept
  endpoints; menu GET owner-or-worker; menu PUT ownership verification + payload validation
  (`menu-sync-guard.ts`); scan hardening (auth → rate limit → fail-fast key/size guards);
  login rate limiting; dual-cookie logout; worker dashboard guard (later reverted, see F13);
  `createdAt` timezone fix; migration `1002_production_readiness.sql` (+ RLS lockdown).
- **Added tests:** order-utils (20), menu-sync-guard (12), rate-limit (8) — all genuine.
- **Claims verified by me:** 401 battery genuine (re-done with bypass off after the perf
  report caught an earlier invalid run done with bypass on + unreachable DB); pricing
  battery (25 hostile cases all correctly rejected/priced); cross-owner 403s; scan 413s.
- **Claims NOT independently verified:** live OCR accuracy (never measured against the
  provider; synthetic unit tests only); RLS policy table contents (no anon key to probe;
  migration reported success); worker end-to-end (blocked, §4); production-build stability
  on this host (flaky, §6-KNOWN RISK F17).

## 3. Agent 2 findings (consolidated)

Format: ID · Severity · Component · **Status** · evidence summary. Full reproductions in
`SECURITY-REPORT-ROUND-2.md`.

- **F1 · Critical · DB+workers · VERIFIED BUG** — Worker/invite creation impossible live:
  `workers_id_fkey` (id ∈ users), `workers_role_check` + `worker_invites_role_check`
  (lowercase-only; app sends `Cashier`/`Manager`), no default on `workers.id`. Live proof:
  23514/23503/23502 on insert; invite endpoint 500s. Fix SQL in §10-P0.
- **F2 · Critical · DB trigger · VERIFIED BUG** — `order_items` price trigger rewrites
  `price_snapshot` from products on every insert (0.01 → stored 5.50 live) and NULLs
  custom lines → all worker manual orders 500. Needs definition lookup + drop/narrow.
- **F3 · Critical · DB trigger · VERIFIED BUG** — `orders` ticket trigger overwrites
  `daily_order_number` with racy 1-based max+1 (inserted 9999 → stored 3), defeating the
  atomic RPC. Needs definition lookup + drop.
- **F4 · High · orders POST · FIXED + VERIFIED** — Unscoped product lookup allowed
  cross-restaurant items (200, foreign item baked in). Fixed (restaurant-scoped query);
  live 404 PRODUCT_NOT_FOUND on production build.
- **F5 · High · orders PATCH · FIXED (live re-verify pending)** — Forged `acceptedBy`
  silently dropped via blanket retry (stored NULL, 200). Fixed: UUID validation (400),
  retry only on 42703, worker attribution always from verified session. Changed after the
  last production build — rebuild + retest required.
- **F6 · High · worker accept · FIXED (live re-verify pending)** — Invite burned on
  worker-insert failure; no rate limit. Fixed: worker-first ordering + orphan cleanup +
  20/min limit. Live test blocked on F1.
- **F7 · Medium · worker dashboard · KNOWN RISK** — No server gate (static prerender
  serves shell; client bounces on `/me` 401 unless a local session exists). No data leaks
  (order APIs 401; custom lines need server session), but UI spoofing/demo-confusion
  possible. Recommend `force-dynamic` + server guard (or bounce-on-401-regardless).
- **F8 · Medium · rate limiter · KNOWN RISK** — Trusts client-controlled `X-Forwarded-For`
  (demonstrated: shared IP throttled to 429, rotated IPs evade) + in-memory per-process.
  Correct behind a trusted edge; document as deployment constraint.
- **F9 · Medium · scan · VERIFIED BEHAVIOR** — 401 unauthenticated; 13 MB file → 413 in
  ~340 ms; 80 MB declared → 413 in ~3 ms pre-buffer. Residual bound: 76 MB
  content-length cap; per-file check post-buffers that file (mitigated by 10/min limit).
- **F10 · Medium · polling architecture · VERIFIED BUG** — 3 s full-fetch `setInterval`
  per screen, no AbortController, overlapping ticks, no visibility/offline handling
  (corroborated in code; detail in PERFORMANCE-OCR-REPORT §§1–6). Works at café scale;
  fan-out is the scaling bottleneck (~2.5–3k Supabase calls/min at 50 dashboards).
- **F11 · Low · misc · VERIFIED** — Duplicate product lines accepted (totals correct);
  unknown fields stripped; non-UUID `acceptedBy` now 400 (F5); zero legacy non-http
  image URLs in DB; `javascript:`/`data:` URLs rejected at PUT; zero
  `dangerouslySetInnerHTML`; tokens all CSPRNG (`getRandomValues`/`randomUUID`/
  `randomBytes`); `Math.random` only for React keys; no localStorage-based
  authorization server-side.
- **F14 · Low · upload route · VERIFIED + MINOR FIX** — `POST /api/upload` (found during
  handoff review): auth + restaurant-namespaced paths + 5 MB cap + MIME allowlist were
  already correct, but it had **no rate limit** (fixed during audit: 30/min, same pattern
  as sibling routes). Residual, not fixed: MIME is client-declared only (no magic-byte
  check — a spoofed non-image stored as `image/jpeg` in the public bucket; SVG/HTML
  excluded by the allowlist, modern browsers won't sniff images to script, so Low) and no
  per-restaurant storage quota.
- **F12 · Low · dead code** — `canAcceptOrder`/`canSetArbitraryStatus` unused (PATCH
  enforces equivalently); `workers.id`/`worker_invites.id` default gaps (workers fixed
  in §10-P0 SQL; invites already defaults).
- **F13 · Process note · CHANGED UNDER AUDIT** — Worker dashboard server guard and
  several worker routes were reworked mid-audit (server-minted invite tokens,
  `/api/auth/worker/me`, role matrix `worker-permissions.ts`). End state re-reviewed
  and coherent; client/server token handling agrees (server QR token + local fallback).

## 4. Database findings

Live project state (verified via service-role probes; fixtures created and fully removed;
only `ahmed coffeee`, 6 tables, 1 pre-existing 2026-09-08 order remain): all 1002 columns
present (`session_token`, `client_ref`, `accepted_by(_name)`, `order_day` + trigger
verified populating, `sort_order`); RPC contiguous (1001→1004); money/quantity CHECKs
enforced (23514 live); RLS migration reported applied (effect probed behaviorally; direct
policy listing unavailable). **Conflicts (all VERIFIED BUG, see F1–F3):** two rogue
ad-hoc triggers (ticket numbering, price rewrite) and three legacy constraints
(`workers_id_fkey`, both role checks) plus missing `workers.id` default. Restaurant A has
an empty menu in DB (product-data note, not code). `sufra_daily_counters` works via RPC
but is invisible to PostgREST (schema cache; operational note).

## 5. Security findings

Confirmed closed: 10-endpoint 401 battery; owner/worker scoping; genuine cross-owner
PATCH 403 with row untouched; PUT IDOR 403 with byte-identical menu after (no partial
writes); forged worker attribution impossible (session-stamped; owner values UUID-gated);
invite double-claim race-safe by construction (conditional UPDATE, post-F1 verification
queued); login throttling (10/10 min → 429 + `Retry-After`); no enumeration on
recover/accept-unknown paths; signup anti-hijack (`OWNER_EXISTS`) verified by design
(it locked out the real owner once — resolved by ownership transfer + recovery flow).
Residual risks: F7, F8, H3/H4-pending-verify, C1–C3 pending SQL.

## 6. Performance findings

Measured on production standalone, single process: idempotency 100× same-ref → 100×200,
exactly 1 order + 1 item (p50 ~25 s under 100-way — correct, slow); tickets 100× distinct
refs → 100×200, 100 unique numbers, 0 failures (p50 ~22 s). Per-order cost ≈ 7 sequential
REST calls; rate cap 60/min/IP; dashboard poll fan-out dominates capacity (see
PERFORMANCE-OCR-REPORT §23). No memory profiling performed (dev host unsuitable);
OCR memory bound ≈ 76 MB/request cap.

## 7. OCR findings

Reviewed, **not executed live** (no scans fired against the paid Mistral API during this
audit; unit suites `ocr-quality`/`menu-import` are synthetic-only). Verified live: auth
gate (401), rate limit, fail-fast `NO_KEY` ordering in code, per-file + content-length
caps (413s measured). Risks for next dev: accuracy unmeasured on real Arabic/French/mixed
menus; retry storms on 429/5xx (bounded retries exist — re-check budgets); poor-quality
image behavior only unit-covered; provider/quota failure paths need a 10-scan corpus run
(see PERFORMANCE-OCR-REPORT §§7–16 for the full checklist).

## 8. Concurrency findings

Orders/idempotency/tickets above (§6). Invite double-accept: code race-safe, live test
blocked on F1. Ticket trigger race absorbed by unique index + 8-attempt retry at 100-way
(0 failures) — margin beyond that unmeasured; C3 fix removes the race source. No
supabase-realtime; overlapping 3 s polls can interleave (F10).

## 9. Build/test status (exact, re-run for handoff)

- `npm run test` (vitest run): **7 files, 124/124 passing** (order-utils 20, menu-import
  58, ocr-quality 14, menu-sync-guard 12, rate-limit 8, worker-auth 7,
  worker-permissions 5).
- `npm run typecheck` (`tsc --noEmit`): **0 errors**.
- `npm run lint`: clean (last full run; deprecation notice only).
- `npm run build`: clean at last build — **but newer code exists** (PATCH attribution
  H-F5, accept ordering H-F6): rebuild + smoke required before any demo.
- CI (`.github/workflows/ci.yml`): checkout → Node 20 → `npm ci` → lint → typecheck →
  test → build. Valid (all scripts exist in `package.json`).
- E2E/load/OCR-corpus: none in repo (gap; 5 route-level regression tests recommended in
  ROUND-2 §Test Coverage Gaps).

## 10. Remaining work for next developer

**P0 — must fix (app-breaking live):**
1. Run §9 SQL (workers FK/role/default + invites role) — unblocks the entire worker system.
2. Get trigger definitions (`SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE
   tgrelid IN ('public.orders'::regclass,'public.order_items'::regclass) AND NOT
   tgisinternal;`) then DROP/narrow both rogue triggers (F2/F3).
3. Rebuild, then verify live: invite→accept→worker login→manual order→PATCH attribution→
   dashboard; re-run idempotency/tickets (expect 1001-based numbers post-F3).
4. Add the 5 route-level regression tests; keep 124 green.
5. Decide F7 (restore server worker-dashboard guard recommended).

**P1 — important:** unset `SUFRA_AUTH_DISABLED` when testing auth (local `.env.local`
only, never pushed); integrate Google OAuth (`/api/auth/callback` is the seam);
eyeball `pg_policies` once; poll hardening (AbortController, skip-in-flight,
focus-refresh, offline badge); `Retry-After` on order 429s; send `clientRef` from worker
dialog + reuse on retry.
**P2 — improvement:** merge duplicate order lines; wire/remove dead role helpers;
Realtime/delta or longer poll beyond ~100 dashboards; `AbortSignal.timeout` on Mistral
calls; shared AudioContext + memoized rows.
**P3 — optional:** 10-scan OCR corpus with accuracy table; 50-order burst with memory
watch; multi-restaurant owner UX review.

## 11. Known limitations

Live OCR never executed; RLS contents never listed directly; worker live flow blocked on
P0-1; H-F5/H-F6 fixes code-complete but not live-verified; load measured on one Windows
host (not production hardware); no second device/browser automation; no anon key
available; production-build flakiness observed on this host (fresh builds + Linux CI are
the gate); original `SECURITY-REPORT.md` file missing from disk (substance preserved
here/in ROUND-2).

## 12. Public repository safety

**PASS — safe to publish.** `.env.local`/`.env` gitignored and untracked
(`git check-ignore` confirmed); git history scanned — the Supabase URL, service-role key
and Mistral key fragments appear in **zero** commits; no tracked file contains a JWT,
private URL, password, token, or real personal email (only `owner@sufra.app` legacy
constant, `dev@sufra.local`, `you@example.com` placeholders); `.env.example` holds
placeholders + dev-flag docs only; `.github/workflows/ci.yml` is secret-free;
no dumps/logs/temp files staged. Next developer must supply their own
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MISTRAL_API_KEY`
(see README + `.env.example`) and run `supabase/migrations/1002_production_readiness.sql`
plus the P0 SQL above against their own project.
