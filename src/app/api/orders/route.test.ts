import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OwnerSession } from "@/lib/owner-auth";
import type { WorkerSession } from "@/lib/worker-auth";
// This import MUST stay above the `./route` import below: the vi.mock factories
// run lazily, when the route first imports `@/lib/supabase-admin`, and they read
// this module's bindings — so it has to be evaluated first.
import {
  supabaseFake,
  supabaseAdminMock,
  apiRequest,
  filterValue,
  inValues,
} from "../__tests__/supabase-fake";

/** Swappable auth seams; `vi.hoisted` because the mock factories read them. */
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

import { GET, POST } from "./route";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const TABLE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TABLE_ID = "33333333-3333-4333-8333-444444444444";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const WORKER_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";

const SLUG = "chez-sufra";
const TABLE_NUMBER = 7;
const TABLE_TOKEN = "tok_table_7_abcdef";
const FOREIGN_TABLE_TOKEN = "tok_foreign_table_9999";
const CREATED_AT = "2026-09-13T10:00:00.000Z";

const ownerSession: OwnerSession = {
  user: { userId: OWNER_ID, email: "owner@sufra.test" },
  accessToken: "access-token",
  refreshToken: "refresh-token",
  rotated: null,
};

const cashierSession: WorkerSession = {
  workerId: WORKER_ID,
  restaurantId: RESTAURANT_ID,
  role: "Cashier",
  fullName: "Amina",
};

/** The restaurant world both the guest and the worker paths resolve against. */
function seedRestaurantWorld(): void {
  supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, slug: SLUG, owner_id: OWNER_ID }]);
  supabaseFake.seed("restaurant_tables", [
    // The foreign table is FIRST on purpose: if the route stopped scoping its
    // lookup with `.eq("restaurant_id", …)`, `single()` would hand this row
    // back and the assertion on `table_id` below would fail.
    {
      id: OTHER_TABLE_ID,
      restaurant_id: OTHER_RESTAURANT_ID,
      table_number: TABLE_NUMBER,
      qr_token: FOREIGN_TABLE_TOKEN,
    },
    {
      id: TABLE_ID,
      restaurant_id: RESTAURANT_ID,
      table_number: TABLE_NUMBER,
      qr_token: TABLE_TOKEN,
    },
  ]);
  supabaseFake.seed("products", [
    {
      id: PRODUCT_ID,
      restaurant_id: RESTAURANT_ID,
      name: "Couscous",
      price: 12.5,
      is_available: true,
    },
    {
      id: FOREIGN_PRODUCT_ID,
      restaurant_id: OTHER_RESTAURANT_ID,
      name: "Foreign dish",
      price: 1,
      is_available: true,
    },
  ]);
}

