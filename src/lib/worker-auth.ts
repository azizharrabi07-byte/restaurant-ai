import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase-admin";
import { authBypassEnabled } from "./owner-auth";

/**
 * Worker session authentication.
 *
 * A worker is NOT a Supabase Auth user. Each worker row carries a random
 * secret `session_token` (set by `POST /api/auth/worker/accept`), and the
 * token is delivered to the browser as an HttpOnly cookie
 * (`sufra_worker_session`) and/or accepted via `Authorization: Bearer`.
 * Every lookup re-validates the token against the DB server-side.
 *
 * Pre-migration the `session_token` column does not exist; the query fails
 * gracefully and returns `null`, so unauthenticated custom lines remain
 * blocked until the migration is applied.
 */

export const WORKER_SESSION_COOKIE = "sufra_worker_session";
export const WORKER_SESSION_MAX_AGE = 604_800; // 7 days
export const WORKER_INVITE_TOKEN_MIN = 8;
export const WORKER_INVITE_TOKEN_MAX = 128;

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

export async function lookupWorkerByToken(
  token: string | null,
): Promise<WorkerSession | null> {
  if (!token || !supabaseAdmin) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("id, restaurant_id, role, full_name")
      .eq("session_token", token)
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

export async function getWorkerSession(
  req: Request,
): Promise<WorkerSession | null> {
  if (authBypassEnabled()) return getDevWorkerSession();
  return lookupWorkerByToken(getSessionToken(req));
}

/** Server-component guard: reads the HttpOnly worker cookie and validates it. */
export async function requireWorkerSessionForRsc(): Promise<WorkerSession | null> {
  if (authBypassEnabled()) return getDevWorkerSession();
  const store = await cookies();
  const token = store.get(WORKER_SESSION_COOKIE)?.value ?? null;
  return lookupWorkerByToken(token);
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
    workerId: "00000000-0000-4000-8000-000000000000",
    restaurantId,
    role: "Manager",
    fullName: "Dev Worker",
  };
}

export function serializeWorkerSessionCookie(token: string): string {
  return `${WORKER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WORKER_SESSION_MAX_AGE}`;
}

export function clearWorkerSessionCookie(): string {
  return `${WORKER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}