import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OwnerSession } from "@/lib/owner-auth";
import type { WorkerSession } from "@/lib/worker-auth";
// Must stay above the `./route` import: the vi.mock factories read this module
// and run lazily, when the route first imports its database seam.
import { supabaseFake, supabaseAdminMock, apiRequest, filterValue } from "../../__tests__/supabase-fake";

/*
 * `DEV_WORKER_SENTINEL_ID` is deliberately NOT imported at the top of this file.
 * It is a RUNTIME value from `@/lib/worker-auth`, which line 19 mocks — and
 * `vi.mock` is hoisted above every import, so a static value import from a
 * mocked module is evaluated while that mock's factory is still initialising
 * ("Cannot access '__vi_import_1__' before initialization"). The working
 * sibling suite avoids this by importing only TYPES from worker-auth.
 *
 * It is read through a dynamic `import()` inside the one test that needs it
 * instead: the factory spreads `importActual`, so the mocked module still
 * exports the real constant. Same value, no hoisting cycle.
 */

const seams = vi.hoisted(() => ({
  ownerSession: null as OwnerSession | null,
  workerSession: null as WorkerSession | null,
}));

vi.mock("@/lib/supabase-admin", () => supabaseAdminMock());
vi.mock("@/lib/owner-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/owner-auth")>("@/lib/owner-auth");
  return { ...actual, getOwnerSessionForRequest: async () => seams.ownerSession };
});
vi.mock("@/lib/worker-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/worker-auth")>("@/lib/worker-auth");
  return { ...actual, getWorkerSession: async () => seams.workerSession };
});

import { PATCH } from "./route";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
const MISSING_ORDER_ID = "88888888-8888-4888-8888-888888888888";
const WORKER_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_RESTAURANT_WORKER_ID = "66666666-6666-4666-8666-777777777777";

const ownerSession: OwnerSession = {
  user: { userId: OWNER_ID, email: "owner@sufra.test" },
  accessToken: "access-token",
  refreshToken: "refresh-token",
  rotated: null,
};

function workerSession(role: string, overrides: Partial<WorkerSession> = {}): WorkerSession {
  return {
    workerId: WORKER_ID,
    restaurantId: RESTAURANT_ID,
    role,
    fullName: "Amina",
    ...overrides,
  };
}

/** `PATCH`'s second argument, in the shape Next passes to a route handler. */
function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return PATCH(apiRequest(`/api/orders/${ORDER_ID}`, { method: "PATCH", body, headers }), routeContext(ORDER_ID));
}

/** The single recorded `orders.update` payload, or undefined if none happened. */
function updatePayload(): Record<string, unknown> | undefined {
  const [update] = supabaseFake.callsTo("orders", "update");
  return update?.payload as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFake.reset();
  seams.ownerSession = null;
  seams.workerSession = null;
  supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
  supabaseFake.seed("orders", [{ id: ORDER_ID, restaurant_id: RESTAURANT_ID }]);
});

