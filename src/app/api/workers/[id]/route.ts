import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";

/**
 * Owner-only: revoke a worker (deletes the row, which instantly invalidates
 * their session token). Scoped to the owner's restaurant — deleting another
 * restaurant's worker id returns 404.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", session.user.userId);
  const ownedIds = new Set((restaurants ?? []).map((r) => r.id as string));
  if (ownedIds.size === 0) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id, restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!worker || !ownedIds.has(worker.restaurant_id as string)) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from("workers").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ cloud: false, error: "REVOKE_WORKER" }, { status: 500 });
  }

  return attachOwnerSessionRotation(NextResponse.json({ cloud: true }), session);
}