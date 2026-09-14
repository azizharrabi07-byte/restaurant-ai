import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiRequest } from "./supabase-fake";

/**
 * Degraded mode: the app must not crash, and must not leak data, when it is
 * deployed without Supabase credentials (`supabaseAdmin === null`). This file
 * mocks the seam with `null` — the opposite of the fake the other suites
 * install — so it has to be its own module.
 */
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: null,
  hasBackend: () => false,
}));

import { GET as getMenu, PUT as putMenu } from "../menu/route";
import { GET as getOrders, POST as postOrder } from "../orders/route";
import { PATCH as patchOrder } from "../orders/[id]/route";
import { POST as postLogin } from "../auth/login/route";
import { POST as postWorkerAccept } from "../auth/worker/accept/route";

const ORDER_ID = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routes without a configured backend", () => {
  it("GET /api/menu answers an empty menu instead of failing", async () => {
    const res = await getMenu(apiRequest("/api/menu", { method: "GET" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { source?: string; restaurant?: unknown; categories?: unknown[] };
    expect(body.source).toBe("empty");
    expect(body.restaurant).toBeNull();
    expect(body.categories).toEqual([]);
  });

  it("PUT /api/menu falls back to local mode with cloud:false", async () => {
    const res = await putMenu(apiRequest("/api/menu", { method: "PUT", body: {} }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.cloud).toBe(false);
    expect(body.error).toBe("NO_OWNER");
  });

  it("GET /api/orders answers no orders instead of failing", async () => {
    const res = await getOrders(apiRequest("/api/orders", { method: "GET" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { cloud?: boolean; orders?: unknown[] };
    expect(body.cloud).toBe(false);
    expect(body.orders).toEqual([]);
  });

  it("POST /api/orders refuses with 503 NO_OWNER", async () => {
    const res = await postOrder(apiRequest("/api/orders", { body: { slug: "s", items: [] } }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("NO_OWNER");
    expect(body.cloud).toBe(false);
  });

  it("PATCH /api/orders/[id] refuses with 503 NO_OWNER", async () => {
    const res = await patchOrder(apiRequest(`/api/orders/${ORDER_ID}`, { method: "PATCH", body: {} }), {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error?: string }).error).toBe("NO_OWNER");
  });

  it("POST /api/auth/login refuses with 503 NO_BACKEND", async () => {
    const res = await postLogin(
      apiRequest("/api/auth/login", { body: { email: "a@b.co", password: "secret1" } }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("NO_BACKEND");
    expect(body.cloud).toBe(false);
  });

  it("POST /api/auth/worker/accept refuses with 503 NO_BACKEND", async () => {
    const res = await postWorkerAccept(
      apiRequest("/api/auth/worker/accept", { body: { token: "0123456789abcdef", name: "Amina" } }),
    );

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error?: string }).error).toBe("NO_BACKEND");
  });
});
