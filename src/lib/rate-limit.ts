/**
 * Minimal in-memory sliding-window rate limiter for route handlers.
 *
 * Keyed by client IP (first X-Forwarded-For entry when present, else
 * X-Real-IP, else loopback). Process-local state: sufficient for a single
 * server, cheap, and restart-safe (limits reset). Disable entirely in
 * dev/tests with SUFRA_RATE_LIMIT_DISABLED=1 (or "true").
 *
 * NOTE: X-Forwarded-For is trusted as-is. Behind an edge (Vercel, Nginx,
 * Supabase proxy) the edge owns/normalizes those headers, so a directly
 * exposed instance must NOT accept client-supplied X-Forwarded-For.
 */

const buckets = new Map<string, number[]>();

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

export function rateLimitDisabled(): boolean {
  const v = process.env.SUFRA_RATE_LIMIT_DISABLED;
  return v === "1" || v === "true";
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
  if (buckets.size > 4096) pruneBuckets(cutoff);
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