# Security Audit Round 2

**Agent:** Agent 2 — Principal Security Engineer / Adversarial QA (independent pass)
**Date:** 2026-09-13
**Target:** `restaurant-ai` (Sufra), localhost + live Supabase project `uejxcwsusinkkejhuuyp`
**Method:** Live adversarial testing against production builds (`next start` / standalone), disposable test identities/restaurants (owner-B/C/D), raw-socket probes, 100-way concurrency runs, direct PostgREST verification, full code re-read. All fixtures removed afterwards; DB restored to pre-audit state (1 restaurant, 6 tables, 1 pre-existing 2026-09-08 order, 7 original users).
**Suite:** 124/124 vitest passing · `tsc` 0 errors · `next lint` clean · `next build` clean (at time of build; see O3).

## Executive Verdict

**NOT READY**

## Executive Summary

The hardening pass is real and largely effective: every unauthenticated probe is rejected, pricing is server-authoritative, IDOR checks hold cross-owner, idempotency is exact under 100-way concurrency, and tickets are unique. Three shipped fixes were verified live during this audit (cross-restaurant product scoping, PATCH attribution hardening, accept-route ordering).

The release is blocked by the **live database disagreeing with the application** in three places: hidden legacy triggers override order numbering and pricing (breaking all worker manual orders), and legacy constraints make worker/invite creation impossible. These are not code bugs — the code is correct — but the worker system is **100% non-functional against the current live schema** until the SQL in §Recommended Next Actions is run. A fourth blocker: the worker dashboard reverted to a client-side gate (Medium). A fifth is procedural: dev login walls are intentionally open (`SUFRA_AUTH_DISABLED=1`, production builds enforce) and Google OAuth is deferred by the owner — both accepted dev choices, both release-gating until reversed.

## Live Database Verification

| Object | Live status | Evidence |
|---|---|---|
| `workers.session_token` | EXISTS | PostgREST column probe |
| `orders.client_ref` / `accepted_by` / `accepted_by_name` / `order_day` | EXIST | probes + `order_day` auto-populated `2026-09-12` on API-created order (trigger works) |
| `products.sort_order` | EXISTS | probe |
| `sufra_daily_counters` | EXISTS functionally (RPC increments contiguously 1001→1002→1003→1004) but **invisible to PostgREST** (schema cache; O4) | RPC calls + PGRST205 on table |
| `sufra_next_order_number()` | WORKS, contiguous | sequential + concurrent calls |
| `products.price>=0`, `order_items.quantity 1..500` | ENFORCED (23514 live) | negative inserts rejected |
| RLS policies (1002 §7, incl. `order_items` parent-order policy, no `workers_self_read`/`worker_invites_accept`) | APPLIED (user-ran script reported success; owner/invite/worker policies observed effective: anon gets nothing, 401 battery) | script success + behavioral probes (no anon key available to probe PostgREST directly) |
| Rogue `orders` ticket trigger (max+1, 1-based) | PRESENT — overrides app numbering (inserted 9999 → stored 3) | live proof |
| Rogue `order_items` price trigger (re-prices from products; NULLs custom lines) | PRESENT — inserted 0.01 → stored 5.50; NULL product_id → 23502 | live proof |
| `workers_id_fkey` (id ∈ users), `workers_role_check` + `worker_invites_role_check` (lowercase-only), no default on `workers.id` | PRESENT — every worker/invite insert with app values fails | live proof (`Cashier` → 23514; random id → 23503; missing id → 23502) |

## Critical Findings

### C1 — Worker/invite creation impossible against live schema
- **Severity:** Critical · **Component:** DB schema (`workers`, `worker_invites`) vs `POST /api/auth/worker/invite`, `POST /api/auth/worker/accept`
- **Evidence:** `role='Cashier'` → 23514 `workers_role_check` / `worker_invites_role_check`; random-UUID `workers.id` → 23503 `workers_id_fkey`; omitted `workers.id` → 23502. Live probes 2026-09-13. Consequence observed: `POST /api/auth/worker/invite` → `500 CREATE_INVITE`; accept cannot succeed.
- **Impact:** Entire worker system (invite → accept → login → worker orders/attribution) is non-functional in production.
- **Recommendation:** Run §Next Actions SQL (drop FK, relax both role checks to both cases, `id SET DEFAULT gen_random_uuid()`). Already added to `supabase/migrations/1002_production_readiness.sql` §9. Then re-run the worker-flow verification.

