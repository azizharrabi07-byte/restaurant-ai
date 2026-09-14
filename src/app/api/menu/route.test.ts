import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OwnerSession } from "@/lib/owner-auth";
import type { WorkerSession } from "@/lib/worker-auth";
// Must stay above the `./route` import: the vi.mock factories read this module
// and run lazily, when the route first imports its database seam.
import { supabaseFake, supabaseAdminMock, apiRequest, filterValue } from "../__tests__/supabase-fake";

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

import { GET, PUT } from "./route";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "10101010-1010-4010-8010-101010101010";
const PRODUCT_ID = "20202020-2020-4020-8020-202020202020";
const TABLE_ID = "30303030-3030-4030-8030-303030303030";
const SLUG = "chez-sufra";

const ownerSession: OwnerSession = {
  user: { userId: OWNER_ID, email: "owner@sufra.test" },
  accessToken: "access-token",
  refreshToken: "refresh-token",
  rotated: null,
};

const workerSession: WorkerSession = {
  workerId: "66666666-6666-4666-8666-666666666666",
  restaurantId: RESTAURANT_ID,
  role: "Manager",
  fullName: "Amina",
};

interface SyncPayload {
  restaurant: {
    name: string;
    slug: string;
    tagline: string;
    businessType: string;
    logoUrl: string | null;
    coverUrl: string | null;
    primaryColor: string;
    theme: string;
    isPublished: boolean;
  };
  categories: { id: string; name: string; position: number }[];
  products: {
    id: string;
    categoryId: string;
    name: string;
    description: string;
    price: number;
    imageUrl: string | null;
    isAvailable: boolean;
    position: number;
  }[];
  tables: { id: string; number: number; token: string }[];
}

