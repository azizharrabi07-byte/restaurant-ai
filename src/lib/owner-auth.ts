import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Owner authentication.
 *
 * The app has no browser anon key configured, so all sign-in/refresh calls go
 * through the service role: sign-in exchanges a password for a session, the
 * resulting access/refresh tokens are stored in an httpOnly cookie, and every
 * protected route verifies the access token with `auth.getUser`. Expired
 * access tokens are lazily rotated via the gotrue refresh grant (the service
 * key acts as the API key). The RSC layout guard can only verify (not rotate)
 * cookies, so idle sessions past the access-token TTL require a re-login.
 */

export const OWNER_SESSION_COOKIE = "sufra_owner_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

let bypassWarned = false;

/**
 * Dev-only open-door switch. Returns true ONLY when the server runs a
 * non-production build AND SUFRA_AUTH_DISABLED=1 is set. Production builds
 * always return false, so this can never open walls on a deployment even if
 * the variable leaks into the environment.
 */
export function authBypassEnabled(): boolean {
  const on =
    process.env.NODE_ENV !== "production" &&
    process.env.SUFRA_AUTH_DISABLED === "1";
  if (on && !bypassWarned) {
    bypassWarned = true;
    console.warn(
      "[sufra] SUFRA_AUTH_DISABLED=1 — all login walls are OPEN. Dev only; restore auth by unsetting the variable.",
    );
  }
  return on;
}

/**
 * Dev session: whoever owns the first restaurant. Lets local testing skip
 * sign-in while keeping every ownership scope exactly as in production.
 */
async function getDevOwnerSession(): Promise<OwnerSession | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("restaurants")
    .select("owner_id")
    .order("created_at", { ascending: true })
    .limit(1);
  const ownerId = data?.[0]?.owner_id as string | undefined;
  if (!ownerId) return null;
  return {
    user: { userId: ownerId, email: "dev@sufra.local" },
    accessToken: "dev-bypass",
    refreshToken: "dev-bypass",
    rotated: null,
  };
}

export interface OwnerAuthUser {
  userId: string;
  email: string;
}

export interface OwnerSession {
  user: OwnerAuthUser;
  accessToken: string;
  refreshToken: string;
  /** Set when the access token was expired and rotated. */
  rotated: { accessToken: string; refreshToken: string } | null;
}

interface StoredSession {
  a: string;
  r: string;
}

export function serializeOwnerSession(accessToken: string, refreshToken: string): string {
  const payload: StoredSession = { a: accessToken, r: refreshToken };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseOwnerSession(
  raw: string | null | undefined,
): { accessToken: string; refreshToken: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<StoredSession>;
    if (typeof parsed.a === "string" && typeof parsed.r === "string" && parsed.a && parsed.r) {
      return { accessToken: parsed.a, refreshToken: parsed.r };
    }
    return null;
  } catch {
    return null;
  }
}

export function getOwnerSessionCookie(
  req?: Request,
): string | null {
  if (req) {
    const header = req.headers.get("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === OWNER_SESSION_COOKIE) {
        return decodeURIComponent(rest.join("="));
      }
    }
    return null;
  }
  return null;
}

export async function getOwnerSessionCookieValue(): Promise<string | null> {
  const store = await cookies();
  return store.get(OWNER_SESSION_COOKIE)?.value ?? null;
}

function refreshGrantUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${url}/auth/v1/token?grant_type=refresh_token`;
}

/** Exchange a refresh token for a fresh pair using the service key. */
async function refreshOwnerTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!key || !url || !supabaseAdmin) return null;
  try {
    const res = await fetch(refreshGrantUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!j.access_token || !j.refresh_token) return null;
    return { accessToken: j.access_token, refreshToken: j.refresh_token };
  } catch {
    return null;
  }
}

/** Resolve a stored cookie value into a verified session, rotating if needed. */
export async function resolveOwnerSession(
  raw: string | null | undefined,
): Promise<OwnerSession | null> {
  const stored = parseOwnerSession(raw);
  if (!stored || !supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(stored.accessToken);
  if (!error && data?.user) {
    return {
      user: { userId: data.user.id, email: data.user.email ?? "" },
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      rotated: null,
    };
  }

  // Access token expired/invalid — try refresh once.
  const rotated = await refreshOwnerTokens(stored.refreshToken);
  if (!rotated) return null;
  const fresh = await supabaseAdmin.auth.getUser(rotated.accessToken);
  if (fresh.error || !fresh?.data?.user) return null;
  return {
    user: { userId: fresh.data.user.id, email: fresh.data.user.email ?? "" },
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    rotated,
  };
}

/** Server-component friendly session check (no cookie writes possible). */
export async function getOwnerSessionForRsc(): Promise<OwnerAuthUser | null> {
  if (authBypassEnabled()) {
    const dev = await getDevOwnerSession();
    if (dev) return dev.user;
  }
  const raw = await getOwnerSessionCookieValue();
  if (!raw) return null;
  const session = await resolveOwnerSession(raw);
  return session ? session.user : null;
}

/** Route-handler friendly session check. */
export async function getOwnerSessionForRequest(
  req: Request,
): Promise<OwnerSession | null> {
  if (authBypassEnabled()) {
    const dev = await getDevOwnerSession();
    if (dev) return dev;
  }
  const raw = getOwnerSessionCookie(req);
  if (!raw) return null;
  return resolveOwnerSession(raw);
}

/** Attach a session cookie to a response. */
export function setOwnerSessionCookie(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
): NextResponse {
  res.cookies.set(OWNER_SESSION_COOKIE, serializeOwnerSession(accessToken, refreshToken), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

/** Rotate the cookie on a response if the session was refreshed. */
export function attachOwnerSessionRotation(
  res: NextResponse,
  session: OwnerSession,
): NextResponse {
  if (session.rotated) {
    return setOwnerSessionCookie(res, session.rotated.accessToken, session.rotated.refreshToken);
  }
  return res;
}

export function clearOwnerSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}