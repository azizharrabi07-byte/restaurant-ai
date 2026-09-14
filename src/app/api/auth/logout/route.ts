import { NextResponse } from "next/server";
import {
  clearOwnerSessionCookie,
  getOwnerSessionCookie,
  resolveOwnerSession,
  revokeOwnerSession,
} from "@/lib/owner-auth";
import {
  clearWorkerSessionCookie,
  getSessionToken,
  revokeWorkerSession,
} from "@/lib/worker-auth";

/**
 * End the session for real, not just in the browser: the worker token is
 * cleared in the DB and Supabase is told to invalidate the owner session
 * (which kills its refresh token) BEFORE the cookies are cleared, so a copied
 * cookie or a leaked refresh token cannot be replayed after logout.
 */
export async function POST(req: Request) {
  const workerToken = getSessionToken(req);
  const ownerCookie = getOwnerSessionCookie(req);
  // Resolve first so an expired access token is still revocable: the refresh
  // grant mints a usable token for the logout call.
  const ownerSession = await resolveOwnerSession(ownerCookie);

  await Promise.all([
    revokeWorkerSession(workerToken),
    revokeOwnerSession(ownerSession?.accessToken ?? null),
  ]);

  const res = NextResponse.json({ cloud: true });
  clearWorkerSessionCookie(res);
  return clearOwnerSessionCookie(res);
}
