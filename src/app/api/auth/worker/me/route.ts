import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getWorkerSession } from "@/lib/worker-auth";

/** Worker self-check: validates the session cookie/bearer against the DB. */
export async function GET(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  const session = await getWorkerSession(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({
    cloud: true,
    worker: {
      id: session.workerId,
      name: session.fullName,
      role: session.role,
      restaurantId: session.restaurantId,
    },
  });
}