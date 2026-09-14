import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import {
  DEV_WORKER_SENTINEL_ID,
  getWorkerSession,
} from "@/lib/worker-auth";
import {
  canAcceptOrder,
  canMarkPaid,
  canSetArbitraryStatus,
  normalizeStaffRole,
} from "@/lib/worker-permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for "column does not exist" (pre-migration fallback trigger). */
function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42703") return true;
  const msg = ((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return msg.includes("accepted_by") && (msg.includes("does not exist") || msg.includes("unknown column"));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_OWNER" }, { status: 503 });
  }
  const ownerSession = await getOwnerSessionForRequest(req);
  const workerSession = await getWorkerSession(req);
  if (!ownerSession && !workerSession) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await params;
  // `acceptedByName` is accepted on the wire but deliberately ignored: the
  // display name is read from the resolved worker row, never from the client.
  let body: { status?: string; isPaid?: boolean; acceptedBy?: string; acceptedByName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  // Order must belong to the actor's restaurant.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("restaurant_id")
    .eq("id", id)
    .single();
  if (!order) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  if (workerSession) {
    if (workerSession.restaurantId !== order.restaurant_id) {
      return NextResponse.json({ cloud: false, error: "FORBIDDEN" }, { status: 403 });
    }
  } else {
    // The order's restaurant must be owned by this user (not just "their
    // first restaurant", which breaks multi-restaurant owners and leaks a
    // cross-restaurant oracle).
    const { data: owned } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("id", order.restaurant_id)
      .eq("owner_id", ownerSession!.user.userId)
      .maybeSingle();
    if (!owned) {
      return NextResponse.json({ cloud: false, error: "FORBIDDEN" }, { status: 403 });
    }
  }

  // Role matrix (server-enforced; the client role is UI hint only):
  // owner   → accept, paid, reopen
  // manager → accept, paid
  // cashier → accept only (never paid, never reopen)
  const role = normalizeStaffRole(workerSession ? workerSession.role : "Owner") ?? "Cashier";
  const wantsPaid = body.status === "paid" || body.isPaid === true;
  if (wantsPaid && !canMarkPaid(role)) {
    return NextResponse.json({ cloud: false, error: "FORBIDDEN", message: "Your role cannot mark orders paid." }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (body.status === "paid") {
    // The orders table only allows pending/accepted — payment is tracked
    // via the is_paid boolean.
    updates.is_paid = true;
  } else if (body.status === "accepted") {
    if (canAcceptOrder(role)) updates.status = "accepted";
  } else if (body.status === "pending") {
    // Reopening rewinds the order to the pending column and re-notifies the
    // kitchen; owners alone may rewrite an order's state. Without this gate a
    // cashier could push an already-paid order back to pending while `is_paid`
    // stayed true — a state no dashboard renders.
    if (!canSetArbitraryStatus(role)) {
      return NextResponse.json(
        { cloud: false, error: "FORBIDDEN", message: "Your role cannot reopen orders." },
        { status: 403 },
      );
    }
    updates.status = "pending";
  }

  // Worker attribution comes from the VERIFIED session, never from the body
  // (a worker must not be able to credit someone else). An owner may credit a
  // worker, but only one that belongs to THIS order's restaurant: the id is
  // resolved against the DB and the display name comes from that row, never
  // from the client body.
  //
  // The dev-bypass session resolves to a sentinel id that exists in no table,
  // so it must never be written as attribution — the branch simply falls
  // through, leaving `accepted_by` unset (dev and prod agree).
  if (
    updates.status === "accepted" &&
    workerSession &&
    workerSession.workerId !== DEV_WORKER_SENTINEL_ID
  ) {
    updates.accepted_by = workerSession.workerId;
    updates.accepted_by_name = workerSession.fullName;
  } else if (updates.status === "accepted" && body.acceptedBy !== undefined) {
    if (typeof body.acceptedBy !== "string" || !UUID_RE.test(body.acceptedBy)) {
      return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "acceptedBy must be a worker id." }, { status: 400 });
    }
    const { data: workerRow } = await supabaseAdmin
      .from("workers")
      .select("id, full_name")
      .eq("id", body.acceptedBy)
      .eq("restaurant_id", order.restaurant_id)
      .maybeSingle();
    if (!workerRow) {
      return NextResponse.json(
        { cloud: false, error: "BAD_BODY", message: "acceptedBy is not a worker of this restaurant." },
        { status: 400 },
      );
    }
    updates.accepted_by = workerRow.id as string;
    updates.accepted_by_name = (workerRow.full_name as string | null) ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  let { error } = await supabaseAdmin.from("orders").update(updates).eq("id", id);
  if (error && updates.accepted_by !== undefined && isMissingColumnError(error)) {
    // Pre-migration fallback: accepted_by columns don't exist yet (42703).
    // Retry WITHOUT them so the status change still lands. Any other error
    // is returned as-is — never silently dropped.
    const withoutAcceptedBy = { ...updates };
    delete withoutAcceptedBy.accepted_by;
    delete withoutAcceptedBy.accepted_by_name;
    const retry = await supabaseAdmin
      .from("orders")
      .update(withoutAcceptedBy)
      .eq("id", id);
    error = retry.error;
  }
  if (error) {
    return NextResponse.json({ cloud: false, error: "UPDATE" }, { status: 500 });
  }

  if (ownerSession) {
    return attachOwnerSessionRotation(NextResponse.json({ cloud: true }), ownerSession);
  }
  return NextResponse.json({ cloud: true });
}