import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { setOwnerSessionCookie } from "@/lib/owner-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string({ invalid_type_error: "email must be a string" }).trim().toLowerCase().email("valid email required"),
  password: z.string({ invalid_type_error: "password must be a string" }).min(6, "password must be at least 6 characters"),
});

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const rate = checkRateLimit(req, "login", { limit: 10, windowMs: 600_000 });
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
    const first = parsed.error.errors[0];
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: first?.message ?? "Invalid input." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.session) {
    return NextResponse.json({ cloud: false, error: "INVALID_CREDENTIALS", message: "Incorrect email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ cloud: true, user: { id: data.user.id, email: data.user.email } });
  setOwnerSessionCookie(res, data.session.access_token, data.session.refresh_token);
  return res;
}