/** A payload that is entirely ours: valid, and free of foreign ids. */
function ownedPayload(): SyncPayload {
  return {
    restaurant: {
      name: "Chez Sufra",
      slug: SLUG,
      tagline: "",
      businessType: "cafe",
      logoUrl: null,
      coverUrl: null,
      primaryColor: "#D97706",
      theme: "classic",
      isPublished: true,
    },
    categories: [{ id: CATEGORY_ID, name: "Starters", position: 0 }],
    products: [
      {
        id: PRODUCT_ID,
        categoryId: CATEGORY_ID,
        name: "Couscous",
        description: "",
        price: 12.5,
        imageUrl: null,
        isAvailable: true,
        position: 0,
      },
    ],
    tables: [{ id: TABLE_ID, number: 7, token: "tok_table_7_abcdef" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFake.reset();
  seams.ownerSession = null;
  seams.workerSession = null;
});

describe("PUT /api/menu — cross-restaurant id rejection (IDOR)", () => {
  it("rejects a product owned by another restaurant with 403 and performs zero writes", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("products", [{ id: PRODUCT_ID, restaurant_id: OTHER_RESTAURANT_ID }]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      cloud?: boolean;
      error?: string;
      conflicting?: { kind: string; ids: string[] }[];
    };
    expect(body.error).toBe("FORBIDDEN");
    expect(body.cloud).toBe(false);
    expect(body.conflicting).toEqual([{ kind: "product", ids: [PRODUCT_ID] }]);

    // The real assertion: the pre-fix code upserted before validating, so a
    // rejected sync still rewrote the row. Nothing may be written now.
    expect(supabaseFake.writes()).toHaveLength(0);
    expect(supabaseFake.wroteTo("restaurants")).toBe(false);
    expect(supabaseFake.wroteTo("products")).toBe(false);
  });

  it("rejects a category owned by another restaurant with 403 and performs zero writes", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: OTHER_RESTAURANT_ID }]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { conflicting?: { kind: string; ids: string[] }[] };
    // The product legitimately references that category, so the same id shows
    // up twice — once as the category itself and once as a category reference.
    expect(body.conflicting?.[0]).toEqual({ kind: "category", ids: [CATEGORY_ID] });
    expect(body.conflicting).toContainEqual({ kind: "categoryRef", ids: [CATEGORY_ID] });
    expect(supabaseFake.writes()).toHaveLength(0);
  });

  it("rejects a table owned by another restaurant with 403 and performs zero writes", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("products", [{ id: PRODUCT_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("restaurant_tables", [{ id: TABLE_ID, restaurant_id: OTHER_RESTAURANT_ID }]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { conflicting?: { kind: string; ids: string[] }[] };
    expect(body.conflicting).toEqual([{ kind: "table", ids: [TABLE_ID] }]);
    expect(supabaseFake.writes()).toHaveLength(0);
  });

  it("treats an orphaned row (null restaurant_id) as foreign and refuses to claim it", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("products", [{ id: PRODUCT_ID, restaurant_id: null }]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { conflicting?: { kind: string; ids: string[] }[] };
    expect(body.conflicting).toEqual([{ kind: "product", ids: [PRODUCT_ID] }]);
    expect(supabaseFake.writes()).toHaveLength(0);
  });

  it("aborts with 500 OWNERSHIP_CHECK_FAILED and zero writes when the ownership probe errors", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.on("products", "select", { data: null, error: { message: "probe failed" } });

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("OWNERSHIP_CHECK_FAILED");
    expect(body.cloud).toBe(false);
    expect(supabaseFake.writes()).toHaveLength(0);
  });

  it("accepts the same payload once every referenced id is ours", async () => {
    seams.ownerSession = ownerSession;
    supabaseFake.seed("restaurants", [{ id: RESTAURANT_ID, owner_id: OWNER_ID }]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("products", [{ id: PRODUCT_ID, restaurant_id: RESTAURANT_ID }]);
    supabaseFake.seed("restaurant_tables", [{ id: TABLE_ID, restaurant_id: RESTAURANT_ID }]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { cloud?: boolean; restaurantId?: string };
    expect(body.cloud).toBe(true);
    expect(body.restaurantId).toBe(RESTAURANT_ID);
    expect(supabaseFake.wroteTo("restaurants")).toBe(true);
    expect(supabaseFake.wroteTo("categories")).toBe(true);
    expect(supabaseFake.wroteTo("products")).toBe(true);
    expect(supabaseFake.wroteTo("restaurant_tables")).toBe(true);
    // Slug contract: the stored slug is already printed on QR standees, so an
    // update must never rewrite it.
    const [restaurantUpdate] = supabaseFake.callsTo("restaurants", "update");
    expect(restaurantUpdate?.payload).not.toHaveProperty("slug");
  });
});

describe("PUT /api/menu — slug clash is decided before the first write", () => {
  it("returns 409 SLUG_TAKEN and never writes the restaurant or the menu", async () => {
    seams.ownerSession = ownerSession;
    // The owner has no restaurant yet; someone else already holds the slug.
    supabaseFake.seed("restaurants", [
      { id: OTHER_RESTAURANT_ID, owner_id: OTHER_OWNER_ID, slug: SLUG },
    ]);

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: ownedPayload() }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("SLUG_TAKEN");
    expect(body.cloud).toBe(false);

    expect(supabaseFake.writes()).toHaveLength(0);
    expect(supabaseFake.wroteTo("restaurants")).toBe(false);

    const clashProbe = supabaseFake.callsTo("restaurants", "select").at(-1);
    expect(clashProbe && filterValue(clashProbe, "slug")).toBe(SLUG);
  });
});

describe("PUT /api/menu — authentication", () => {
  it("returns 401 for an unauthenticated caller and writes nothing", async () => {
    const res = await PUT(
      apiRequest("/api/menu", {
        method: "PUT",
        body: ownedPayload(),
        headers: { cookie: "sufra_owner_session=forged" },
      }),
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("UNAUTHORIZED");
    expect(supabaseFake.writes()).toHaveLength(0);
    expect(supabaseFake.calls).toHaveLength(0);
  });

  it("rejects a payload that is not a menu sync with 400 and writes nothing", async () => {
    seams.ownerSession = ownerSession;

    const res = await PUT(apiRequest("/api/menu", { method: "PUT", body: { restaurant: {} } }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("BAD_PAYLOAD");
    expect(supabaseFake.writes()).toHaveLength(0);
  });
});

describe("GET /api/menu — forged client state is not authorization", () => {
  it("returns 401 with an empty menu and reads nothing for an unauthenticated caller", async () => {
    const res = await GET(
      apiRequest("/api/menu", {
        method: "GET",
        headers: { cookie: "sufra_worker_session=forged", "x-sufra-role": "Owner" },
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      source?: string;
      restaurant?: unknown;
      categories?: unknown[];
      products?: unknown[];
      tables?: unknown[];
    };
    expect(body.source).toBe("empty");
    expect(body.restaurant).toBeNull();
    expect(body.categories).toEqual([]);
    expect(body.products).toEqual([]);
    expect(body.tables).toEqual([]);

    expect(supabaseFake.calls).toHaveLength(0);
  });

  it("never answers an empty menu when a read fails", async () => {
    seams.workerSession = workerSession;
    supabaseFake.on("categories", "select", { data: null, error: { message: "boom" } });

    const res = await GET(apiRequest("/api/menu", { method: "GET" }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { cloud?: boolean; error?: string };
    expect(body.error).toBe("READ_FAILED");
    expect(body.cloud).toBe(false);
  });

  it("returns the caller's own menu for a verified worker", async () => {
    seams.workerSession = workerSession;
    supabaseFake.seed("restaurants", [
      {
        id: RESTAURANT_ID,
        owner_id: OWNER_ID,
        name: "Chez Sufra",
        slug: SLUG,
        tagline: "",
        business_type: "cafe",
        menu_layout_theme: "classic",
        is_published: true,
        primary_color: "#D97706",
      },
    ]);
    supabaseFake.seed("categories", [{ id: CATEGORY_ID, restaurant_id: RESTAURANT_ID, name: "Starters", sort_order: 0 }]);
    supabaseFake.seed("products", [
      {
        id: PRODUCT_ID,
        restaurant_id: RESTAURANT_ID,
        category_id: CATEGORY_ID,
        name: "Couscous",
        price: 12.5,
        is_available: true,
        sort_order: 0,
      },
    ]);
    supabaseFake.seed("restaurant_tables", [
      { id: TABLE_ID, restaurant_id: RESTAURANT_ID, table_number: 7, qr_token: "tok_table_7_abcdef" },
    ]);

    const res = await GET(apiRequest("/api/menu", { method: "GET" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source?: string;
      restaurant?: { id: string; slug: string };
      categories?: { id: string }[];
      products?: { id: string; price: number }[];
      tables?: { id: string; number: number }[];
    };
    expect(body.source).toBe("supabase");
    expect(body.restaurant?.id).toBe(RESTAURANT_ID);
    expect(body.restaurant?.slug).toBe(SLUG);
    expect(body.categories?.[0]?.id).toBe(CATEGORY_ID);
    expect(body.products?.[0]?.price).toBe(12.5);
    expect(body.tables?.[0]?.number).toBe(7);
  });
});
