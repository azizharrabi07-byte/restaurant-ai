/**
 * REGRESSION GUARD — the shared-client session contamination.
 *
 * `supabaseAdmin` (src/lib/supabase-admin.ts) is a module-level SINGLETON built
 * with the service-role key. In supabase-js, `signInWithPassword` and
 * `verifyOtp` store the resulting session ON THE CLIENT THEY ARE CALLED ON, and
 * that client then sends the session's access token as the `Authorization`
 * header on every subsequent PostgREST request from it. So a route that reached
 * for the shared client did not merely sign one request in: it re-authenticated
 * the entire long-lived server process as that user, and every later database
 * request — including other users' — ran as `authenticated` under RLS instead of
 * as the service role. Proven on a real local Supabase stack, same process:
 *
 *   before any sign-in:  GET /api/menu -> 200, PostgREST logged 200
 *   after one login:     GET /api/menu -> 503, PostgREST logged
 *                        403 {"code":"42501",
 *                             "hint":"... GRANT SELECT ON public.restaurants
 *                                     TO authenticated;"}
 *
 * On the developer's live database that was MASKED: Supabase's default
 * privileges give `authenticated` broad table access and the owner policies
 * happened to allow the owner's own rows, so nothing failed visibly.
 *
 * The fix routes those four calls through `createSessionAuthClient()` (a
 * throwaway client). This file is what stops the bug from coming back, and its
 * assertions are PER CLIENT: "the route signed in" is not enough — the fake used
 * to hand the same object back for both names, which is exactly why the bug was
 * invisible to every suite. What must hold is that the sign-in landed on the
 * session client AND did not land on `supabaseAdmin`.
 *
 * `auth.admin.*` (createUser / updateUserById / listUsers) is deliberately kept
 * on the shared client: it does not install a session, so it is asserted on
 * `supabaseFake` here as the correct home for it.
 *
 * Every test drives the real handler and asserts on recorded calls, so a route
 * that reverts to `supabaseAdmin.auth.signInWithPassword` fails on the negative
 * assertion below — the one the whole file exists for.
 */
// Imported BEFORE the routes on purpose: the lazy `vi.mock` factory below
// closes over `supabaseAdminMock`, so this module must already be evaluated by
// the time a route (and, through it, `@/lib/supabase-admin`) is first imported.
import {
  apiRequest,
  resetApiFakes,
  sessionAuthFake,
  supabaseAdminMock,
  supabaseFake,
  type FakeSignInResult,
} from "./supabase-fake";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => supabaseAdminMock());

import { POST as postLogin } from "../auth/login/route";
import { POST as postReset } from "../auth/reset/route";
import { POST as postSignup } from "../auth/signup/route";

const OWNER = { id: "6f1c0f2e-0000-4000-8000-000000000001", email: "owner@example.com" };
const SESSION = { access_token: "access-token-1", refresh_token: "refresh-token-1" };
const SIGNED_IN: FakeSignInResult = { data: { user: OWNER, session: SESSION }, error: null };

const LOGIN_PASSWORD = "correct-horse";
const SIGNUP_PASSWORD = "signup-correct-horse";
const NEW_PASSWORD = "new-correct-horse";

/**
 * `clientIp()` reads `x-forwarded-for` and the limiter buckets on
 * `<namespace>:<ip>`, so every test takes its own IP: two tests sharing one
 * would let the first exhaust the second's quota and make it assert a 429.
 */
beforeEach(() => {
  resetApiFakes();
});

describe("session-creating auth calls never touch the shared supabaseAdmin client", () => {
  it("hands the routes two distinct clients, so a call can be attributed to one of them", () => {
    const injected = supabaseAdminMock();

    // The enabling invariant. While both names resolved to the same fake, this
    // suite's positive and negative assertions could not disagree, which is why
    // the contamination bug survived the whole existing test suite.
    expect(injected.supabaseAdmin).not.toBe(injected.createSessionAuthClient());
    expect(injected.supabaseAdmin).toBe(supabaseFake);
    expect(injected.createSessionAuthClient()).toBe(sessionAuthFake);
  });

  it("login: signInWithPassword runs on the throwaway session client, never on the shared supabaseAdmin client", async () => {
    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(SIGNED_IN);

    const res = await postLogin(
      apiRequest("/api/auth/login", {
        body: { email: OWNER.email, password: LOGIN_PASSWORD },
        ip: "10.9.0.1",
      }),
    );

    // The request really took the sign-in path, so the negative assertion below
    // cannot be vacuous.
    expect(res.status).toBe(200);
    expect(sessionAuthFake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: OWNER.email,
      password: LOGIN_PASSWORD,
    });
    // THE assertion. Reverting the route to the shared client moves this call
    // onto `supabaseFake` and re-authenticates the whole process as this user.
    expect(supabaseFake.auth.signInWithPassword).not.toHaveBeenCalled();
    // …and the throwaway client stays an auth client, not a second DB client:
    // DB work on it would be invisible to every other suite's call assertions.
    expect(sessionAuthFake.calls).toHaveLength(0);
  });

  it("signup: signInWithPassword runs on the throwaway session client, never on the shared supabaseAdmin client", async () => {
    // `admin.createUser` and the ownership lookup are genuinely shared-client
    // work; only the auto sign-in at the end of the route establishes a session.
    supabaseFake.auth.admin.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    supabaseFake.seed("restaurants", []);
    supabaseFake.auth.admin.createUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(SIGNED_IN);

    const res = await postSignup(
      apiRequest("/api/auth/signup", {
        body: { email: OWNER.email, password: SIGNUP_PASSWORD, name: "Ahmed" },
        ip: "10.9.0.2",
      }),
    );

    expect(res.status).toBe(200);
    expect(supabaseFake.auth.admin.createUser).toHaveBeenCalledTimes(1);
    // The sign-in part, again per client.
    expect(sessionAuthFake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: OWNER.email,
      password: SIGNUP_PASSWORD,
    });
    expect(supabaseFake.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(sessionAuthFake.auth.admin.createUser).not.toHaveBeenCalled();
    expect(sessionAuthFake.calls).toHaveLength(0);
  });

  it("reset: verifyOtp and signInWithPassword run on the throwaway session client, never on the shared supabaseAdmin client", async () => {
    // Both session-creating calls live on this route: `verifyOtp` consumes the
    // recovery token, then the route signs the owner in with the new password.
    sessionAuthFake.auth.verifyOtp.mockResolvedValue({
      data: { user: OWNER, session: null },
      error: null,
    });
    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(SIGNED_IN);

    const res = await postReset(
      apiRequest("/api/auth/reset", {
        body: {
          token_hash: "recovery-token-hash-1",
          type: "recovery",
          password: NEW_PASSWORD,
        },
        ip: "10.9.0.3",
      }),
    );

    expect(res.status).toBe(200);
    expect(sessionAuthFake.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "recovery-token-hash-1",
      type: "recovery",
    });
    // THE assertion for `verifyOtp`, which the fix comment calls out by name.
    expect(supabaseFake.auth.verifyOtp).not.toHaveBeenCalled();
    expect(sessionAuthFake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: OWNER.email,
      password: NEW_PASSWORD,
    });
    expect(supabaseFake.auth.signInWithPassword).not.toHaveBeenCalled();
    // The password write is an `admin.*` call, so it correctly stays shared.
    expect(supabaseFake.auth.admin.updateUserById).toHaveBeenCalledWith(OWNER.id, {
      password: NEW_PASSWORD,
    });
    expect(sessionAuthFake.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(sessionAuthFake.calls).toHaveLength(0);
  });
});
