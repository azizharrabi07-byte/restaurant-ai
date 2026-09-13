import { describe, it, expect } from "vitest";
import {
  validateOrderBody,
  computeOrderTotal,
  nextOrderNumberFor,
  lineTotal,
  catalogLineSchema,
  customLineSchema,
  orderBodySchema,
  MAX_TOTAL_QTY,
} from "./order-utils";

describe("validateOrderBody", () => {
  it("accepts valid catalog items (productId + qty only)", () => {
    const r = validateOrderBody(
      {
        slug: "chez-aziz",
        tableToken: "abc123",
        items: [{ productId: "00000000-0000-4000-8000-000000000001", qty: 2 }],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toEqual([
        { kind: "catalog", productId: "00000000-0000-4000-8000-000000000001", qty: 2 },
      ]);
    }
  });

  it("rejects client-supplied price on a catalog item", () => {
    const r = validateOrderBody(
      {
        slug: "chez-aziz",
        tableToken: "t",
        items: [
          {
            productId: "00000000-0000-4000-8000-000000000001",
            price: 0,
            qty: 1,
          },
        ],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects client-supplied price of 0 / negative / huge / name", () => {
    for (const tamper of [
      { price: 0 },
      { price: -10 },
      { price: 9e15 },
      { total: 0 },
      { name: "Golden Steak" },
    ]) {
      const r = validateOrderBody(
        {
          slug: "s",
          tableToken: "t",
          items: [
            {
              productId: "00000000-0000-4000-8000-000000000001",
              qty: 1,
              ...tamper,
            },
          ],
        },
        { allowCustomLines: false },
      );
      expect(r.ok).toBe(false);
    }
  });

  it("rejects non-integer, zero, negative, NaN and Infinity quantities", () => {
    for (const qty of [0, -1, 1.5, NaN, Infinity]) {
      const r = validateOrderBody(
        {
          slug: "s",
          tableToken: "t",
          items: [{ productId: "00000000-0000-4000-8000-000000000001", qty }],
        },
        { allowCustomLines: false },
      );
      expect(r.ok).toBe(false);
    }
  });

  it("rejects invalid product id UUIDs", () => {
    const r = validateOrderBody(
      {
        slug: "s",
        tableToken: "t",
        items: [{ productId: "not-a-uuid", qty: 1 }],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects unknown product ids silently passed through with a name (manual) for guests", () => {
    const r = validateOrderBody(
      {
        slug: "s",
        tableToken: "t",
        items: [{ name: "Chai", price: 12.5, qty: 1 }],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/worker session/i);
  });

  it("allows custom lines only when opted in", () => {
    const body = {
      slug: "s",
      tableToken: "t",
      items: [{ name: "Chai", price: 12.5, qty: 1 }],
    };
    const blocked = validateOrderBody(body, { allowCustomLines: false });
    const allowed = validateOrderBody(body, { allowCustomLines: true });
    expect(blocked.ok).toBe(false);
    expect(allowed.ok).toBe(true);
  });

  it("caps line count", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      qty: 1,
    }));
    const r = validateOrderBody({ slug: "s", tableToken: "t", items: many }, { allowCustomLines: false });
    expect(r.ok).toBe(false);
  });

  it("caps total quantity across lines", () => {
    const base = {
      productId: "00000000-0000-4000-8000-000000000001",
      qty: MAX_TOTAL_QTY + 1,
    };
    const r = validateOrderBody({ slug: "s", tableToken: "t", items: [base] }, { allowCustomLines: false });
    expect(r.ok).toBe(false);
    // 50 per line across 11 lines = 550 > 500
    const line = { productId: "00000000-0000-4000-8000-000000000001", qty: 50 };
    const many = Array.from({ length: 11 }, () => ({ ...line }));
    const r2 = validateOrderBody({ slug: "s", tableToken: "t", items: many }, { allowCustomLines: false });
    expect(r2.ok).toBe(false);
  });

  it("rejects empty items and missing slug/tableToken", () => {
    expect(validateOrderBody({ items: [] }, { allowCustomLines: false }).ok).toBe(false);
    expect(validateOrderBody({ tableToken: "t", items: [{ productId: "00000000-0000-4000-8000-000000000001", qty: 1 }] }, { allowCustomLines: false }).ok).toBe(false);
  });

  it("accepts optional clientRef uuid", () => {
    const r = validateOrderBody(
      {
        slug: "s",
        tableToken: "t",
        clientRef: "11111111-2222-4333-8444-555555555555",
        items: [{ productId: "00000000-0000-4000-8000-000000000001", qty: 1 }],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects stray top-level fields like total", () => {
    // orderBodySchema strips unknown keys, but the server must never trust them
    const r = orderBodySchema.safeParse({
      slug: "s",
      tableToken: "t",
      total: 0,
      items: [{ productId: "00000000-0000-4000-8000-000000000001", qty: 1 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect("total" in r.data).toBe(false);
  });

  it("rejects a forged `paid` status / privileged fields in the body", () => {
    const r = validateOrderBody(
      {
        slug: "s",
        tableToken: "t",
        status: "paid",
        isPaid: true,
        items: [{ productId: "00000000-0000-4000-8000-000000000001", qty: 1 }],
      },
      { allowCustomLines: false },
    );
    expect(r.ok).toBe(true);
  });
});

describe("computeOrderTotal", () => {
  it("computes unitPrice * qty server-side", () => {
    expect(computeOrderTotal([{ price: 12.5, qty: 2 }])).toBe(25);
    expect(computeOrderTotal([{ price: 0.1, qty: 3 }])).toBeCloseTo(0.3, 10);
  });

  it("rejects negative / non-finite prices", () => {
    expect(() => computeOrderTotal([{ price: -1, qty: 1 }])).toThrow();
    expect(() => computeOrderTotal([{ price: NaN, qty: 1 }])).toThrow();
    expect(() => computeOrderTotal([{ price: Infinity, qty: 1 }])).toThrow();
  });

  it("rejects absurd totals", () => {
    expect(() =>
      computeOrderTotal([{ price: 9e6, qty: 2 }]),
    ).toThrow();
  });
});

describe("lineTotal", () => {
  it("rounds to 2 decimals", () => {
    expect(lineTotal(0.1, 3)).toBeCloseTo(0.3, 10);
    expect(lineTotal(12.345, 1)).toBe(12.35);
  });
});

describe("nextOrderNumberFor", () => {
  it("returns 1001 when no order today", () => {
    expect(nextOrderNumberFor(null)).toBe(1001);
    expect(nextOrderNumberFor(undefined as unknown as number | null)).toBe(1001);
  });

  it("increments the previous max instead of repeating it (regression for `?? 1000 + 1`)", () => {
    // The legacy code `(max ?? 1000) + 1` — including the wrong-precedence
    // `max ?? 1000 + 1` — failed to increment. Assert we never emit `max`.
    expect(nextOrderNumberFor(1000)).toBe(1001);
    expect(nextOrderNumberFor(1001)).toBe(1002);
    expect(nextOrderNumberFor(2000)).toBe(2001);
  });
});

describe("customLineSchema", () => {
  it("validates worker manual lines", () => {
    expect(customLineSchema.safeParse({ name: "Chai", price: 12.5, qty: 1 }).success).toBe(true);
    expect(customLineSchema.safeParse({ name: "Chai", price: 0, qty: 1 }).success).toBe(false);
    expect(customLineSchema.safeParse({ name: "", price: 1, qty: 1 }).success).toBe(false);
    expect(customLineSchema.safeParse({ name: "Chai", price: 1.5, qty: 0 }).success).toBe(false);
  });
});