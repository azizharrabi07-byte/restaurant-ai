import { describe, it, expect, beforeEach, vi } from "vitest";

// Imported BEFORE the mocked route module on purpose: `vi.mock` is hoisted to
// the top of the file, but its factory is evaluated lazily — when
// `@/lib/supabase-admin` is first imported, which happens while the route below
// is evaluated. `supabaseAdminMock` therefore has to be initialised already.
import {
  supabaseFake,
  supabaseAdminMock,
  apiRequest,
  type FakeCall,
  type FakeResponse,
} from "../../../__tests__/supabase-fake";
import { WORKER_SESSION_COOKIE } from "@/lib/worker-auth";
import { POST } from "./route";

vi.mock("@/lib/supabase-admin", () => supabaseAdminMock());

// ── POST /api/auth/worker/accept: one-time invite redemption ────────────────
//
// The ordering is the contract these tests pin down: validate the body, read the
// invite, reject used/expired/role-less invites, CREATE the worker, and only
// then claim the invite (`is_used=false → true`). A lost claim deletes the row
// it created and answers 409; a failed insert must never consume the invite.
// Every rejection below therefore asserts BOTH the response and the writes that
// must NOT exist.

const PATH = "/api/auth/worker/accept";
const TOKEN = "invite-token-alpha-0001";
const INVITE_ID = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";

/** The invite columns the route reads. `expires_at` may be null in the DB. */
type InviteRow = {
  id: string;
  restaurant_id: string;
  invite_token: string;
  role: string;
  is_used: boolean;
  expires_at: string | null;
};

/** The JSON shape the route answers with (error bodies carry `cloud: false`). */
type AcceptBody = {
  cloud?: boolean;
  error?: string;
  message?: string;
  worker?: { id?: string; name?: string; role?: string };
};

