import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import { getWorkerSession } from "@/lib/worker-auth";
import { canMarkPaid, normalizeStaffRole } from "@/lib/worker-permissions";

const VALID_STATUSES = new Set(["pending", "accepted"]);
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
  // cashier → accept only (never paid)
  const role = normalizeStaffRole(workerSession ? workerSession.role : "Owner") ?? "Cashier";
  const wantsPaid = body.status === "paid" || body.isPaid === true;
  if (wantsPaid && !canMarkPaid(role)) {
    return NextResponse.json({ cloud: false, error: "FORBIDDEN", message: "Your role cannot mark orders paid." }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (body.status) {
    if (body.status === "paid") {
      // The orders table only allows pending/accepted — payment is tracked
      // via the is_paid boolean.
      updates.is_paid = true;
    } else if (VALID_STATUSES.has(body.status)) {
      updates.status = body.status;
    }
  }
  if (body.isPaid === true) updates.is_paid = true;
  if (updates.is_paid === true) updates.paid_at = new Date().toISOString();

  // Worker attribution comes from the VERIFIED session, never from the body
  // (a worker must not be able to credit someone else). Owners may pass a
  // worker id, which must be a UUID — anything else is rejected, not stored.
  if (updates.status === "accepted") {
    if (workerSession) {
      updates.accepted_by = workerSession.workerId;
      updates.accepted_by_name = workerSession.fullName;
    } else if (body.acceptedBy !== undefined) {
      if (!UUID_RE.test(body.acceptedBy)) {
        return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "acceptedBy must be a worker id." }, { status: 400 });
      }
      updates.accepted_by = body.acceptedBy;
      if (body.acceptedByName !== undefined) {
        if (typeof body.acceptedByName !== "string" || body.acceptedByName.length > 80) {
          return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "acceptedByName is invalid." }, { status: 400 });
        }
        updates.accepted_by_name = body.acceptedByName;
      }
    }
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