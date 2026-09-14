import { describe, it, expect } from "vitest";
import {
  findConflicts,
  findSyncConflicts,
  validateSyncPayload,
  type SyncOwnershipModel,
} from "./menu-sync-guard";
import type { MenuSyncPayload } from "./menu-mapping";

const OWNED = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const FRESH = "33333333-3333-4333-8333-333333333333";

function model(over: Partial<SyncOwnershipModel> = {}): SyncOwnershipModel {
  return {
    restaurantId: OWNED,
    incoming: { categoryIds: [FRESH], productIds: [], tableIds: [], referencedCategoryIds: [] },
    foreign: { categories: [], products: [], tables: [], referencedCategories: [] },
    ...over,
  };
}

describe("findConflicts", () => {
  it("flags ids owned by another restaurant", () => {
    expect(findConflicts([FOREIGN], [{ id: FOREIGN, restaurantId: FOREIGN }])).toEqual([FOREIGN]);
  });
  it("does not flag fresh uuids (not present in the DB)", () => {
    expect(findConflicts([FRESH], [])).toEqual([]);
  });
  it("treats orphaned rows (null restaurant) as conflicts so they are not stolen", () => {
    expect(findConflicts([FOREIGN], [{ id: FOREIGN, restaurantId: null }])).toEqual([FOREIGN]);
  });
});

describe("findSyncConflicts", () => {
  it("reports category, product and table cross-restaurant ids", () => {
    const m = model({
      incoming: {
        categoryIds: [FOREIGN],
        productIds: [FOREIGN],
        tableIds: [FOREIGN],
        referencedCategoryIds: [],
      },
      foreign: {
        categories: [{ id: FOREIGN, restaurantId: FOREIGN }],
        products: [{ id: FOREIGN, restaurantId: FOREIGN }],
        tables: [{ id: FOREIGN, restaurantId: FOREIGN }],
        referencedCategories: [],
      },
    });
    const kinds = findSyncConflicts(m).map((c) => c.kind).sort();
    expect(kinds).toEqual(["category", "product", "table"]);
  });

  it("flags a product referencing another restaurant's category", () => {
    const m = model({
      incoming: { categoryIds: [], productIds: [], tableIds: [], referencedCategoryIds: [FOREIGN] },
      foreign: { categories: [], products: [], tables: [], referencedCategories: [{ id: FOREIGN, restaurantId: FOREIGN }] },
    });
    expect(findSyncConflicts(m)).toEqual([{ kind: "categoryRef", ids: [FOREIGN] }]);
  });

  it("passes an all-ours payload", () => {
    expect(findSyncConflicts(model())).toEqual([]);
  });
});

function validPayload(over: Partial<MenuSyncPayload> = {}): MenuSyncPayload {
  return {
    restaurant: {
      name: "Cafe Test",
      slug: "cafe-test",
      tagline: "",
      businessType: "cafe",
      logoUrl: null,
      coverUrl: "https://example.com/cover.jpg",
      primaryColor: "#D97706",
      theme: "classic",
      isPublished: true,
    },
    categories: [{ id: FRESH, name: "Coffee", position: 0 }],
    products: [
      {
        id: FRESH,
        categoryId: FRESH,
        name: "Cappuccino",
        description: "",
        price: 4.5,
        imageUrl: "https://example.com/img.jpg",
        isAvailable: true,
        position: 0,
      },
    ],
    tables: [{ id: FRESH, number: 1, token: "abc123" }],
    ...over,
  };
}

describe("validateSyncPayload", () => {
  it("accepts a well-formed payload", () => {
    const r = validateSyncPayload(validPayload());
    expect(r.ok).toBe(true);
  });

  it("rejects a product referencing an unknown category", () => {
    const p = validPayload({ products: [{ ...validPayload().products[0], categoryId: FOREIGN }] });
    const r = validateSyncPayload(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.message.includes("unknown category"))).toBe(true);
  });

  it("rejects non-http(s) image URLs (javascript: XSS vector)", () => {
    const p = validPayload({ products: [{ ...validPayload().products[0], imageUrl: "javascript:alert(1)" }] });
    const r = validateSyncPayload(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.message.includes("imageUrl"))).toBe(true);
  });

  it("rejects negative / non-finite prices", () => {
    const p = validPayload({ products: [{ ...validPayload().products[0], price: -1 }] });
    expect(validateSyncPayload(p).ok).toBe(false);
    const nan = validPayload({ products: [{ ...validPayload().products[0], price: Number.NaN }] });
    expect(validateSyncPayload(nan).ok).toBe(false);
  });

  it("rejects too many categories", () => {
    const categories = Array.from({ length: 61 }, (_, i) => ({
      id: `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`,
      name: `C${i}`,
      position: i,
    }));
    const r = validateSyncPayload(validPayload({ categories }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === "categories")).toBe(true);
  });

  it("rejects a bad slug or color", () => {
    const badSlug = validateSyncPayload(validPayload({ restaurant: { ...validPayload().restaurant, slug: "Bad Slug!" } }));
    expect(badSlug.ok).toBe(false);
    const badColor = validateSyncPayload(validPayload({ restaurant: { ...validPayload().restaurant, primaryColor: "red" } }));
    expect(badColor.ok).toBe(false);
  });

  it("rejects duplicate product ids and non-uuid ids", () => {
    const p = validPayload().products[0];
    expect(validateSyncPayload({ ...validPayload(), products: [p, p] }).ok).toBe(false);

    const nonUuid = {
      ...validPayload(),
      categories: [{ id: "not-a-uuid", name: "Coffee", position: 0 }],
      products: [],
    };
    expect(validateSyncPayload(nonUuid).ok).toBe(false);
  });

  it("rejects duplicate table ids and duplicate QR tokens", () => {
    const t = validPayload().tables[0];
    expect(validateSyncPayload({ ...validPayload(), tables: [t, t] }).ok).toBe(false);

    const sharedToken = [
      { id: FRESH, number: 1, token: "same-token" },
      { id: OWNED, number: 2, token: "same-token" },
    ];
    expect(validateSyncPayload({ ...validPayload(), tables: sharedToken }).ok).toBe(false);
  });

  it("rejects a business type outside BUSINESS_TYPES and non-6-digit colors", () => {
    const r = validPayload().restaurant;
    expect(
      validateSyncPayload({ ...validPayload(), restaurant: { ...r, businessType: "spaceship" } }).ok,
    ).toBe(false);
    expect(
      validateSyncPayload({ ...validPayload(), restaurant: { ...r, primaryColor: "#abc" } }).ok,
    ).toBe(false);
    expect(
      validateSyncPayload({ ...validPayload(), restaurant: { ...r, primaryColor: "#11223344" } }).ok,
    ).toBe(false);
  });

  it("rejects non-boolean isAvailable / isPublished", () => {
    expect(
      validateSyncPayload({
        ...validPayload(),
        products: [{ ...validPayload().products[0], isAvailable: "no" }],
      }).ok,
    ).toBe(false);
    expect(
      validateSyncPayload({
        ...validPayload(),
        restaurant: { ...validPayload().restaurant, isPublished: "yes" },
      }).ok,
    ).toBe(false);
  });

  it("returns a rebuilt payload, not a cast of the raw body", () => {
    const r = validateSyncPayload({
      ...validPayload(),
      categories: [{ id: FRESH, name: "Coffee" }],
      products: [{ ...validPayload().products[0], position: "first" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.categories[0].position).toBe(0);
      expect(r.payload.products[0].position).toBe(0);
      expect(r.payload.products[0].isAvailable).toBe(true);
    }
  });
});