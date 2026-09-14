import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import { INVITE_TTL_MS, newInviteToken } from "@/lib/worker-invite";
import { checkRateLimit, retryAfterHeaders } from "@/lib/rate-limit";
import type { WorkerRole } from "@/lib/constants";

const schema = z.object({
  role: z.enum(["Cashier", "Manager"]),
});

/**
 * Owner-only: mint a one-time worker invite for the owner's restaurant.
 * The token is generated server-side with crypto randomness and returned in
 * the response — any client-supplied token is ignored.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  // Minting a redeemable credential is throttled like every other limited
  // route: an owner session must not be able to create them without bound.
  const rate = checkRateLimit(req, "worker-invite", { limit: 20, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { cloud: false, error: "RATE_LIMITED", message: `try again in ${rate.retryAfterSeconds}s` },
      { status: 429, headers: retryAfterHeaders(rate) },
    );
  }

  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "role must be Cashier or Manager" }, { status: 400 });
  }
  const role = parsed.data.role as WorkerRole;

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", session.user.userId)
    .order("created_at", { ascending: true })
    .limit(1);
  const restaurantId = restaurants?.[0]?.id as string | undefined;
  if (!restaurantId) {
    return NextResponse.json({ cloud: false, error: "NO_RESTAURANT" }, { status: 404 });
  }

  const inviteToken = newInviteToken();
  const { error } = await supabaseAdmin.from("worker_invites").insert({
    restaurant_id: restaurantId,
    invite_token: inviteToken,
    role,
    is_used: false,
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  if (error) {
    return NextResponse.json({ cloud: false, error: "CREATE_INVITE" }, { status: 500 });
  }

  return attachOwnerSessionRotation(
    NextResponse.json({ cloud: true, inviteToken, role }),
    session,
  );
}