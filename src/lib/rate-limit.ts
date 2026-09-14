/**
 * Minimal in-memory sliding-window rate limiter for route handlers.
 *
 * Keyed by client IP: the first X-Forwarded-For entry, else X-Real-IP, else a
 * single shared loopback bucket.
 *
 * TRUST ASSUMPTION — read before deploying. `X-Forwarded-For` is taken
 * verbatim, which is only meaningful when a trusted edge (Vercel, nginx, the
 * Supabase proxy) *overwrites* it on the way in. An instance exposed directly
 * to clients lets the caller choose its own bucket key, so the limiter
 * degrades to a per-key throttle that a determined client can sidestep — and,
 * since the bounds below are hard, a client sending a unique XFF per request
 * can also evict other callers' counters. It can NOT be turned into unbounded
 * memory or an O(n)-per-request scan: `buckets` is capped at MAX_KEYS and
 * evicts the least-recently-active key on insert. Behind a proxy that strips
 * XFF every caller shares the loopback bucket; that is deliberate — a shared
 * bucket is a real throttle, whereas trusting a client-supplied hop would let
 * the client pick a fresh bucket per request.
 *
 * Process-local state: sufficient for a single server, cheap, and
 * restart-safe (limits reset). Disable entirely in dev/tests with
 * SUFRA_RATE_LIMIT_DISABLED=1 (or "true"); the override is ignored in
 * production builds (see `rateLimitDisabled`).
 */

const buckets = new Map<string, number[]>();

/** Hard ceiling on tracked bucket keys (see the trust note above). */
const MAX_KEYS = 4096;
/** Sweep down to this many keys when the ceiling is crossed, so the eviction
 *  cost is amortised over many requests instead of paid on every one. */
const LOW_WATER_KEYS = 3072;

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "127.0.0.1";
}

let disabledWarned = false;

/**
 * Dev-only kill switch. Returns true ONLY when the server runs a
 * non-production build AND SUFRA_RATE_LIMIT_DISABLED=1 (or "true"), mirroring
 * `authBypassEnabled`. A stray value in a production environment is ignored,
 * so throttling can never be silently dropped from a deployment.
 */
export function rateLimitDisabled(): boolean {
  const v = process.env.SUFRA_RATE_LIMIT_DISABLED;
  const on =
    process.env.NODE_ENV !== "production" && (v === "1" || v === "true");
  if (on && !disabledWarned) {
    disabledWarned = true;
    console.warn(
      "[sufra] SUFRA_RATE_LIMIT_DISABLED is set — rate limits are OFF. Dev only; unset it to restore throttling.",
    );
  }
  return on;
}

/**
 * Response headers for a blocked request. Every 429 should carry these so
 * callers can back off uniformly instead of parsing `message` prose.
 */
export function retryAfterHeaders(
  rate: Extract<RateLimitResult, { ok: false }>,
): Record<string, string> {
  return { "Retry-After": String(rate.retryAfterSeconds) };
}

export function checkRateLimit(
  req: Request,
  namespace: string,
  opts: RateLimitOptions,
): RateLimitResult {
  if (rateLimitDisabled()) return { ok: true };

  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const key = `${namespace}:${clientIp(req)}`;

  let arr = buckets.get(key);
  if (!arr) {
    arr = [];
    buckets.set(key, arr);
  }
  while (arr.length > 0) {
    const head = arr[0];
    if (head !== undefined && head > cutoff) break;
    arr.shift();
  }

  if (arr.length >= opts.limit) {
    const oldest = arr[0];
    const oldestMs = oldest !== undefined ? oldest : now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs - cutoff) / 1000));
    return { ok: false, retryAfterSeconds };
  }

  arr.push(now);
  if (buckets.size > MAX_KEYS) {
    pruneBuckets(cutoff);
    // Whatever prune could not reclaim is live traffic: drop the
    // least-recently-active buckets regardless of their cutoff, so the map
    // stays bounded no matter what key the caller supplies.
    while (buckets.size > MAX_KEYS && buckets.size > LOW_WATER_KEYS) {
      evictLeastRecentlyActive();
    }
  }
  return { ok: true };
}

function pruneBuckets(cutoff: number): void {
  for (const [key, arr] of buckets) {
    if (arr.length === 0) buckets.delete(key);
    else {
      const last = arr[arr.length - 1];
      if (last !== undefined && last <= cutoff) buckets.delete(key);
    }
  }
}

/** Delete the bucket whose most recent hit is oldest (empty buckets first). */
function evictLeastRecentlyActive(): void {
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, arr] of buckets) {
    const last = arr.length > 0 ? arr[arr.length - 1] : Number.NEGATIVE_INFINITY;
    if (last !== undefined && last < oldestAt) {
      oldestAt = last;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) buckets.delete(oldestKey);
}