### C2 — Hidden `order_items` price trigger breaks all worker manual orders
- **Severity:** Critical · **Component:** DB trigger on `order_items`
- **Evidence:** Direct insert `price_snapshot=0.01` stored as `5.50` (live product price); API custom line → `500 CREATE_ITEMS`; direct custom insert → 23502 (`price_snapshot` NULLed by trigger when `product_id` is NULL).
- **Impact:** 100% of worker-created custom orders fail; catalog snapshots are silently rewritten (app-level pricing fiction).
- **Recommendation:** Drop or narrow the trigger (only fill when `product_id IS NOT NULL AND price_snapshot IS NULL`). Exact DROP pending trigger-definition lookup (§Next Actions).

### C3 — Hidden `orders` ticket trigger overrides atomic allocation
- **Severity:** Critical (integrity) · **Component:** DB trigger on `orders`
- **Evidence:** Inserted `daily_order_number=9999`, stored `3`. App RPC advances counters pointlessly; stored numbers are trigger max+1 (1-based, not the designed 1001-based).
- **Impact:** Numbering contract violated; trigger max+1 is racy → under concurrency it collides (23505) and the API burns retries (held at 100-way in §Concurrency Results, but margin unknown beyond that).
- **Recommendation:** Drop the trigger; numbering falls back to RPC + unique index as designed. Exact DROP pending definition lookup.

## High Findings

### H1 — Cross-restaurant product reference (FIXED, verified)
- **Severity:** High · **Component:** `POST /api/orders` pricing (`priceLines` unscoped `IN (ids)` query)
- **Evidence:** Pre-fix: foreign product ordered into another restaurant's order, 200 total=42.5. Post-fix (`.eq("restaurant_id")`): 404 PRODUCT_NOT_FOUND live on production build.
- **Impact (pre-fix):** menu integrity violation, cross-restaurant data mixing.
- **Recommendation:** Done. Add route-level regression test.

### H2 — Invite creation 500 (schema leg of C1)
Covered by C1; extended §9 SQL includes `worker_invites_role_check`. Client/server token handling re-verified coherent (server-minted QR token, local fallback).

### H3 — PATCH silently dropped forged attribution (FIXED)
- **Severity:** High (robustness/integrity signal) · **Component:** `PATCH /api/orders/[id]`
- **Evidence:** Owner PATCH with `acceptedBy:"mallory"` stored NULL (non-UUID → write error → blanket retry-without-attribution swallowed it), 200.
- **Fix shipped:** `acceptedBy` must be UUID (400 otherwise), `acceptedByName` ≤80 chars, fallback retry only on 42703 (missing column), all other errors returned. Worker path still stamps verified session only.
- **Recommendation:** Rebuild + live re-verify (code changed after last production build).

### H4 — Accept burned invites on failure + had no rate limit (FIXED in code)
- **Severity:** High · **Component:** `POST /api/auth/worker/accept`
- **Fix shipped:** worker-created-before-claim (orphan deleted on lost race, 409), rate limit 20/min restored, explicit UUID id.
- **Recommendation:** Rebuild + live verify post-§9 (blocked on C1 until then; current live behavior correctly degrades to 500/503 without partial workers).

### H5 — Worker dashboard has no server gate (client-side bounce only)
- **Severity:** Medium · **Component:** `(worker)/worker/dashboard/layout.tsx` + `WorkerShell`
- **Evidence:** `GET /worker/dashboard` no-cookie → 200 (statically prerendered; server guard was reverted by design). Shell bounces on `/me` 401 — **unless** a local `workerSession` exists (forged localStorage suppresses the bounce). No order data leaks (order APIs 401 → demo/empty state), and custom lines still require a server session. Impact is UI spoofing + confusion, not privilege.
- **Recommendation:** `export const dynamic = "force-dynamic"` + restore server layout guard (primary), or at minimum bounce on 401 regardless of local session (safe: demo 503 path untouched).

