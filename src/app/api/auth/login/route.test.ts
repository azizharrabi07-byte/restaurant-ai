/**
 * Route-level regression tests for `POST /api/auth/login`.
 *
 * The handler rate-limits by client IP *before* it looks at credentials
 * (`checkRateLimit(req, "login", { limit: 10, windowMs: 600_000 })`), so these
 * tests drive the real handler and assert the observable HTTP contract —
 * status, JSON body and headers — plus the Supabase call log, because "the
 * blocked request never reached Supabase" is only visible as a call count.
 *
 * The sign-in call log lives on `sessionAuthFake` — the throwaway client that
 * `createSessionAuthClient()` hands back — NOT on `supabaseFake`: a sign-in
 * recorded against the shared `supabaseAdmin` singleton is exactly the
 * process-wide session-contamination bug (see src/lib/supabase-admin.ts), and
 * ../__tests__/session-client-isolation.test.ts asserts per client which one
 * the call landed on.
 *
 * The limiter keeps PROCESS-GLOBAL buckets keyed by `login:<ip>`, so EVERY
 * test uses its own IP: two tests sharing an IP would let one exhaust the
 * other's quota and silently pass.
 */
// Imported BEFORE the route on purpose: the lazy `vi.mock` factory below closes
// over `supabaseAdminMock`, so this module must already be evaluated by the
// time the route (and, through it, `@/lib/supabase-admin`) is first imported.
import {
  apiRequest,
  resetApiFakes,
  sessionAuthFake,
  supabaseAdminMock,
  type FakeSignInResult,
} from "../../__tests__/supabase-fake";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => supabaseAdminMock());

// `@/lib/owner-auth` is deliberately NOT mocked: the route only uses its pure
// `setOwnerSessionCookie` helper, and importing the real module is what makes
// `OWNER_SESSION_COOKIE` (and the cookie's wire format) authoritative here.
import { OWNER_SESSION_COOKIE } from "@/lib/owner-auth";
import { POST } from "./route";

/** Quota and window the route passes to `checkRateLimit` (route.ts:17). */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 600_000;

const GOOD_BODY = { email: "owner@example.com", password: "correct-horse" };

const INVALID_CREDENTIALS: FakeSignInResult = {
  data: { user: null, session: null },
  error: { message: "Invalid login credentials" },
};

const USER = { id: "6f1c0f2e-0000-4000-8000-000000000001", email: "owner@example.com" };
const SESSION = { access_token: "access-token-1", refresh_token: "refresh-token-1" };

const SUCCESS: FakeSignInResult = { data: { user: USER, session: SESSION }, error: null };

/** The subset of the route's JSON contract these tests assert on. */
interface LoginBody {
  cloud?: boolean;
  error?: string;
  message?: string;
  user?: { id: string; email: string };
}

/** `POST /api/auth/login` from `ip`, with `body` JSON-encoded. */
function postLogin(ip: string, body: unknown = GOOD_BODY): Promise<Response> {
  return POST(apiRequest("/api/auth/login", { body, ip }));
}

