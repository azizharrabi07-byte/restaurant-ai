import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase clients. NEVER import this from client components.
 *
 * There are two, and the distinction is load-bearing:
 *
 *  1. `supabaseAdmin` — the ONE long-lived client for all database work. It
 *     carries the service-role key, so it bypasses RLS and acts as the app's
 *     own database identity.
 *
 *  2. `createSessionAuthClient()` — a THROWAWAY client for the few auth calls
 *     that ESTABLISH A SESSION (`signInWithPassword`, `verifyOtp`). Those calls
 *     store the resulting session *on the client object*, and supabase-js then
 *     sends that session's access token as the `Authorization` header on every
 *     subsequent PostgREST request made by that same client.
 *
 * WHY THAT MATTERS: `supabaseAdmin` is a module-level singleton, so one sign-in
 * through it silently re-authenticates THE WHOLE SERVER PROCESS as that user.
 * Every later database call — including other users' requests — then runs as
 * `authenticated` under RLS instead of as the service role. Proven on a real
 * local Supabase stack, same process, same request:
 *
 *   before any sign-in:  GET /api/menu -> 200, PostgREST logged 200
 *   after one login:     GET /api/menu -> 503, PostgREST logged
 *                        403 {"code":"42501",
 *                             "hint":"... GRANT SELECT ON public.restaurants
 *                                     TO authenticated;"}
 *
 * The documented `auth.getUser(jwt)` helper does NOT do this (it passes the
 * token as a per-request override), which is why `resolveOwnerSession` can keep
 * using `supabaseAdmin`. `admin.*` calls do not either. Only session-creating
 * calls do — so those, and only those, go through the throwaway client.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/**
 * The service-role client for all database access.
 *
 * NEVER call `signInWithPassword`, `signUp`, `verifyOtp`, `setSession`,
 * `refreshSession` or `exchangeCodeForSession` on this object — use
 * `createSessionAuthClient()` for those. Doing so re-authenticates the whole
 * process as one user, for every later request, until it restarts.
 */
export const supabaseAdmin: SupabaseClient | null =
  url && key ? createClient(url, key, CLIENT_OPTIONS) : null;

/**
 * A fresh, single-use client for auth calls that create a session. The client
 * is discarded by the caller as soon as the session (or the tokens it returns)
 * has been read, so the session can never leak onto `supabaseAdmin`.
 *
 * Returns null when the project is not configured, exactly like
 * `supabaseAdmin`, so callers keep their existing no-backend branches.
 */
export function createSessionAuthClient(): SupabaseClient | null {
  return url && key ? createClient(url, key, CLIENT_OPTIONS) : null;
}

export function hasBackend(): boolean {
  return Boolean(supabaseAdmin);
}
