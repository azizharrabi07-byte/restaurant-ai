import { NextResponse } from "next/server";
import { supabaseAdmin, resolveOwnerUserId } from "@/lib/supabase-admin";

interface OrderItemInput {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

const mapOrder = (order: Record<string, unknown>, items: { name: string; qty: number; price: number }[]) => ({
  id: order.id as string,
  number: order.daily_order_number as number,
  placedAt: new Date(order.created_at as string).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
  hour: new Date(order.created_at as string).getHours(),
  status: (order.status as string) ?? "pending",
  isPaid: Boolean(order.is_paid),
  total: Number(order.total ?? 0),
  acceptedBy: order.accepted_by ? (order.accepted_by as string) : null,
  acceptedByName: order.accepted_by_name ? (order.accepted_by_name as string) : null,
  items,
});

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, orders: [] });
  }
  const ownerId = await resolveOwnerUserId();
  if (!ownerId) return NextResponse.json({ cloud: false, orders: [] });

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1);
  const restaurantId = restaurants?.[0]?.id as string | undefined;
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

  return NextResponse.json({ cloud: true, orders: mapped });
}

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { cloud: false, error: "NO_OWNER", message: "Ordering isn't live yet on this device." },
      { status: 503 },
    );
  }
  if (!(await resolveOwnerUserId())) {
    return NextResponse.json(
      { cloud: false, error: "NO_OWNER", message: "Ordering isn't live yet on this device." },
      { status: 503 },
    );
  }

  let body: { slug: string; tableToken?: string; tableNumber?: number; items: OrderItemInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const { slug, tableToken, tableNumber, items } = body ?? {};
  if (!slug || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const { data: restaurant } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!restaurant) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  let tableQueried;
  if (tableToken) {
    tableQueried = await supabaseAdmin
      .from("restaurant_tables")
      .select("id, table_number")
      .eq("restaurant_id", restaurant.id)
      .eq("qr_token", tableToken)
      .single();
  } else if (typeof tableNumber === "number") {
    tableQueried = await supabaseAdmin
      .from("restaurant_tables")
      .select("id, table_number")
      .eq("restaurant_id", restaurant.id)
      .eq("table_number", tableNumber)
      .single();
  } else {
    return NextResponse.json({ cloud: false, error: "BAD_TABLE" }, { status: 404 });
  }
  const table = tableQueried.data as
    | { id: string; table_number: number }
    | null
    | undefined;
  if (tableQueried.error || !table) {
    return NextResponse.json({ cloud: false, error: "BAD_TABLE" }, { status: 404 });
  }

  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  const total = items.reduce((sum, i) => sum + (i.price ?? 0) * (i.qty ?? 0), 0);
  const sorted = [...items].sort((a, b) => b.qty - a.qty);

  const { data: lastToday } = await supabaseAdmin
    .from("orders")
    .select("daily_order_number")
    .eq("restaurant_id", restaurant.id)
    .gte("created_at", dayStart)
    .order("daily_order_number", { ascending: false })
    .limit(1);
  const nextNumber = (lastToday?.[0]?.daily_order_number as number) ?? 1000 + 1;

  const { data: order, error: oErr } = await supabaseAdmin
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
  if (oErr || !order) {
    return NextResponse.json({ cloud: false, error: "CREATE_ORDER" }, { status: 500 });
  }

  const { error: iErr } = await supabaseAdmin.from("order_items").insert(
    sorted.map((i) => ({
      order_id: order.id,
      product_id: i.productId,
      product_name_snapshot: i.name,
      quantity: i.qty,
      price_snapshot: i.price,
    })),
  );

  if (iErr) {
    await supabaseAdmin.from("orders").delete().eq("id", order.id);
    return NextResponse.json(
      { cloud: false, error: "CREATE_ITEMS" },
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
      status: "pending",
      items: sorted.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      total,
    },
  });
}