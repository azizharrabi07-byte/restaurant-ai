import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import { authBypassEnabled } from "./owner-auth";

/**
 * Worker session authentication.
 *
 * The session token is opaque and lives in the DB (`workers.session_token`)
 * with a server-side deadline (`workers.session_expires_at`): a token captured
 * from a shared tablet, a backup or a log stops working once the deadline
 * passes, and logout clears both columns. `WORKER_SESSION_MAX_AGE` is the
 * cookie lifetime, i.e. the value written to `session_expires_at` on accept.
 */

export const WORKER_SESSION_COOKIE = "sufra_worker_session";
export const WORKER_SESSION_MAX_AGE = 604_800; // 7 days
export const WORKER_INVITE_TOKEN_MIN = 8;
export const WORKER_INVITE_TOKEN_MAX = 128;

/**
 * Identity the dev bypass resolves to. It is deliberately not a real row, so
 * callers that stamp attribution into a table (e.g. `orders.accepted_by`) must
 * skip the write when they see it.
 */
export const DEV_WORKER_SENTINEL_ID = "00000000-0000-4000-8000-000000000000";

export interface WorkerSession {
  workerId: string;
  restaurantId: string;
  role: string;
  fullName: string;
}

export function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function getSessionToken(req: Request): string | null {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== WORKER_SESSION_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Resolve a token to a session. A token is only valid while its server-side
 * deadline is in the future — a row with no deadline (or an expired one) is
 * rejected, so sessions always age out even if the cookie is replayed.
 */
export async function lookupWorkerByToken(
  token: string | null,
): Promise<WorkerSession | null> {
  if (!token || !supabaseAdmin) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("id, restaurant_id, role, full_name")
      .eq("session_token", token)
      .gt("session_expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return {
      workerId: data.id as string,
      restaurantId: data.restaurant_id as string,
      role: (data.role as string) ?? "Cashier",
      fullName: (data.full_name as string) ?? "Staff",
    };
  } catch {
    return null;
  }
}

/**
 * Revoke a worker session server-side: the presented token can no longer be
 * redeemed, independently of whatever the client does with its cookie. Best
 * effort — a failed write must not stop logout from clearing the cookie.
 */
export async function revokeWorkerSession(token: string | null): Promise<void> {
  if (!token || !supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ session_token: null, session_expires_at: null })
      .eq("session_token", token);
    if (error) {
      console.warn("[sufra] worker session revoke failed:", error.message);
    }
  } catch (err) {
    console.warn("[sufra] worker session revoke failed:", err);
  }
}

export async function getWorkerSession(
  req: Request,
): Promise<WorkerSession | null> {
  if (authBypassEnabled()) return getDevWorkerSession();
  return lookupWorkerByToken(getSessionToken(req));
}

/**
 * Dev session: a Manager of the first restaurant. Lets local testing skip
 * the invite flow while keeping restaurant scoping identical to production.
 */
async function getDevWorkerSession(): Promise<WorkerSession | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  const restaurantId = data?.[0]?.id as string | undefined;
  if (!restaurantId) return null;
  return {
    workerId: DEV_WORKER_SENTINEL_ID,
    restaurantId,
    role: "Manager",
    fullName: "Dev Worker",
  };
}

/**
 * The one cookie option set for the worker session — `accept/route.ts` (mint)
 * and `clearWorkerSessionCookie` (revoke) both go through this, so the flags
 * cannot drift apart.
 */
export function workerSessionCookieOptions(maxAge: number): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function clearWorkerSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(WORKER_SESSION_COOKIE, "", workerSessionCookieOptions(0));
  return res;
}