describe("PATCH /api/orders/[id] — acceptedBy validation", () => {
  it("rejects a non-UUID acceptedBy with 400 without reading or writing anything", async () => {
    seams.ownerSession = ownerSession;

    const res = await patch({ status: "accepted", acceptedBy: "mallory" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("BAD_BODY");
    expect(body.cloud).toBe(false);

    // Call assertions: the invalid id is rejected before the DB is touched.
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("rejects an acceptedBy worker from another restaurant and never writes the attribution", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("workers", [
      { id: OTHER_RESTAURANT_WORKER_ID, restaurant_id: OTHER_RESTAURANT_ID, full_name: "Mallory" },
    ]);

    const res = await patch({ status: "accepted", acceptedBy: OTHER_RESTAURANT_WORKER_ID });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("BAD_BODY");
    expect(supabaseFake.wroteTo("orders")).toBe(false);

    const [lookup] = supabaseFake.callsTo("workers", "select");
    expect(lookup && filterValue(lookup, "id")).toBe(OTHER_RESTAURANT_WORKER_ID);
    expect(lookup && filterValue(lookup, "restaurant_id")).toBe(RESTAURANT_ID);
  });

  it("accepts a worker of this restaurant and takes the name from the DB row, not the body", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("workers", [
      { id: WORKER_ID, restaurant_id: RESTAURANT_ID, full_name: "Amina B." },
    ]);

    const res = await patch({
      status: "accepted",
      acceptedBy: WORKER_ID,
      acceptedByName: "Mallory",
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { cloud?: boolean }).cloud).toBe(true);
    const payload = updatePayload();
    expect(payload?.status).toBe("accepted");
    expect(payload?.accepted_by).toBe(WORKER_ID);
    expect(payload?.accepted_by_name).toBe("Amina B.");
  });

  it("stamps a worker session's identity from the session, ignoring the body", async () => {
    seams.workerSession = workerSession("Cashier");

    const res = await patch({ status: "accepted", acceptedByName: "Mallory" });

    expect(res.status).toBe(200);
    const payload = updatePayload();
    expect(payload?.accepted_by).toBe(WORKER_ID);
    expect(payload?.accepted_by_name).toBe("Amina");
    // Call assertion: a session identity needs no workers lookup at all.
    expect(supabaseFake.callsTo("workers")).toHaveLength(0);
  });

  it("never stamps the dev sentinel identity as attribution", async () => {
    const { DEV_WORKER_SENTINEL_ID } = await import("@/lib/worker-auth");
    seams.workerSession = workerSession("Manager", {
      workerId: DEV_WORKER_SENTINEL_ID,
      fullName: "Dev Worker",
    });

    const res = await patch({ status: "accepted" });

    expect(res.status).toBe(200);
    const payload = updatePayload();
    expect(payload?.status).toBe("accepted");
    expect(payload?.accepted_by).toBeUndefined();
    expect(payload?.accepted_by_name).toBeUndefined();
  });
});

describe("PATCH /api/orders/[id] — reopen gate (LIB-01/API-5)", () => {
  it("refuses a Cashier reopening an order and writes nothing", async () => {
    seams.workerSession = workerSession("Cashier");

    const res = await patch({ status: "pending" });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("FORBIDDEN");
    expect(body.cloud).toBe(false);
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("refuses a Manager reopening an order and writes nothing", async () => {
    seams.workerSession = workerSession("Manager");

    const res = await patch({ status: "pending" });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe("FORBIDDEN");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("lets an Owner reopen an order", async () => {
    seams.ownerSession = ownerSession;

    const res = await patch({ status: "pending" });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { cloud?: boolean }).cloud).toBe(true);
    const payload = updatePayload();
    expect(payload?.status).toBe("pending");
    expect(payload?.is_paid).toBeUndefined();
  });
});

describe("PATCH /api/orders/[id] — role matrix and tenancy", () => {
  it("refuses a Cashier marking an order paid and writes nothing", async () => {
    seams.workerSession = workerSession("Cashier");

    const res = await patch({ status: "paid" });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe("FORBIDDEN");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("refuses a worker whose restaurant is not the order's restaurant", async () => {
    seams.workerSession = workerSession("Manager", { restaurantId: OTHER_RESTAURANT_ID });

    const res = await patch({ status: "accepted" });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe("FORBIDDEN");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("refuses an owner who does not own the order's restaurant", async () => {
    seams.ownerSession = { ...ownerSession, user: { userId: OTHER_OWNER_ID, email: "mallory@sufra.test" } };
    supabaseFake.seed("restaurants", [
      { id: RESTAURANT_ID, owner_id: OWNER_ID },
      { id: OTHER_RESTAURANT_ID, owner_id: OTHER_OWNER_ID },
    ]);

    const res = await patch({ status: "accepted" });

    expect(res.status).toBe(403);
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("returns 404 for an order that does not exist", async () => {
    seams.ownerSession = ownerSession;

    const res = await PATCH(
      apiRequest("/api/orders/nope", { method: "PATCH", body: { status: "accepted" } }),
      routeContext(MISSING_ORDER_ID),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: string }).error).toBe("NOT_FOUND");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("returns 401 for an unauthenticated caller that forges a worker cookie", async () => {
    const res = await patch(
      { status: "accepted" },
      { cookie: "sufra_worker_session=forged", "x-sufra-role": "Owner" },
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("UNAUTHORIZED");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
    expect(supabaseFake.callsTo("orders")).toHaveLength(0);
  });

  it("rejects a body that changes nothing with 400", async () => {
    seams.ownerSession = ownerSession;

    const res = await patch({});

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("BAD_BODY");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });
});
