import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";

/** Owner-only: list workers of the owner's restaurant (for revocation). */
export async function GET(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", session.user.userId)
    .order("created_at", { ascending: true })
    .limit(1);
  const restaurantId = restaurants?.[0]?.id as string | undefined;
  if (!restaurantId) {
    return attachOwnerSessionRotation(
      NextResponse.json({ cloud: true, workers: [] }),
      session,
    );
  }

  const { data: workers, error } = await supabaseAdmin
    .from("workers")
    .select("id, full_name, role, created_at")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ cloud: false, error: "LIST_WORKERS" }, { status: 500 });
  }

  return attachOwnerSessionRotation(
    NextResponse.json({
      cloud: true,
      workers: (workers ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        role: w.role,
        createdAt: w.created_at,
      })),
    }),
    session,
  );
}