## Medium Findings

- **M1 — Rate limiter trusts client-controlled IP.** Demonstrated: same `X-Forwarded-For` ×12 on login → 10×401 then 429,429 (enforced); distinct XFF ×4 → all pass (separate buckets = spoofable). Correct behind a trusted edge that overwrites XFF; wide open to rotation by anyone reaching the server directly. Plus in-memory = per-process (multi-instance deployments don't share state). Document as deployment constraint; consider `trustProxy` hop-count or edge-provided header.
- **M2 — Scan memory bound is the 76MB content-length cap.** Per-file 12MB check runs after that file buffers (13MB real file → 413 in 342ms, correct). Concurrent ×N ×70MB is the pressure path; 10/min/IP limiter (subject to M1) is the mitigation.
- **M3 — Stale-server incident.** A `:3000` process served deterministically wrong results (valid slug → 404) while the same build fresh on `:3002` served correctly; resolved by restart. Suspected wedged dev/older process. Recommend: always re-verify on fresh builds; treat stray processes as suspect.
- **M4 — `sufra_daily_counters` invisible to PostgREST** (schema cache). Zero functional impact (RPC path verified); operational note.
- **M5 — Throughput ~3.5 orders/s** single-process (100 orders/28.8s, p50 ~22-25s under 100-way). Adequate for café scale; bottleneck is sequential REST roundtrips per order, not ticket logic.

## Low Findings

- **L1 — `workers.id` lacks a DEFAULT** (covered by §9 `SET DEFAULT gen_random_uuid()`; `worker_invites.id` already defaults).
- **L2 — Dead role helpers** (`canAcceptOrder`, `canSetArbitraryStatus` unused; PATCH enforces equivalently via fixed status mapping + `canMarkPaid`). Harmless; wire or remove.
- **L3 — Duplicate product lines accepted** (two lines, same id; totals correct). Design choice; merging would be nicer.
- **L4 — Unknown body fields stripped** (`.strip()`; extra `total` ignored, 200). Correct posture, noted.
- **L5 — Restaurant A has an empty menu in DB** (0 products/categories). Guest page renders empty; product-data issue, not code.
- **L6 — Test counter rows remain** (`sufra_daily_counters` not API-deletable). Negligible operational residue.
- **L7 — Local dev flakiness** (ECONNREFUSED episodes, `.next` manifest ENOENTs when build+dev collide, IPv6 route instability toward Supabase — reason for `ipv4first` discipline). Local-only.

## Fixed/Verified Controls

Owner/worker session gates (10-endpoint 401 battery incl. `/api/workers`, page redirects 307→login, worker dashboard static-200 documented in H5); genuine cross-owner PATCH → 403 + row untouched + owner-own → 200; PUT menu IDOR → 403 + byte-identical menu after (no partial writes); server pricing battery (25 hostile cases: price injection, qty 0/-1/frac/string/null/missing/51, 61 lines, qty 550, dupes, nonexistent/unavailable/foreign products, bad/foreign tables, empty/missing/malformed bodies — all 400/404/409 correct); login 429; scan 401/413; guest scoping 200/valid, 404 bad-slug/bad-token/foreign-token; malformed IDs 404/405 with no stack leakage; dashboard today-scope + localized hours (code-verified); CSPRNG tokens everywhere (`getRandomValues`/`randomUUID`/`randomBytes`); zero `dangerouslySetInnerHTML`; zero legacy non-http image URLs; cashier-vs-manager matrix unit-covered.

## Attack Results

Phase-by-phase: P2 owner-IDOR holds (PUT/PATCH/DELETE-scoping verified; one false alarm — C was same-owner by fixture design — redone genuinely vs owner-D → 403). P3 worker auth: cookie/Bearer validation sound in code + unit tests; live session tests blocked on C1 (server returns safe 401/503, no bypass found; forged-localStorage yields demo UI only). P4 orders: clean except H1 (fixed). P7: verified-stamp for workers in code; owner-forgery now 400 (H3 fix). P8: validation rejects + no partial writes (menu re-read identical). P9: invite concurrency untestable live until C1 (claim logic is race-safe by construction: conditional UPDATE + maybeSingle; double-accept test queued post-fix). P10: gates + 413 verified; NO_KEY fail-fast code-verified (key present, not destructively tested). P12: clean. P13: public flow intact and scoped. P15: no leaks observed (JSON errors only).

## Concurrency Results

100× same `client_ref` → 100×200, **1 order, 1 item** (exact idempotency). 100× distinct refs → 100×200, **100 unique ticket numbers** (trigger-stomped 1-based range 9–108; RPC counters advanced wastefully alongside). Zero 500s. Contiguity not contractually guaranteed (two allocators currently race by design accident — resolved by C3 fix).

## Rate-Limit Results

Login/order/scan/worker-accept/invite all limited and header-correct (`Retry-After` on login/scan paths; `429` bodies JSON). Bypass analysis in M1.

## Public Customer Flow

Guest menu renders (200, correct items); bad slug / bad token / cross-restaurant token → 404 page; ordering works end-to-end for valid table+products; unavailable → 409; unknown → 404. No auth wall on customers (by design, preserved).

## Worker Security / Owner Security / RLS Verification

See H5 + P3 notes (worker), P2 + 401 battery (owner). RLS: migration §7 applied per successful run + behavioral probes (anon-equivalent gets nothing; service role unaffected); direct policy-table listing unavailable without DB console access — owner should eyeball `pg_policies` once. No `using(true)` policies in migration source (safeguard drops present).

## Test Coverage Gaps

124 unit tests are genuine (schemas, guards, matrix, token parsing) but **no route-level regression tests exist**. Recommended additions (exact): (1) POST orders with foreign productId → 404 (H1 locked); (2) PATCH with non-UUID `acceptedBy` → 400 and worker-forged attribution ignored (H3); (3) accept double-claim → exactly one worker + 409 (P9, post-C1); (4) PUT menu with foreign category id → 403 + zero writes (P8); (5) rate-limit 429 then recovery. Do not add trivial tests beyond these.

## Arena Results

N/A — no Arena harness in the repository (glob `**/*arena*` empty).

## Recommended Next Actions

1. **Run §9 SQL** (workers FK/role/default + invites role) — unblocks C1/H2 and all worker-flow verification:
```sql
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_id_fkey;
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.workers ADD CONSTRAINT workers_role_check CHECK (role IN ('Cashier','Manager','cashier','manager'));
ALTER TABLE public.workers ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_role_check;
ALTER TABLE public.worker_invites ADD CONSTRAINT worker_invites_role_check CHECK (role IN ('Cashier','Manager','cashier','manager'));
```
2. **Paste trigger definitions**, then run the drops (unblocks C2/C3):
```sql
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN ('public.orders'::regclass, 'public.order_items'::regclass) AND NOT tgisinternal;
```
3. Rebuild + restart all servers from the current tree (accept ordering, H3 hardening, priceLines scoping are code-newer than the running build), re-run worker invite→accept→PATCH→dashboard verification, then the 5 regression tests.
4. Decide H5 (server gate vs client bounce), unset `SUFRA_AUTH_DISABLED`, integrate Google OAuth, load RLS eyeball-check — then ship.

**Blockers:** C1, C2, C3 (all live-schema, all with SQL above/in-queue) · H5 (worker dashboard gate) · H3/H4 pending rebuild+verify · dev walls open + OAuth deferred (accepted, procedural).

---

FINAL VERDICT: NOT READY

Blockers: (C1) worker/invite creation impossible live � run �9 SQL; (C2) price trigger breaks all custom orders � drop on definition; (C3) ticket trigger overrides atomic numbering � drop on definition; (H5) worker dashboard has no server gate; (H3/H4) code fixes shipped, pending rebuild + live re-verify; dev login walls intentionally open + Google OAuth deferred (accepted, procedural).
