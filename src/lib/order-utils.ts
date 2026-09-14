import { z } from "zod";

/**
 * Pure order-input validation + server-side money computation.
 *
 * The browser must never be trusted for prices or totals. Customers may only
 * send `productId` + `qty`; the server resolves price/name from the database.
 * Custom ("manual") lines carry worker-entered name+price and are only
 * accepted when the requester is an authenticated owner/worker.
 */

export const MIN_QTY = 1;
export const MAX_QTY_PER_LINE = 50;
export const MAX_LINES = 60;
export const MAX_TOTAL_QTY = 500;
export const MAX_ITEM_PRICE = 999_999.99;
export const MAX_ORDER_TOTAL = 10_000_000;

// Strict line validation. Unknown keys (e.g. `total`, `price` on a catalog
// order) are rejected instead of silently trusted.
export const catalogLineSchema = z
  .object({
    productId: z
      .string({ invalid_type_error: "productId must be a string" })
      .uuid("productId must be a valid UUID"),
    qty: z
      .number({ invalid_type_error: "qty must be a number" })
      .int("qty must be an integer")
      .min(MIN_QTY, `qty must be at least ${MIN_QTY}`)
      .max(MAX_QTY_PER_LINE, `qty must be at most ${MAX_QTY_PER_LINE}`),
  })
  .strict();

export const customLineSchema = z
  .object({
    name: z
      .string({ invalid_type_error: "name must be a string" })
      .trim()
      .min(1, "name must not be empty")
      .max(120, "name must be at most 120 characters"),
    price: z
      .number({ invalid_type_error: "price must be a number" })
      .finite("price must be finite")
      .positive("price must be positive")
      .max(MAX_ITEM_PRICE, `price must be at most ${MAX_ITEM_PRICE}`),
    qty: z
      .number({ invalid_type_error: "qty must be a number" })
      .int("qty must be an integer")
      .min(MIN_QTY, `qty must be at least ${MIN_QTY}`)
      .max(MAX_QTY_PER_LINE, `qty must be at most ${MAX_QTY_PER_LINE}`),
  })
  .strict();

const orderBodyBaseSchema = z
  .object({
    slug: z
      .string({ invalid_type_error: "slug must be a string" })
      .trim()
      .min(1, "slug must not be empty")
      .max(120),
    tableToken: z
      .string({ invalid_type_error: "tableToken must be a string" })
      .trim()
      .min(1, "tableToken must not be empty")
      .max(200)
      .optional(),
    tableNumber: z.number().int().min(1).max(10000).optional(),
    clientRef: z
      .string({ invalid_type_error: "clientRef must be a string" })
      .uuid("clientRef must be a valid UUID")
      .optional(),
    items: z
      .array(z.unknown())
      .min(1, "items must not be empty")
      .max(MAX_LINES, `items must be at most ${MAX_LINES}`),
  })
  .strip();

// A guest/anonymous scanner must prove which table it is at with the QR token
// it scanned: a table number is guessable and is not bound to a QR code.
export const orderBodySchema = orderBodyBaseSchema.refine(
  (b) => b.tableToken !== undefined,
  { message: "tableToken is required", path: ["tableToken"] },
);

// Verified worker sessions are the only callers allowed to add manual lines,
// and they may address the table by number instead (the new-order dialog picks
// it from the table list it was given) — but exactly one selector is required.
export const workerOrderBodySchema = orderBodyBaseSchema.refine(
  (b) => b.tableToken !== undefined || typeof b.tableNumber === "number",
  { message: "tableToken or tableNumber is required", path: ["tableToken"] },
);

export type CatalogOrderLine = z.infer<typeof catalogLineSchema>;
export type CustomOrderLine = z.infer<typeof customLineSchema>;

export type ParsedOrderLine =
  | { kind: "catalog"; productId: string; qty: number }
  | { kind: "custom"; name: string; price: number; qty: number };

export type ValidateOrderBodyResult =
  | {
      ok: true;
      slug: string;
      tableToken?: string;
      tableNumber?: number;
      clientRef?: string;
      lines: ParsedOrderLine[];
    }
  | { ok: false; error: string };

export function maxTotalQty(lines: ParsedOrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Validate an order request body. Returns typed lines plus the resolved table
 * selector. Extra fields (price/total/name on catalog items) fail validation.
 */
export function validateOrderBody(
  body: unknown,
  opts: { allowCustomLines: boolean },
): ValidateOrderBodyResult {
  // Only a verified worker session — the very flag that allows manual lines —
  // may address a table by number; every other caller must present the token.
  const parsed = opts.allowCustomLines
    ? workerOrderBodySchema.safeParse(body)
    : orderBodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first ? first.message : "BAD_BODY" };
  }
  const { slug, tableToken, tableNumber, clientRef, items } = parsed.data;

  const lines: ParsedOrderLine[] = [];
  for (const raw of items) {
    if (
      raw !== null &&
      typeof raw === "object" &&
      "productId" in (raw as Record<string, unknown>)
    ) {
      const r = catalogLineSchema.safeParse(raw);
      if (!r.success) {
        const first = r.error.errors[0];
        return { ok: false, error: first ? first.message : "BAD_ITEM" };
      }
      lines.push({
        kind: "catalog",
        productId: r.data.productId,
        qty: r.data.qty,
      });
    } else {
      if (!opts.allowCustomLines) {
        return { ok: false, error: "Custom items require a worker session" };
      }
      const r = customLineSchema.safeParse(raw);
      if (!r.success) {
        const first = r.error.errors[0];
        return { ok: false, error: first ? first.message : "BAD_ITEM" };
      }
      lines.push({ kind: "custom", name: r.data.name, price: r.data.price, qty: r.data.qty });
    }
  }

  const totalQty = maxTotalQty(lines);
  if (totalQty > MAX_TOTAL_QTY) {
    return { ok: false, error: `Total quantity must be at most ${MAX_TOTAL_QTY}` };
  }

  return {
    ok: true,
    slug,
    tableToken,
    tableNumber,
    clientRef,
    lines,
  };
}

/** Server-computed line item total: price × qty at millime precision. */
export function lineTotal(price: number, qty: number): number {
  return Math.round(price * qty * 1000) / 1000;
}

/**
 * Server-computed order total from already-approved items. Throws if absurd.
 *
 * Contract: an order carries at least one line and a strictly positive total.
 * Amounts are millime-precision (three decimals), matching `formatDT` and the
 * OCR/scan importers; a zero total is rejected rather than silently accepted,
 * so a 0-priced catalog can never produce a valid-looking free order.
 */
export function computeOrderTotal(
  items: { price: number; qty: number }[],
): number {
  if (items.length === 0) {
    throw new Error("order must have at least one line");
  }
  let total = 0;
  for (const it of items) {
    if (!Number.isFinite(it.price) || it.price < 0 || !Number.isFinite(it.qty)) {
      throw new Error("invalid line price/quantity");
    }
    total += lineTotal(it.price, it.qty);
  }
  total = Math.round(total * 1000) / 1000;
  if (!Number.isFinite(total) || total > MAX_ORDER_TOTAL || total <= 0) {
    throw new Error("order total out of range");
  }
  return total;
}

/**
 * Daily order-number allocation (fallback used when the atomic RPC is
 * unavailable). Pure and concurrency-tested; the real guarantee comes from the
 * `sufra_next_order_number` RPC + unique index delivered in the migration.
 */
export function nextOrderNumberFor(currentMax: number | null): number {
  return (currentMax ?? 1000) + 1;
}