import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Public: describe an invite so the accept page can render the restaurant
 * name and role from the server instead of trusting URL parameters.
 * Returns 404 for unknown/used/expired invites without distinguishing why.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  const { token } = await params;
  const clean = (token ?? "").trim().slice(0, 128);
  if (!clean) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { data: invite } = await supabaseAdmin
    .from("worker_invites")
    .select("role, expires_at, restaurant: restaurants(name, primary_color)")
    .eq("invite_token", clean)
    .eq("is_used", false)
    .maybeSingle();

  if (!invite || (invite.expires_at && new Date(invite.expires_at as string).getTime() < Date.now())) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const restaurant = invite.restaurant as { name?: string; primary_color?: string } | null;
  return NextResponse.json({
    cloud: true,
    invite: {
      role: invite.role,
      restaurantName: restaurant?.name ?? "",
      brandColor: restaurant?.primary_color ?? null,
      expiresAt: invite.expires_at,
    },
  });
}