/** Scripts the order-number RPC and the order insert so a create can succeed. */
function scriptOrderCreation(number: number): void {
  supabaseFake.onRpc(() => ({ data: number }));
  supabaseFake.once("orders", "insert", {
    data: { id: ORDER_ID, created_at: CREATED_AT, daily_order_number: number },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFake.reset();
  seams.ownerSession = null;
  seams.workerSession = null;
  seedRestaurantWorld();
});

describe("POST /api/orders — catalog lines are scoped to the restaurant", () => {
  it("rejects a productId owned by another restaurant with 404 PRODUCT_NOT_FOUND and inserts nothing", async () => {
    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          items: [{ productId: FOREIGN_PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("PRODUCT_NOT_FOUND");
    expect(body.cloud).toBe(false);

    // Call assertion: the foreign product must never be baked into an order.
    expect(supabaseFake.wroteTo("orders")).toBe(false);
    expect(supabaseFake.wroteTo("order_items")).toBe(false);
  });

  it("scopes the product lookup with the request's restaurant_id", async () => {
    await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          items: [{ productId: FOREIGN_PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    const lookups = supabaseFake.callsTo("products", "select");
    expect(lookups).toHaveLength(1);
    const [lookup] = lookups;
    expect(lookup && filterValue(lookup, "restaurant_id")).toBe(RESTAURANT_ID);
    expect(lookup && inValues(lookup, "id")).toEqual([FOREIGN_PRODUCT_ID]);
  });

  it("rejects an unavailable product with 409 PRODUCT_UNAVAILABLE and inserts nothing", async () => {
    supabaseFake.seed("products", [
      {
        id: PRODUCT_ID,
        restaurant_id: RESTAURANT_ID,
        name: "Couscous",
        price: 12.5,
        is_available: false,
      },
    ]);

    const res = await POST(
      apiRequest("/api/orders", {
        body: { slug: SLUG, tableToken: TABLE_TOKEN, items: [{ productId: PRODUCT_ID, qty: 1 }] },
      }),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe("PRODUCT_UNAVAILABLE");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });
});

describe("POST /api/orders — server-side pricing is authoritative", () => {
  it("rejects a client-supplied price on a catalog line and writes nothing", async () => {
    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          items: [{ productId: PRODUCT_ID, qty: 1, price: 0.01 }],
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("BAD_BODY");
    expect(body.cloud).toBe(false);
    expect(supabaseFake.wroteTo("orders")).toBe(false);
    expect(supabaseFake.wroteTo("order_items")).toBe(false);
  });

  it("rejects a client-supplied total on a catalog line and writes nothing", async () => {
    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          items: [{ productId: PRODUCT_ID, qty: 1, total: 0.01 }],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("BAD_BODY");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("ignores a stray top-level total and prices the order from the DB row", async () => {
    scriptOrderCreation(1005);

    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          total: 0.01,
          items: [{ productId: PRODUCT_ID, qty: 3 }],
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cloud?: boolean;
      order?: { id?: string; total?: number; number?: number };
    };
    expect(body.cloud).toBe(true);
    // 3 × 12.50 from the DB row, not the 0.01 the client sent.
    expect(body.order?.total).toBe(37.5);
    expect(body.order?.id).toBe(ORDER_ID);
    expect(body.order?.number).toBe(1005);
    expect(supabaseFake.rpcCalls[0]?.fn).toBe("sufra_next_order_number");

    const [insert] = supabaseFake.writesTo("orders");
    const payload = insert?.payload as
      | { total?: number; status?: string; restaurant_id?: string; table_id?: string }
      | undefined;
    expect(payload?.total).toBe(37.5);
    expect(payload?.status).toBe("pending");
    expect(payload?.restaurant_id).toBe(RESTAURANT_ID);
    expect(payload?.table_id).toBe(TABLE_ID);

    const items = supabaseFake.insertedRows("order_items");
    expect(items).toHaveLength(1);
    expect(items[0]?.price_snapshot).toBe(12.5);
    expect(items[0]?.quantity).toBe(3);
  });
});

describe("POST /api/orders — table selector (API-1)", () => {
  it("accepts a worker session that addresses the table by number", async () => {
    seams.workerSession = cashierSession;
    scriptOrderCreation(1001);

    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableNumber: TABLE_NUMBER,
          items: [{ productId: PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { cloud?: boolean }).cloud).toBe(true);

    const tables = supabaseFake.callsTo("restaurant_tables", "select");
    expect(tables).toHaveLength(1);
    const [tableLookup] = tables;
    expect(tableLookup && filterValue(tableLookup, "restaurant_id")).toBe(RESTAURANT_ID);
    expect(tableLookup && filterValue(tableLookup, "table_number")).toBe(TABLE_NUMBER);

    const [insert] = supabaseFake.writesTo("orders");
    const payload = insert?.payload as { table_id?: string } | undefined;
    expect(payload?.table_id).toBe(TABLE_ID);
  });

  it("rejects an anonymous guest who addresses the table by number, before any read", async () => {
    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableNumber: TABLE_NUMBER,
          items: [{ productId: PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("BAD_BODY");
    expect(body.cloud).toBe(false);

    // Call assertions: a forged table number must not even reach the tables.
    expect(supabaseFake.callsTo("restaurant_tables")).toHaveLength(0);
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("rejects another restaurant's QR token for a guest with 404 and inserts nothing", async () => {
    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: FOREIGN_TABLE_TOKEN,
          items: [{ productId: PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: string }).error).toBe("BAD_TABLE");
    expect(supabaseFake.wroteTo("orders")).toBe(false);
  });

  it("accepts a guest presenting this restaurant's QR token", async () => {
    scriptOrderCreation(1002);

    const res = await POST(
      apiRequest("/api/orders", {
        body: {
          slug: SLUG,
          tableToken: TABLE_TOKEN,
          items: [{ productId: PRODUCT_ID, qty: 1 }],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { cloud?: boolean }).cloud).toBe(true);
    const [insert] = supabaseFake.writesTo("orders");
    expect((insert?.payload as { table_id?: string } | undefined)?.table_id).toBe(TABLE_ID);
  });
});

describe("GET /api/orders — forged client state is not authorization", () => {
  it("returns 401 with no orders for an unauthenticated caller that forges every client header", async () => {
    const res = await GET(
      apiRequest("/api/orders", {
        method: "GET",
        headers: {
          authorization: "Bearer forged",
          cookie: "sufra_worker_session=forged; sufra_owner_session=forged",
          "x-sufra-role": "Owner",
          "x-sufra-restaurant-id": RESTAURANT_ID,
        },
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { cloud?: boolean; error?: string; orders?: unknown[] };
    expect(body.error).toBe("UNAUTHORIZED");
    expect(body.cloud).toBe(false);
    expect(body.orders).toEqual([]);

    // Call assertion: no order was ever read for this caller.
    expect(supabaseFake.callsTo("orders")).toHaveLength(0);
  });

  it("returns the caller's own restaurant's orders for a verified owner", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("orders", [
      {
        id: ORDER_ID,
        restaurant_id: RESTAURANT_ID,
        daily_order_number: 1,
        created_at: CREATED_AT,
        status: "pending",
        is_paid: false,
        total: 25,
        order_items: [{ product_name_snapshot: "Couscous", quantity: 2, price_snapshot: 12.5 }],
        table: { table_number: TABLE_NUMBER },
      },
      { id: OTHER_TABLE_ID, restaurant_id: OTHER_RESTAURANT_ID, daily_order_number: 9, created_at: CREATED_AT },
    ]);

    const res = await GET(apiRequest("/api/orders", { method: "GET" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cloud?: boolean;
      orders?: { id: string; table: number; total: number; items: { name: string }[] }[];
    };
    expect(body.cloud).toBe(true);
    expect(body.orders).toHaveLength(1);
    expect(body.orders?.[0]?.id).toBe(ORDER_ID);
    expect(body.orders?.[0]?.table).toBe(TABLE_NUMBER);
    expect(body.orders?.[0]?.total).toBe(25);
    expect(body.orders?.[0]?.items[0]?.name).toBe("Couscous");

    const [ordersRead] = supabaseFake.callsTo("orders", "select");
    expect(ordersRead && filterValue(ordersRead, "restaurant_id")).toBe(RESTAURANT_ID);
  });
});
