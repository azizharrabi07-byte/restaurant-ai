import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { appBaseUrl } from "@/lib/utils";

const schema = z.object({
  email: z.string({ invalid_type_error: "email must be a string" }).trim().toLowerCase().email("valid email required"),
});

/**
 * Request a password-recovery email.
 *
 * Enumeration-safe: for every parsed email — registered, unknown, or one the
 * mailer fails to reach — the response is the same neutral `200 {cloud:true}`.
 * The only non-200 is a backend-wide condition (no mailer configured), which
 * cannot distinguish one account from another. Reporting it is the point: a
 * locked-out owner must not be told a link is on its way when nothing can send.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const rate = checkRateLimit(req, "recover", { limit: 5, windowMs: 600_000 });
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
    return NextResponse.json({ cloud: true });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ cloud: true });
  }

  try {
    await supabaseAdmin.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${appBaseUrl(new URL(req.url).origin)}/auth/reset`,
    });
  } catch {
    /* generic success regardless */
  }
  return NextResponse.json({ cloud: true });
}