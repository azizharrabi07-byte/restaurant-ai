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
  let body: {
    status?: string;
    isPaid?: boolean;
    workerId?: string;
    workerName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  // Order must belong to this owner's restaurant.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, restaurant_id, status, accepted_by")
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

  // ── Accept (claim) logic — first worker to accept wins ─────────
  if (body.status === "accepted") {
    const workerId = (body.workerId ?? "").toString().slice(0, 64);
    const workerName = (body.workerName ?? "").toString().slice(0, 80);

    if (order.status === "accepted" || order.status === "paid") {
      // Already claimed by someone (could be us or another worker).
      // Reload the current row to return the claimant info.
      const { data: current } = await supabaseAdmin
        .from("orders")
        .select("accepted_by, accepted_by_name")
        .eq("id", id)
        .single();
      const alreadyByUs =
        current?.accepted_by && workerId && current.accepted_by === workerId;
      return NextResponse.json(
        {
          cloud: true,
          conflict: !alreadyByUs,
          acceptedBy: current?.accepted_by_name ?? null,
        },
        { status: alreadyByUs ? 200 : 409 },
      );
    }

    if (!workerId || !workerName) {
      return NextResponse.json({ cloud: false, error: "NO_WORKER" }, { status: 400 });
    }

    // Atomic claim: only update if still pending (guards against race
    // conditions between two workers clicking "Accept" at the same time).
    updates.status = "accepted";
    updates.accepted_by = workerId;
    updates.accepted_by_name = workerName;
    updates.accepted_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin
      .from("orders")
      .update(updates)
      .eq("id", id)
      .eq("status", "pending") // ← atomic guard
      .select("id, status, accepted_by, accepted_by_name")
      .maybeSingle();

    if (error) {
      // If new columns haven't been migrated yet, fall back gracefully.
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("accepted_by") || msg.includes("column")) {
        const fallback = { status: "accepted" as const };
        const { data: fbUpdated, error: fbErr } = await supabaseAdmin
          .from("orders")
          .update(fallback)
          .eq("id", id)
          .eq("status", "pending")
          .select("id, status")
          .maybeSingle();
        if (fbErr || !fbUpdated) {
          const { data: snatched } = await supabaseAdmin
            .from("orders")
            .select("accepted_by_name")
            .eq("id", id)
            .single();
          return NextResponse.json(
            {
              cloud: true,
              conflict: true,
              acceptedBy: snatched?.accepted_by_name ?? null,
            },
            { status: 409 },
          );
        }
        return NextResponse.json({ cloud: true, order: fbUpdated });
      }
      return NextResponse.json({ cloud: false, error: "UPDATE" }, { status: 500 });
    }
    if (!updated) {
      // The `eq("status", "pending")` filter didn't match — someone beat us.
      const { data: snatched } = await supabaseAdmin
        .from("orders")
        .select("accepted_by_name")
        .eq("id", id)
        .single();
      return NextResponse.json(
        {
          cloud: true,
          conflict: true,
          acceptedBy: snatched?.accepted_by_name ?? null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ cloud: true, order: updated });
  }

  // ── Mark paid ────────────────────────────────────────────────────
  if (body.status === "paid" || body.isPaid === true) {
    updates.is_paid = true;
    updates.paid_at = new Date().toISOString();
    updates.status = "paid";
  } else if (body.status === "pending") {
    // Allow reopening (un-claim) only by the same worker who claimed it.
    if (
      body.workerId &&
      order.accepted_by &&
      order.accepted_by !== body.workerId
    ) {
      return NextResponse.json(
        { cloud: true, conflict: true, acceptedBy: null },
        { status: 409 },
      );
    }
    updates.status = "pending";
    updates.accepted_by = null;
    updates.accepted_by_name = null;
    updates.accepted_at = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("orders").update(updates).eq("id", id);
  if (error) {
    return NextResponse.json({ cloud: false, error: "UPDATE" }, { status: 500 });
  }
  return NextResponse.json({ cloud: true });
}
