import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { setOwnerSessionCookie } from "@/lib/owner-auth";
import { checkRateLimit, retryAfterHeaders } from "@/lib/rate-limit";

const schema = z.object({
  access_token: z.string().min(10, "invalid session").max(8192),
  // Required: the stored session is rotated with the refresh grant, so an
  // access token persisted as its own refresh token would die at the access
  // token TTL with no way to renew.
  refresh_token: z.string({ required_error: "refresh token required" }).min(10, "invalid refresh token").max(8192),
});

/**
 * Complete a Supabase implicit-grant link (e.g. a legacy recovery-link
 * click, which arrives as #access_token=…&refresh_token=… in the URL
 * fragment). The access token is verified server-side before any cookie is
 * set — possession of the emailed link is the authentication factor.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const rate = checkRateLimit(req, "callback", { limit: 10, windowMs: 600_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { cloud: false, error: "RATE_LIMITED", message: `try again in ${rate.retryAfterSeconds}s` },
      { status: 429, headers: retryAfterHeaders(rate) },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "Malformed request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { cloud: false, error: "BAD_BODY", message: parsed.error.errors[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin.auth.getUser(parsed.data.access_token);
  if (error || !data?.user) {
    return NextResponse.json({ cloud: false, error: "INVALID_SESSION", message: "This link is invalid or expired." }, { status: 401 });
  }

  const res = NextResponse.json({ cloud: true, user: { id: data.user.id, email: data.user.email } });
  setOwnerSessionCookie(
    res,
    parsed.data.access_token,
    parsed.data.refresh_token,
  );
  return res;
}