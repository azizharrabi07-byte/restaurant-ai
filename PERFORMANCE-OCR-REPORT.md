# Final Performance & OCR Validation

**Agent:** AGENT 2 (Principal Performance Engineer + Adversarial QA)
**Date:** 2026-09-13
**Branch:** `rag-option` (uncommitted working tree; nothing committed, per rules)
**Prior reports:** `SECURITY-REPORT.md` and `SECURITY-REPORT-ROUND-2.md` are
**not present** in the tree (the former was removed during the build pass as
stale). No Arena harness exists in the repo (glob `**/*arena*` → nothing).
The "latest production-readiness report" referenced is Agent 1's chat handoff.

**Environment:** Windows 11, Node 24, Next.js 15.5.25. Live Supabase project
reachable but high-latency/flaky from this host. No owner credentials available
(rule: never use the real owner's password), migration `1002` **not applied**
to the live DB, no Playwright installed, no second device/browser automation.

**What this means for honesty:** every test that would write to production
(order placement, concurrent orders, invite redemption, live OCR scans against
the paid Mistral API) is marked NOT PERFORMED with the reason. Everything
below is either measured (with n/percentiles) or derived from code with the
derivation shown. Nothing is fabricated.

---

## Executive Verdict

**NOT READY** — not because the architecture is wrong (it is largely sound),
but because the release-critical paths have never been exercised end to end:
the migration is unapplied (so atomic numbering, worker login, RLS, and the
storage bucket are all inactive on the live DB), live order visibility was
never measured with a real session, OCR accuracy was never measured against a
real provider call, and the production build is flaky on this host. Details
and the exact unblock checklist are in §§21–24.

---

## 1. Worker Dashboard Refresh

**Actual implementation** (`src/lib/use-orders.ts:31-55`): fixed-interval
polling. `setInterval(load, 3000)` re-fetches `GET /api/orders` (last 60
orders with items and table numbers, full payload, every tick). There is:

- no Supabase Realtime subscription anywhere in `src/`,
- no `AbortController` on the poll fetch,
- no sequence/staleness guard (only a `stopped` flag for unmount),
- no delta/ETag/`If-Modified-Since` — the full list is replaced wholesale,
- no wait for the previous request: ticks fire every 3 s regardless of
  in-flight requests,
- no `visibilitychange` handler, no backoff, no offline detection
  (`catch {}` keeps last state silently).

Discovery path for a new order: customer `POST /api/orders` → Postgres commit
→ next 3 s poll boundary → `GET /api/orders` (2–3 sequential Supabase calls)
→ `setOrders` replace → Kanban re-render + `NewOrderAlerts` toast/chime.

So **order visibility latency ≈ Uniform(0, 3000 ms) + poll request duration**.
With a fast backend the interval dominates; with a slow backend the request
duration dominates and requests overlap (see §2, §5).

`NewOrderAlerts` (`src/components/dashboard/new-order-alerts.tsx`) dedupes via
a `seen` ref (correct — no toast spam on re-poll), but creates a **new
`AudioContext` per fresh order and never closes it** (§20, bug #8).

---

## 2. Order Visibility Latency

End-to-end measurement (real browser + real session) was **NOT PERFORMED**:
no credentials, and placing 30 test orders would pollute the production DB.
What was measured instead, on the production standalone build:

| Probe (prod, auth enforced) | n | codes | min | p50 | p90 | p95 | max |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `GET /api/menu` → 401 (zero DB work) | 15 | 401×15 | 2 | 3 | 4 | 288 | 288 |
| `POST /api/orders` tampered → 400 (zero DB work) | 15 | 400×15 | 2 | 3 | 5 | 9 | 9 |
| `GET /api/auth/worker/me` → 401 (zero DB work) | 10 | 401×10 | 2 | 2 | 3 | 3 | 3 |

Framework floor in production: **~2–5 ms**. Application logic is not the
bottleneck (local harness: zod validation ~5–19 µs, reconcile 2.85 ms/scan,
quality gate ~33 µs, rate limiter 245,700 ops/s — §6).

**Derived visibility model** (not measured end to end): poll request cost =
2 sequential Supabase calls (worker) or 3 (owner: gotrue `getUser` +
restaurants + orders join). Observed single-SELECT RTT from this host: ~1–1.5 s
(dev); 4-query menu fetch: 3.6–11 s (dev, bypass on). In a production region
near Supabase expect ~50–200 ms per call → poll ~150–600 ms → **expected
median visibility ~1.6–1.8 s, p95 ~3.3–3.6 s**. From THIS host the poll
duration routinely exceeds the 3 s interval, which triggers bugs #1–#2 (§20).

---

## 3. Refresh Request Efficiency

Per worker dashboard, per 3 s tick:

- owner: `auth.getUser` (gotrue) + `restaurants` SELECT + `orders`+`order_items`+tables join = **3 sequential calls**;
- worker: `workers` SELECT + orders join = **2 sequential calls**.

That is **20 Next.js req/min/worker → 1,200/hr**, fanning out to
**~2,400–3,600 Supabase calls/hr per worker**. Findings:

- Full last-60 order history (with all line items) re-fetched every tick; no
  delta. Payload grows with items, not with changes.
- `auth.getUser` runs on **every** poll for owners (no session caching; the
  JWT is re-validated remotely each time instead of verifying the signature
  locally with expiry check).
- `getWorkerSession` runs on **every guest order POST** too, but short-circuits
  without DB I/O when no token is present (verified by reading
  `lookupWorkerByToken`: `if (!token …) return null`). No waste in production.
- No N+1 inside a tick (single join query), no duplicate intervals (one
  `setInterval` with cleanup on unmount — verified), no fetch after unmount
  (`stopped` flag).
- **Stale-overwrite race (bug #1, Medium):** overlapping polls can resolve out
  of order; the older response's `setOrders` blindly overwrites newer state.
  Effect: a just-accepted order can flip back to pending, or a new order can
  vanish until the next tick. Self-heals in ≤3 s but is user-visible.
- **Overlap pile-up (bug #2, Medium):** ticks never wait; when poll duration
  exceeds 3 s (measured 3.6–11 s from this host), in-flight requests
  accumulate without bound.

Projected backend load (extrapolated, §23): 50 workers ≈ 60k Next req/hr ≈
150k Supabase calls/hr + 60k gotrue verifications/hr (owner dashboards).

---

## 4. Worker Dashboard Load Test

**NOT PERFORMED** as specified (1/5/10/25/50 workers, 1–10 orders/s): no
worker sessions can be minted without the migration (`session_token` column
missing → `POST /api/auth/worker/accept` returns `NEEDS_MIGRATION`), no
browser automation exists, and generating load orders would pollute prod.

Substitutes actually executed:

- **Rate limiter live:** 65 rapid `POST /api/orders` (zero-DB 400 path):
  exactly 60×400 then 20×429 — the 60/min window enforced to the request
  (15 earlier probes + 45 = 60, then 429). Correct behavior verified.
- **In-process limiter hammer:** 200k ops in 814 ms (245,700 ops/s), exact
  60/70 allow/block split. CPU is a non-issue.
- Static result: nothing in the poll path serializes per-worker work
  server-side; load scales linearly with dashboards (§3 math).

---

## 5. Background/Offline Behavior

By code inspection (`use-orders.ts`, no visibility handlers, `catch {}`
silent):

- **Background tab:** Chrome throttles `setInterval` to ≥60 s → visibility
  latency balloons to **60 s + poll duration**. No `visibilitychange`
  refresh-on-focus, no Realtime. On a worker tablet that sleeps, orders can
  sit unseen for a minute+. **Medium** for a kitchen display use case.
- **Offline:** poll failures are swallowed; the board shows stale data with
  no "offline/stale" indicator — a worker cannot distinguish "no orders" from
  "disconnected". **Medium** (honesty-of-state).
- **401/expired session:** `if (!res.ok) return` — silent; board freezes on
  last state, no re-login prompt. **Low-Medium.**
- **Recovery:** automatic on next tick (no backoff → hammers a struggling
  backend at 20 rpm per dashboard; no retry storm beyond that since ticks are
  fixed-rate, not retry-multiplied). No permanent miss: state is always a full
  replace, so recovery converges. No duplicates on recovery (replace, not
  append). These recovery properties are **good**.

---

## 6. Memory/CPU Behavior

- **30–60 min soak: NOT PERFORMED** (no browser automation).
- By inspection: order state is replaced wholesale and capped at 60 rows —
  **no unbounded accumulation**. No repeated subscriptions (none exist). One
  interval per hook instance with cleanup. Effect deps `[live]` only.
- **Per-poll full re-render:** `setOrders` builds a new array every tick even
  when data is identical → entire Kanban + all `OrderCard`s re-render every
  3 s (no `memo`). Bounded but wasteful; on low-end tablets with 60 orders
  this is continuous CPU churn. **Low.**
- **AudioContext leak (bug #8, Low-Medium):** `playChime()` constructs a new
  `AudioContext` per new order, never `close()`d. A 50-order burst creates 50
  contexts (browsers cap concurrent hardware contexts; extras warn/suspend).
  Fix: module-level shared context.
- **OCR memory (§13):** route buffers the full multipart body via
  `req.formData()` before any size check: worst case 6×12 MB + overhead ≈
  **80 MB+ per scan request** held for the whole provider round-trip
  (minutes under retry). 10 concurrent scans ≈ 800 MB. The `Content-Length`
  pre-check is bypassable (chunked encoding). **Medium.**

---

## 7. OCR Architecture

`POST /api/menu/scan`: owner session → rate limit (10/min) → `NO_KEY`
fail-fast **before** reading the body → `Content-Length` pre-check → per-file
caps → sequential upload→OCR per file → quality gate (≤3 attempts) →
annotation + deterministic parser → reconcile → validated import. Verified:

- Unauthenticated requests return 401 **before** any rate-limit consumption
  or provider call (code order verified; live: unauth → 401).
- `MISTRAL_API_KEY` missing → immediate `503 NO_KEY`, zero retries (fixed).
- Typed errors mapped to correct statuses (400/413/415/422/429/502/503).
- No chat completions; OCR-annotation + local parser only (scope preserved).
- Retries are sequential awaits with bounded attempts — **no retry storm
  possible**; a provider outage produces slow failures, not amplification.

Per-file worst-case sleep budget: transport 2+4+6+6+6 = 24 s per call point;
OCR phase ≤3 quality attempts × transport(≤6 attempts) + 1.5 s + 3 s quality
sleeps ≈ 100 s+ of sleeps per file **plus unbounded fetch time — there is NO
timeout/`AbortSignal` on any Mistral fetch (bug #3, Medium)**. Six files are
processed serially, so a degraded provider can hold a request (and its ~80 MB
buffers) for many minutes; on Vercel `maxDuration: 120` kills it mid-flight;
self-hosted it hangs indefinitely. Quality-gate retries also re-spend paid
OCR quota (3× cost on degraded docs — by design, but a cost note).

---

## 8. OCR Accuracy

**NOT MEASURED against the live provider** (would spend real quota; rule:
respect provider limits). What exists:

- 14 `ocr-quality` + 58 `menu-import` unit tests, all passing — but on
  **synthetic inputs**, not on the real fixture menu in Downloads.
- Quality-gate thresholds (`MIN_NON_WS_CHARS=8`,
  `MIN_ITEMS_FOR_STRUCTURE=3`) are lenient-by-design with a documented
  rationale; reconcile keeps the richer of AI/parser (never fabricates —
  verified by reading `reconcileImports` usage and tests).

| Document | Expected Products | Detected | Correct | Missing | False | Price Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| *(no live runs performed — paid API)* | — | — | — | — | — | — |

Required before release: run the §12 corpus (including the real fixture)
against Mistral once, record this table for real.

---

## 9. OCR Latency

**NOT MEASURED live** (no provider calls). Local pure-function timing
(20k quality-gate evals: 653 ms → ~33 µs each; 200-product reconcile: 2.85 ms)
proves local stages contribute **nothing measurable** — total scan time is
essentially Mistral upload+OCR RTT plus the sequential file loop. Expected
shape (extrapolated from pipeline structure, not a claim): ~5–20 s per file
sequentially. No p50/p95 to report honestly.

---

## 10. OCR Concurrency

**NOT PERFORMED live** (cost + quota). Static analysis:

- Files within a scan are **serial**, so one scan never self-amplifies.
- Concurrent scans share nothing in-process (no shared queue/pool) — they
  contend only on event-loop/CPU (negligible; §6 numbers) and memory (§6:
  ~80 MB each).
- Rate limiter is per-instance in-memory: 10 scans/min/IP. Multi-instance
  deploys do not share it (documented in code) — a burst across instances or
  rotating IPs bypasses it. Provider-side 429s map to typed `RATE_LIMITED`.
- One failing scan cannot affect others (no shared mutable state).

---

## 11. OCR Retry Behavior

Calculated from code (all bounds verified by reading):

| Layer | Attempts | Backoff | Cap |
| --- | ---: | --- | --- |
| Transport (`postWithRetry`) | ≤6 | 2 s, 4 s, 6 s, 6 s, 6 s (≈24 s) + unbounded fetch | per call |
| 429 inside transport | retries on attempts 0–1 (5 s, 10 s), surfaces on attempt 2 | 15 s | per call |
| Quality gate (`ocrDocument`) | ≤3 full OCR re-calls | 1.5 s, 3 s | per file |
| Files | serial, no inter-file retry | — | 6 files |

No retry multiplication under concurrency (sequential awaits). Outage
behavior: slow, memory-holding hangs — not a storm. Missing: fetch timeout
(bug #3) makes every "attempt" potentially unbounded.

---

## 12. OCR Rate Limiting

- Live: limiter enforced exactly (60/min order window measured to the
  request; scan window is 10/min by the same code path).
- Order 429s carry **no `Retry-After` header** (scan 429s do) — inconsistent
  (bug #10, Low).
- Malformed-order bodies **consume quota** (rate check precedes validation).
  Per-IP scoping makes this self-DoS only. Noted.
- `X-Forwarded-For` is trusted as-is (documented assumption): a directly
  exposed instance accepts client-supplied XFF → trivial limiter bypass.
  Behind Vercel/nginx this is fine. (Low, documented.)
- In-memory = single-instance only (documented). Concurrent bypass trivially
  possible only by IP rotation, which the code acknowledges.

Attack runs of 10/20/50/100 scans were **not executed** (would spend quota).

---

## 13. OCR Memory Stress

Measured: nothing live (no uploads executed — would invoke the provider).
Analyzed (§6): full-body buffering before validation (~80 MB worst case per
scan), sequential processing (peak ≈ one scan's buffers), no streaming.
Edge cases (empty/corrupt/spoofed MIME/huge dimensions/password PDF) all hit
either the route's type/size guards or Mistral's own rejection — no crash
path found by reading; **not executed**, so this is a code claim, not a test
result.

---

## 14. OCR Edge Cases

Covered by unit tests for the pure layers (empty text, degraded structure —
14 quality tests). The HTTP-layer guards (0-byte, wrong MIME, oversized)
exist in the route but were **not executed live** (each execution would spend
quota or require auth sessions I cannot mint). No crash path identified by
reading; provider is never called for route-rejected input (guards precede
`runMenuScan` — verified order in code).

---

## 15. OCR Reconciliation

Verified by reading + 58 parser tests: AI annotation and deterministic parser
both always run; `reconcileImports` keeps the richer result; parser prices win
conflicts; no fabrication path (products originate only from AI JSON or parser
output). The §20 adversarial matrix (AI-missed vs parser-missed categories,
spelling/price conflicts, duplicates) is covered at unit level for the parser
side; the AI side is provider-stochastic and **unmeasured**.

---

## 16. OCR Repeatability

**NOT MEASURED** (10 repeat scans = 10× quota spend). By construction the
local parser is deterministic; the annotation LLM is stochastic and the
reconcile--;-"keep richer" rule exists precisely because run-to-run variance
was observed historically (code comment). Variability is therefore expected
but unquantified — must be measured pre-release.

---

## 17. Combined System Stress

**NOT PERFORMED.** By inspection the order path and OCR path share only the
Node process/event loop and the Supabase project. OCR scans are I/O-bound
(awaited fetches) with millisecond-scale CPU (§6), so CPU contention with
order polling is negligible; memory contention is the real shared risk (§6:
~80 MB per concurrent scan). Supabase connection pressure comes from the
service-role REST calls, not a pool (no PgBouncer/pooler in use — each call is
HTTPS). No evidence of cross-interference beyond memory.

---

## 18. Database Concurrency

**NOT PERFORMED live** (no credentials, production DB, migration unapplied —
creating test restaurants/orders would pollute prod; rule: use disposable data
or don't test).

Migration SQL reviewed line-by-line (299 lines) instead:

- `sufra_next_order_number()`: single-statement `INSERT … ON CONFLICT DO
  UPDATE … RETURNING` — callers serialize on the counter row lock; each gets a
  distinct number. **Mechanism is textbook-correct.** `GRANT EXECUTE TO
  service_role` present. Cannot claim tested.
- Unique backstop `(restaurant_id, order_day, daily_order_number)` with the
  `order_day` trigger avoids the immutable-index trap (comment shows the
  author knew about 42P17). Dedupe renumbers history once — acceptable.
- `client_ref` partial unique index is correct; app retry-on-23505 + fetch-
  existing logic read correctly, with two wrinkles: (a) if the fetch-existing
  misses it `continue`s and inserts a duplicate ref (burns a ticket number,
  terminates — cosmetic); (b) the `42703` branch assumes the missing column is
  `client_ref` (true today).
- Failed inserts burn RPC-allocated ticket numbers (gaps; cosmetic — numbers
  need uniqueness, not contiguity).
- RLS: owner-scoped, no `using (true)` anywhere (the `DROP POLICY public_read_all`
  safeguard confirms intent); `order_items` correctly scoped via parent join;
  no anon policies; storage bucket public-read only. Service role bypasses all
  of it, so the app is unaffected — defense-in-depth as claimed.
- `sufra_is_owner` is `STABLE` + `auth.uid()` — fine.

Same-`client_ref` ×40, same-invite ×10, same-order-accept races: **untested**.
Invite claim uses conditional `UPDATE … is_used=false` (correct pattern, per
Agent 1's code — read, not executed).

---

## 19. Arena Results

No Arena harness exists in the repo. **Nothing to run; no regressions
possible.** (Previous "Arena" mentions refer to an external audit, not a
runnable suite.)

---

## 20. Code-Level Findings

| # | Severity | Finding | Repro / evidence |
| ---: | --- | --- | --- |
| 1 | Medium | Poll responses can overwrite newer state (no `AbortController`, no sequence id) — `use-orders.ts:34-48` | Throttle `GET /api/orders` >3 s; accept an order; watch it flip back |
| 2 | Medium | Ticks never wait for in-flight requests — overlap piles up whenever poll >3 s (measured 3.6–11 s menu fetches) | Same throttle; watch request count grow |
| 3 | Medium | No timeout on any Mistral `fetch` — hung provider hangs the scan route until platform kill | Code: `postWithRetry` has no `AbortSignal` |
| 4 | Medium | Full body buffered by `req.formData()` before size validation (~80 MB/scan) | Code order in `scan/route.ts` |
| 5 | Medium | `SUFRA_AUTH_DISABLED=1` live in `.env.local`; dev bypass opens all walls (prod builds exempt by `NODE_ENV` check + loud warn) | `.env.local`, `owner-auth.ts:28-39` |
| 6 | Medium | `npm run build` flaky on Windows (ENOENT routes-manifest copy; ENOTEMPTY export rmdir); earlier "build succeeds" was truncated output | 3 runs: 2 failed, 1 passed (exit 0) |
| 7 | Medium | Idempotency half-wired: worker dialog never sends `clientRef`; guest mints a fresh ref per submit (no retry-with-same-ref) | `worker-new-order.tsx` body; `guest-menu.tsx` |
| 8 | Low-Med | `AudioContext` created per new order, never closed | `new-order-alerts.tsx:8-32` |
| 9 | Low | Whole Kanban re-renders every 3 s (new array identity, no `memo`) | `use-orders.ts:40-44` |
| 10 | Low | Order 429 lacks `Retry-After`; invalid bodies consume quota | Live 65-req test; `orders/route.ts` |
| 11 | Low | `auth.getUser` per poll (no local JWT caching) | `resolveOwnerSession` |
| 12 | Low | Background-tab throttle → 60 s+ visibility gaps; no stale/offline indicator; silent 401 freeze | No visibility handlers; `catch {}` |
| 13 | Info | PATCH accept is last-writer-wins; no 409 on double-accept | `[id]/route.ts` update path |
| 14 | Info | XFF trusted as-is (documented); multi-instance limiter not shared (documented) | `rate-limit.ts:1-12` |

Also verified **good**: strict price rejection live (400 on spoofed `price`
key), 401/404 shapes without user enumeration, invite endpoints 404-flat,
`/dashboard` → `/auth/login`, no `window.alert`, no secrets in diff, 117/117
unit tests green, typecheck/lint clean.

---

## 21. Critical Findings

1. **Release is blocked on the unapplied migration** — without it there is no
   atomic numbering (fallback races), no worker login, no RLS, no storage
   bucket. Everything P0 rests on a file that has never run.
2. **Order visibility was never measured end to end** (no session, no test
   orders on prod) — the 3 s poll design is fine on paper but unproven here.
3. **OCR accuracy is unmeasured** — the core feature's quality rests on unit
   tests over synthetic inputs.
4. **Agent 1's verification claims were partially invalid**: the 401 probes
   ran with the auth bypass active and an unreachable DB — 401s came from DB
   failure, not session checks. Re-verified properly in this round with the
   bypass off (genuine 401s, §2 table).

---

## 22. Recommended Fixes

1. Apply migration 1002; create owner account via `/auth/signup`.
2. Poll hardening: `AbortController` + monotonic sequence id (ignore stale),
   skip tick while one is in-flight (or switch to 3 s `setTimeout` chain).
3. `AbortSignal.timeout()` (e.g. 25 s upload, 90 s OCR) on all Mistral calls.
4. `visibilitychange` → immediate refresh on focus; stale/offline badge.
5. Send `clientRef` from worker dialog; reuse the same ref on order retries.
6. Shared `AudioContext`; `memo` on `OrderCard` rows / skip `setOrders` when
   payload hash unchanged.
7. `Retry-After` on order 429s; consider validating before rate-counting.
8. Remove `SUFRA_AUTH_DISABLED=1` from `.env.local` when done testing.
9. Investigate Windows build flakiness (likely AV/file-lock; CI on Linux is
   the gate: `.github/workflows/ci.yml` exists).
10. Pre-release live runs (needs owner cooperation): 30-order visibility
    sample, 40-concurrent order test on a disposable restaurant + cleanup,
    10-scan OCR corpus with the §27 accuracy table, one 50-order burst with
    memory watch.

---

## 23. Production Capacity Estimate

Derived from measurements (extrapolations labeled):

- Per dashboard: 20 polls/min → ~50 Supabase calls/min (worker) / ~60 (owner).
- 50 concurrent dashboards ≈ **2.5–3k Supabase calls/min** — well within
  Supabase allowances; the bottleneck is per-poll *latency* (sequential
  calls), not throughput.
- Orders: app CPU per order ~µs–ms; each order costs ~7 sequential REST calls;
  rate cap 60/min/IP (single instance). Order volume is not the constraint —
  **poll fan-out is**.
- OCR: ~1 scan ≈ up to ~80 MB transient + minutes of provider time;
  practical cap ≈ **a handful of concurrent scans per instance** (memory),
  10/min/IP (limiter). Do not run OCR bursts on the same instance serving
  peak ordering without memory headroom.
- Major bottleneck: **polling architecture** (full-fetch every 3 s per
  screen). Beyond ~100 dashboards, move to Realtime/delta or lengthen the
  interval with focus-refresh.

---

## 24. Final Verdict

`FINAL VERDICT: NOT READY`
