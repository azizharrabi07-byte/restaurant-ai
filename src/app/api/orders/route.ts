import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import {
  computeOrderTotal,
  validateOrderBody,
} from "@/lib/order-utils";
import { getWorkerSession } from "@/lib/worker-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ParsedOrderLine } from "@/lib/order-utils";

const mapOrder = (order: Record<string, unknown>, items: { name: string; qty: number; price: number }[]) => ({
  id: order.id as string,
  number: order.daily_order_number as number,
  placedAt: new Date(order.created_at as string).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
  createdAt: order.created_at as string | undefined,
  hour: new Date(order.created_at as string).getHours(),
  status: (order.status as string) ?? "pending",
  isPaid: Boolean(order.is_paid),
  total: Number(order.total ?? 0),
  acceptedBy: order.accepted_by ? (order.accepted_by as string) : null,
  acceptedByName: order.accepted_by_name ? (order.accepted_by_name as string) : null,
  items,
});

export async function GET(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, orders: [] });
  }
  const ownerSession = await getOwnerSessionForRequest(req);
  const workerSession = await getWorkerSession(req);
  if (!ownerSession && !workerSession) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED", orders: [] }, { status: 401 });
  }

  let restaurantId: string | undefined;
  if (ownerSession) {
    const { data: restaurants } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("owner_id", ownerSession.user.userId)
      .order("created_at", { ascending: true })
      .limit(1);
    restaurantId = restaurants?.[0]?.id as string | undefined;
  } else {
    restaurantId = workerSession?.restaurantId;
  }
  if (!restaurantId) {
    return NextResponse.json({ cloud: false, orders: [] });
  }

  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*), table: restaurant_tables(table_number)")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(60);

  const mapped = (orders ?? []).map((o) => {
    const items = (o.order_items ?? []).map((i: Record<string, unknown>) => ({
      name: (i.product_name_snapshot as string) ?? "Item",
      qty: i.quantity as number,
      price: Number(i.price_snapshot ?? 0),
    }));
    const tableNumber =
      (o.table as { table_number?: number } | null)?.table_number ?? 0;
    return {
      ...mapOrder(o as Record<string, unknown>, items),
      table: tableNumber,
    };
  });

  if (ownerSession) {
    return attachOwnerSessionRotation(
      NextResponse.json({ cloud: true, orders: mapped }),
      ownerSession,
    );
  }
  return NextResponse.json({ cloud: true, orders: mapped });
}

/** ISO timestamp of local midnight, used for daily-order fallback queries. */
function dayStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

/**
 * Allocate the next daily order number for a restaurant. Primary path is the
 * atomic `sufra_next_order_number` RPC (migration 1002). If that function is
 * not deployed yet, falls back to max(daily_order_number)+1 — non-atomic
 * until the migration's unique index exists, so callers must retry on unique
 * violations. Never returns the legacy `?? 1000 + 1` value.
 */
async function allocateOrderNumber(restaurantId: string): Promise<number> {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc("sufra_next_order_number", {
      p_restaurant: restaurantId,
    });
    if (!error && typeof data === "number") return data;
  }
  const { data: last } = await supabaseAdmin!
    .from("orders")
    .select("daily_order_number")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", dayStartIso())
    .order("daily_order_number", { ascending: false })
    .limit(1);
  const currentMax = last?.[0]?.daily_order_number as number | null | undefined;
  return (currentMax ?? 1000) + 1;
}

interface PricedLine {
  line: ParsedOrderLine;
  name: string;
  unitPrice: number;
}

