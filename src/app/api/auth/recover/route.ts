import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string({ invalid_type_error: "email must be a string" }).trim().toLowerCase().email("valid email required"),
});

function appBase(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/**
 * Request a password-recovery email. Always returns success (even for
 * unknown emails or mailer failures) so the endpoint cannot be used to
 * enumerate registered accounts.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: true });
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
      redirectTo: `${appBase(req)}/auth/reset`,
    });
  } catch {
    /* generic success regardless */
  }
  return NextResponse.json({ cloud: true });
}