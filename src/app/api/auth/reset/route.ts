import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionAuthClient, supabaseAdmin } from "@/lib/supabase-admin";
import { setOwnerSessionCookie } from "@/lib/owner-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  token_hash: z.string().min(10, "invalid link").max(512),
  type: z.literal("recovery", { invalid_type_error: "invalid link type" }),
  password: z.string({ invalid_type_error: "password must be a string" }).min(8, "password must be at least 8 characters").max(72),
});

/**
 * Complete a password recovery: verify the single-use token from the email
 * link, set the new password, and sign the owner in.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const rate = checkRateLimit(req, "reset", { limit: 10, windowMs: 600_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { cloud: false, error: "RATE_LIMITED", message: `try again in ${rate.retryAfterSeconds}s` },
      { status: 429 },
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
  const { token_hash, type, password } = parsed.data;

  // Throwaway client: `verifyOtp` and `signInWithPassword` both install the
  // resulting session on the client they are called on, and supabase-js then
  // sends that session's token on every later REST request from it. On the
  // shared `supabaseAdmin` that would re-authenticate this whole process as the
  // recovered user. See the header of src/lib/supabase-admin.ts.
  const auth = createSessionAuthClient();
  const { data: verified, error: verifyErr } = await auth!.auth.verifyOtp({
    token_hash,
    type,
  });
  if (verifyErr || !verified?.user?.email) {
    return NextResponse.json(
      { cloud: false, error: "INVALID_LINK", message: "This link is invalid or expired. Request a new one." },
      { status: 400 },
    );
  }

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(verified.user.id, {
    password,
  });
  if (updateErr) {
    return NextResponse.json(
      { cloud: false, error: "UPDATE_FAILED", message: "Couldn't set the new password." },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ cloud: true });
  const { data: sessionData, error: sessionErr } = await auth!.auth.signInWithPassword({
    email: verified.user.email,
    password,
  });
  if (!sessionErr && sessionData.session) {
    setOwnerSessionCookie(res, sessionData.session.access_token, sessionData.session.refresh_token);
  }
  return res;
}