function seedInvite(over: Partial<InviteRow> = {}): InviteRow {
  return {
    id: INVITE_ID,
    restaurant_id: RESTAURANT_ID,
    invite_token: TOKEN,
    role: "Cashier",
    is_used: false,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

// The rate limiter keeps process-wide buckets, so every request gets its own
// client IP: no test can be throttled by another test's traffic.
let requestSeq = 0;
function nextIp(): string {
  requestSeq += 1;
  return `198.51.100.${requestSeq}`;
}

async function accept(body: unknown): Promise<{ res: Response; json: AcceptBody }> {
  const res: Response = await POST(apiRequest(PATH, { body, ip: nextIp() }));
  return { res, json: (await res.json()) as AcceptBody };
}

/** Echoes the inserted row back, as PostgREST does for `insert(...).select(...)`. */
function insertEcho(call: FakeCall): FakeResponse | undefined {
  const row = Array.isArray(call.payload) ? call.payload[0] : call.payload;
  if (typeof row !== "object" || row === null) return undefined;
  return { data: row };
}

/** The conditional claim wins: it returns the claimed invite row. */
function claimWins(call: FakeCall): FakeResponse | undefined {
  return call.filters.some((f) => f.column === "is_used") ? { data: { id: INVITE_ID } } : undefined;
}

/** The best-effort `used_by` audit write, if the route made one. */
function usedByWrite(): FakeCall | undefined {
  for (const call of supabaseFake.writesTo("worker_invites")) {
    const payload = call.payload;
    // The claim writes `is_used`; only the audit write carries `used_by`.
    if (typeof payload === "object" && payload !== null && "used_by" in payload) {
      return call;
    }
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFake.reset();
});

describe("POST /api/auth/worker/accept", () => {
  it("404s an unknown invite token without writing anything", async () => {
    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
    expect(json.cloud).toBe(false);
    // The lookup really happened — a bare 404 would be a different bug.
    expect(supabaseFake.callsTo("worker_invites", "select")).toHaveLength(1);
    expect(supabaseFake.wroteTo("workers")).toBe(false);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
  });

  it("404s an already-used invite and creates no worker", async () => {
    supabaseFake.seed("worker_invites", [seedInvite({ is_used: true })]);

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
    expect(json.cloud).toBe(false);
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
  });

  it("404s an expired invite and creates no worker", async () => {
    supabaseFake.seed("worker_invites", [
      seedInvite({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
    ]);

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
    expect(json.cloud).toBe(false);
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
  });

  it("404s an invite with expires_at null (no unlimited lifetime)", async () => {
    // A NULL deadline is not an eternal credential: the route must fail closed,
    // exactly as migration 1004 makes the column NOT NULL.
    supabaseFake.seed("worker_invites", [seedInvite({ expires_at: null })]);

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
    expect(json.cloud).toBe(false);
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
  });

  it("404s an invite whose stored role is not a worker role", async () => {
    supabaseFake.seed("worker_invites", [seedInvite({ role: "" })]);

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
  });

  it("does not burn the invite when the worker insert fails", async () => {
    // THE core fix: the worker row is created BEFORE the invite is claimed, so
    // an insert failure cannot consume a still-valid invite. A claim-first route
    // leaves an `is_used: true` write behind and this test fails.
    supabaseFake.seed("worker_invites", [seedInvite()]);
    supabaseFake.on("workers", "insert", {
      data: null,
      error: { message: "insert failed" },
    });

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(500);
    expect(json.error).toBe("CREATE_WORKER");
    expect(json.cloud).toBe(false);
    expect(supabaseFake.callsTo("workers", "insert")).toHaveLength(1);
    expect(supabaseFake.wroteTo("worker_invites")).toBe(false);
    expect(usedByWrite()).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("deletes the just-inserted worker and 409s when the conditional claim loses the race", async () => {
    supabaseFake.seed("worker_invites", [seedInvite()]);
    supabaseFake.on("workers", "insert", insertEcho);
    // The invite was claimed by a concurrent redeemer between the lookup and the
    // update, so the conditional update matches no row.
    supabaseFake.on("worker_invites", "update", (call: FakeCall) =>
      call.filters.some((f) => f.column === "is_used") ? { data: null, error: null } : undefined,
    );

    const { res, json } = await accept({ token: TOKEN, name: "Amine" });

    expect(res.status).toBe(409);
    expect(json.error).toBe("ALREADY_USED");
    expect(json.cloud).toBe(false);

    // Exactly one worker was created …
    expect(supabaseFake.callsTo("workers", "insert")).toHaveLength(1);
    const inserted = supabaseFake.insertedRows("workers")[0];
    expect(inserted?.id).toBeTypeOf("string");

    // … and the compensating cleanup removed exactly that row.
    const deletes = supabaseFake.callsTo("workers", "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.filters).toContainEqual({
      kind: "eq",
      column: "id",
      value: inserted?.id,
    });

    expect(usedByWrite()).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("accepts a valid unused invite and claims it conditionally", async () => {
    supabaseFake.seed("worker_invites", [seedInvite()]);
    supabaseFake.on("workers", "insert", insertEcho);
    supabaseFake.on("worker_invites", "update", claimWins);

    const { res, json } = await accept({ token: TOKEN, name: "  Amine  " });

    expect(res.status).toBe(200);
    expect(json.cloud).toBe(true);
    expect(json.worker?.role).toBe("Cashier");
    expect(json.worker?.name).toBe("Amine");

    // The insert is scoped to the invite's restaurant and carries the session
    // deadline stamped from WORKER_SESSION_MAX_AGE.
    const inserted = supabaseFake.insertedRows("workers")[0];
    expect(inserted?.restaurant_id).toBe(RESTAURANT_ID);
    expect(inserted?.session_token).toBeTypeOf("string");
    const expiresAt = inserted?.session_expires_at;
    expect(expiresAt).toBeTypeOf("string");
    expect(Date.parse(String(expiresAt))).toBeGreaterThan(Date.now());

    // The session cookie carries the token that was persisted on the row.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(WORKER_SESSION_COOKIE);
    expect(cookie).toContain("sufra_worker_session");
    expect(cookie).toContain(String(inserted?.session_token));
    expect(cookie).toContain("HttpOnly");

    // Atomicity: the claim is conditional on `is_used = false` and reads the
    // claimed row back (`maybeSingle`), which is what makes the winner unique.
    const claim = supabaseFake
      .callsTo("worker_invites", "update")
      .find((call) => call.filters.some((f) => f.column === "is_used"));
    expect(claim?.payload).toEqual({ is_used: true });
    expect(claim?.filters).toContainEqual({ kind: "eq", column: "is_used", value: false });
    expect(claim?.filters).toContainEqual({ kind: "eq", column: "id", value: INVITE_ID });
    expect(claim?.terminal).toBe("maybeSingle");

    // The win is recorded for audit, and nothing is compensated away.
    expect(usedByWrite()?.payload).toEqual({ used_by: inserted?.id });
    expect(supabaseFake.callsTo("workers", "delete")).toHaveLength(0);
  });

  it("takes the role from the stored invite, never the request body", async () => {
    supabaseFake.seed("worker_invites", [seedInvite({ role: "Cashier" })]);
    supabaseFake.on("workers", "insert", insertEcho);
    supabaseFake.on("worker_invites", "update", claimWins);

    // `role` is not in the zod schema, so it is stripped rather than honoured.
    const { res, json } = await accept({ token: TOKEN, name: "Amine", role: "Manager" });

    expect(res.status).toBe(200);
    expect(supabaseFake.insertedRows("workers")[0]?.role).toBe("Cashier");
    expect(json.worker?.role).toBe("Cashier");
  });

  it("400s a malformed body without touching the database", async () => {
    const malformed: unknown[] = [{ name: "Amine" }, { token: "short", name: "Amine" }];

    for (const body of malformed) {
      const { res, json } = await accept(body);
      expect(res.status).toBe(400);
      expect(json.error).toBe("BAD_BODY");
      expect(json.cloud).toBe(false);
    }

    // No body at all: `req.json()` rejects.
    const noBody: Response = await POST(apiRequest(PATH, { ip: nextIp() }));
    expect(noBody.status).toBe(400);
    expect(((await noBody.json()) as AcceptBody).error).toBe("BAD_BODY");

    expect(supabaseFake.calls).toHaveLength(0);
  });
});