/** Returns the sorted (qty desc) priced lines for a validated order body. */
async function priceLines(
  lines: ParsedOrderLine[],
  restaurantId: string,
): Promise<{ ok: true; lines: PricedLine[]; total: number } | { ok: false; status: number; error: string; message: string }> {
  const catalogIds = [
    ...new Set(
      lines.filter((l): l is Extract<ParsedOrderLine, { kind: "catalog" }> => l.kind === "catalog").map((l) => l.productId),
    ),
  ];

  // Restaurant-scoped: a product id from another restaurant must NOT resolve
  // here (it would otherwise be baked into this restaurant's order).
  const { data: products } =
    catalogIds.length > 0
      ? await supabaseAdmin!
          .from("products")
          .select("id, name, price, is_available")
          .eq("restaurant_id", restaurantId)
          .in("id", catalogIds)
      : { data: [] as Record<string, unknown>[] };

  const byId = new Map(
    (products ?? []).map((p) => [p.id as string, p as Record<string, unknown>]),
  );

  const priced: PricedLine[] = [];
  for (const line of lines) {
    if (line.kind === "catalog") {
      const p = byId.get(line.productId);
      if (!p) {
        return { ok: false, status: 404, error: "PRODUCT_NOT_FOUND", message: "Some items are no longer on the menu." };
      }
      if (p.is_available === false) {
        return { ok: false, status: 409, error: "PRODUCT_UNAVAILABLE", message: "Some items are no longer available." };
      }
      const price = Number(p.price);
      if (!Number.isFinite(price) || price < 0) {
        return { ok: false, status: 500, error: "SERVER", message: "Ordering isn't available right now." };
      }
      priced.push({ line, name: (p.name as string) ?? "Item", unitPrice: price });
    } else {
      priced.push({ line, name: line.name, unitPrice: line.price });
    }
  }

  let total: number;
  try {
    total = computeOrderTotal(
      priced.map(({ line, unitPrice }) => ({ price: unitPrice, qty: line.qty })),
    );
  } catch {
    return { ok: false, status: 422, error: "BAD_AMOUNT", message: "Order total is out of range." };
  }

  const sorted = [...priced].sort((a, b) => b.line.qty - a.line.qty);
  return { ok: true, lines: sorted, total };
}

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { cloud: false, error: "NO_OWNER", message: "Ordering isn't live yet on this device." },
      { status: 503 },
    );
  }

  const rate = checkRateLimit(req, "order", { limit: 60, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      {
        cloud: false,
        error: "RATE_LIMITED",
        message: `Too many orders. Try again in ${rate.retryAfterSeconds}s.`,
      },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "Malformed request." }, { status: 400 });
  }

  const worker = await getWorkerSession(req);
  const parsed = validateOrderBody(raw, { allowCustomLines: worker !== null });
  if (!parsed.ok) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: parsed.error }, { status: 400 });
  }

  const { data: restaurant } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("slug", parsed.slug)
    .maybeSingle();
  if (!restaurant) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND", message: "Restaurant not found." }, { status: 404 });
  }

  let tableQueried;
  if (parsed.tableToken) {
    tableQueried = await supabaseAdmin
      .from("restaurant_tables")
      .select("id, table_number")
      .eq("restaurant_id", restaurant.id)
      .eq("qr_token", parsed.tableToken)
      .maybeSingle();
  } else if (typeof parsed.tableNumber === "number") {
    tableQueried = await supabaseAdmin
      .from("restaurant_tables")
      .select("id, table_number")
      .eq("restaurant_id", restaurant.id)
      .eq("table_number", parsed.tableNumber)
      .single();
  } else {
    return NextResponse.json({ cloud: false, error: "BAD_TABLE", message: "Missing table." }, { status: 404 });
  }
  const table = tableQueried.data as
    | { id: string; table_number: number }
    | null
    | undefined;
  if (tableQueried.error || !table) {
    return NextResponse.json({ cloud: false, error: "BAD_TABLE", message: "Table not found." }, { status: 404 });
  }

  const priced = await priceLines(parsed.lines, restaurant.id);
  if (!priced.ok) {
    return NextResponse.json({ cloud: false, error: priced.error, message: priced.message }, { status: priced.status });
  }
  const { lines, total } = priced;

  const clientRef = parsed.clientRef;
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nextNumber = await allocateOrderNumber(restaurant.id);

    const payload: Record<string, unknown> = {
      restaurant_id: restaurant.id,
      table_id: table.id,
      status: "pending",
      total,
      daily_order_number: nextNumber,
      is_paid: false,
    };
    if (clientRef) payload.client_ref = clientRef;

    const { data: order, error: oErr } = await supabaseAdmin
      .from("orders")
      .insert(payload)
      .select("id, created_at, daily_order_number")
      .single();

    if (!oErr && order) {
      const rows = lines.map(({ line, name, unitPrice }) => ({
        order_id: order.id,
        product_id: line.kind === "catalog" ? line.productId : null,
        product_name_snapshot: name,
        quantity: line.qty,
        price_snapshot: unitPrice,
      }));

      const { error: iErr } = await supabaseAdmin.from("order_items").insert(rows);
      if (iErr) {
        await supabaseAdmin.from("orders").delete().eq("id", order.id);
        return NextResponse.json(
          { cloud: false, error: "CREATE_ITEMS", message: "Couldn't save the order." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        cloud: true,
        order: {
          id: order.id,
          number: order.daily_order_number,
          table: table.table_number,
          placedAt: new Date(order.created_at as string).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          createdAt: order.created_at as string | undefined,
          status: "pending",
          items: lines.map(({ line, name, unitPrice }) => ({ name, qty: line.qty, price: unitPrice })),
          total,
        },
      });
    }

    if (oErr) {
      const code = (oErr as { code?: string }).code;
      if (code === "42703") {
        // `client_ref` column not deployed yet (pre-migration).
        // Retry once without the field.
        const retry = await supabaseAdmin
          .from("orders")
          .insert({
            restaurant_id: restaurant.id,
            table_id: table.id,
            status: "pending",
            total,
            daily_order_number: nextNumber,
            is_paid: false,
          })
          .select("id, created_at, daily_order_number")
          .single();
        if (!retry.error && retry.data) {
          const rows = lines.map(({ line, name, unitPrice }) => ({
            order_id: retry.data.id,
            product_id: line.kind === "catalog" ? line.productId : null,
            product_name_snapshot: name,
            quantity: line.qty,
            price_snapshot: unitPrice,
          }));
          const { error: iErr } = await supabaseAdmin.from("order_items").insert(rows);
          if (iErr) {
            await supabaseAdmin.from("orders").delete().eq("id", retry.data.id);
            return NextResponse.json(
              { cloud: false, error: "CREATE_ITEMS", message: "Couldn't save the order." },
              { status: 500 },
            );
          }
          return NextResponse.json({
            cloud: true,
            order: {
              id: retry.data.id,
              number: retry.data.daily_order_number,
              table: table.table_number,
              placedAt: new Date(retry.data.created_at as string).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              createdAt: retry.data.created_at as string | undefined,
              status: "pending",
              items: lines.map(({ line, name, unitPrice }) => ({ name, qty: line.qty, price: unitPrice })),
              total,
            },
          });
        }
      }

      if (code === "23505") {
        const msg = (oErr.message ?? "").toLowerCase();
        if (clientRef && msg.includes("client_ref")) {
          // Idempotent duplicate: the same clientRef already created an order.
          const { data: existing } = await supabaseAdmin
            .from("orders")
            .select("id, created_at, daily_order_number, status, total, is_paid, table_id")
            .eq("restaurant_id", restaurant.id)
            .eq("client_ref", clientRef)
            .maybeSingle();
          if (existing) {
            const { data: existingItems } = await supabaseAdmin
              .from("order_items")
              .select("product_name_snapshot, quantity, price_snapshot")
              .eq("order_id", existing.id);
            return NextResponse.json({
              cloud: true,
              order: {
                id: existing.id,
                number: existing.daily_order_number,
                table: table.table_number,
                placedAt: new Date(existing.created_at as string).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                createdAt: existing.created_at as string | undefined,
                status: (existing.status as string) ?? "pending",
                isPaid: Boolean(existing.is_paid),
                items: (existingItems ?? []).map((i: Record<string, unknown>) => ({
                  name: (i.product_name_snapshot as string) ?? "Item",
                  qty: i.quantity as number,
                  price: Number(i.price_snapshot ?? 0),
                })),
                total: Number(existing.total ?? 0),
              },
            });
          }
        }
        // Daily-number unique collision in the fallback path → retry.
        continue;
      }

      return NextResponse.json(
        { cloud: false, error: "CREATE_ORDER", message: "Couldn't place the order." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { cloud: false, error: "CREATE_ORDER", message: "Couldn't place the order. Please try again." },
    { status: 500 },
  );
}