/** Parsed JSON body, typed — so no cast is needed at the call sites. */
async function readBody(res: Response): Promise<LoginBody> {
  const body: LoginBody = await res.json();
  return body;
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    // Delete, never set: with NODE_ENV=test vitest runs non-production, so a
    // stray "1"/"true" here WOULD switch the limiter off and make every 429
    // assertion below vacuous. Deleting proves the limit is live.
    delete process.env.SUFRA_RATE_LIMIT_DISABLED;
    resetApiFakes();
    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
  });

  it("answers 401 INVALID_CREDENTIALS under the quota, and sets no session cookie", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await postLogin("10.7.0.1", {
        email: "owner@example.com",
        password: "wrong-password",
      });

      expect(res.status).toBe(401);
      const body = await readBody(res);
      expect(body.cloud).toBe(false);
      expect(body.error).toBe("INVALID_CREDENTIALS");
      expect(body.message).toBe("Incorrect email or password.");
      expect(body.user).toBeUndefined();
      expect(res.headers.get("set-cookie")).toBeNull();
    }

    // The call log, not the status: under the quota the credential check really
    // runs — the contrast with the short-circuit assertion below.
    expect(sessionAuthFake.auth.signInWithPassword.mock.calls.length).toBe(3);
  });

  it("blocks the request past the quota with 429 RATE_LIMITED and a Retry-After header", async () => {
    // A poisoned environment must not be able to make this test vacuous.
    expect(process.env.SUFRA_RATE_LIMIT_DISABLED).toBeUndefined();

    for (let i = 0; i < LOGIN_LIMIT; i++) {
      const allowed = await postLogin("10.7.0.2");
      expect(allowed.status).toBe(401);
      expect(allowed.headers.get("retry-after")).toBeNull();
    }

    const blocked = await postLogin("10.7.0.2");
    expect(blocked.status).toBe(429);

    const body = await readBody(blocked);
    expect(body.cloud).toBe(false);
    expect(body.error).toBe("RATE_LIMITED");

    const retryAfter = blocked.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);
    // Never longer than the window itself.
    expect(seconds).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    // The prose agrees with the header the client is told to obey.
    expect(body.message).toBe(`try again in ${seconds}s`);
  });

  it("short-circuits the blocked request before credential verification", async () => {
    expect(process.env.SUFRA_RATE_LIMIT_DISABLED).toBeUndefined();

    for (let i = 0; i < LOGIN_LIMIT; i++) {
      expect((await postLogin("10.7.0.3")).status).toBe(401);
    }
    const authCallsBeforeBlock = sessionAuthFake.auth.signInWithPassword.mock.calls.length;
    expect(authCallsBeforeBlock).toBe(LOGIN_LIMIT);

    const blocked = await postLogin("10.7.0.3");
    expect(blocked.status).toBe(429);

    // THE limiter-ordering assertion: the blocked request never reached
    // Supabase. If the limiter moved below the sign-in call this stays at
    // `authCallsBeforeBlock + 1` while the response is still a 429.
    expect(sessionAuthFake.auth.signInWithPassword.mock.calls.length).toBe(authCallsBeforeBlock);
    expect(sessionAuthFake.auth.signInWithPassword.mock.calls.length).toBe(LOGIN_LIMIT);
  });

  it("keys the bucket by IP, so a different client is not throttled", async () => {
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      expect((await postLogin("10.7.0.4")).status).toBe(401);
    }
    expect((await postLogin("10.7.0.4")).status).toBe(429);

    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(SUCCESS);
    const other = await postLogin("10.7.0.5");
    expect(other.status).toBe(200);
    expect((await readBody(other)).cloud).toBe(true);

    // …while the exhausted client stays blocked.
    expect((await postLogin("10.7.0.4")).status).toBe(429);
  });

  it("sets the owner session cookie and echoes the Supabase user on success", async () => {
    sessionAuthFake.auth.signInWithPassword.mockResolvedValue(SUCCESS);

    const res = await postLogin("10.7.0.6");
    expect(res.status).toBe(200);

    const body = await readBody(res);
    expect(body.cloud).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.user).toEqual({ id: USER.id, email: USER.email });
    expect(sessionAuthFake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: GOOD_BODY.email,
      password: GOOD_BODY.password,
    });

    const setCookie = res.headers.get("set-cookie");
    const match = setCookie
      ? new RegExp(`(?:^|;\\s*)${OWNER_SESSION_COOKIE}=([^;]*)`).exec(setCookie)
      : null;
    const raw = match?.[1] ?? null;
    expect(raw).not.toBeNull();
    // The cookie carries the very session pair Supabase returned (and in the
    // order `parseOwnerSession` reads back).
    expect(Buffer.from(raw ?? "", "base64url").toString("utf8")).toBe(
      JSON.stringify({ a: SESSION.access_token, r: SESSION.refresh_token }),
    );
    expect(setCookie?.toLowerCase()).toContain("httponly");
  });

  it("rejects a malformed body with 400 BAD_BODY without calling Supabase", async () => {
    const badEmail = await postLogin("10.7.0.7", {
      email: "not-an-email",
      password: "long-enough",
    });
    expect(badEmail.status).toBe(400);
    const badEmailBody = await readBody(badEmail);
    expect(badEmailBody.cloud).toBe(false);
    expect(badEmailBody.error).toBe("BAD_BODY");
    expect(badEmailBody.message).toBe("valid email required");

    const shortPassword = await postLogin("10.7.0.7", {
      email: "owner@example.com",
      password: "12345",
    });
    expect(shortPassword.status).toBe(400);
    const shortBody = await readBody(shortPassword);
    expect(shortBody.error).toBe("BAD_BODY");
    expect(shortBody.message).toBe("password must be at least 6 characters");

    // Unparseable JSON takes the route's other BAD_BODY branch.
    const notJson = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.7.0.7" },
      body: "{not json",
    });
    const unparseable = await POST(notJson);
    expect(unparseable.status).toBe(400);
    const unparseableBody = await readBody(unparseable);
    expect(unparseableBody.error).toBe("BAD_BODY");
    expect(unparseableBody.message).toBe("Malformed request.");

    // Validation runs before the credential check: no request reached Supabase.
    expect(sessionAuthFake.auth.signInWithPassword.mock.calls.length).toBe(0);
    expect(shortPassword.headers.get("set-cookie")).toBeNull();
  });
});
