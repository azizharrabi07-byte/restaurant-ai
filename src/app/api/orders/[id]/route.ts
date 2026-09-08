import { NextResponse } from "next/server";
import { supabaseAdmin, resolveOwnerUserId } from "@/lib/supabase-admin";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_OWNER" }, { status: 503 });
  }
  const ownerId = await resolveOwnerUserId();
  if (!ownerId) {
    return NextResponse.json({ cloud: false, error: "NO_OWNER" }, { status: 503 });
  }

  const { id } = await params;
  let body: { status?: string; isPaid?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  // Order must belong to this owner's restaurant.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("restaurant_id")
    .eq("id", id)
    .single();
  if (!order) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", ownerId)
    .limit(1);
  if (restaurants?.[0]?.id !== order.restaurant_id) {
    return NextResponse.json({ cloud: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (body.status) {
    if (body.status === "paid") {
      // The orders table only allows pending/accepted — payment is tracked
      // via the is_paid boolean.
      updates.is_paid = true;
    } else if (body.status === "pending" || body.status === "accepted") {
      updates.status = body.status;
    }
  }
  if (body.isPaid === true) updates.is_paid = true;
  if (updates.is_paid === true) updates.paid_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("orders").update(updates).eq("id", id);
  if (error) {
    return NextResponse.json({ cloud: false, error: "UPDATE" }, { status: 500 });
  }
  return NextResponse.json({ cloud: true });
}