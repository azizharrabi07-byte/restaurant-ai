import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  password: z.string({ invalid_type_error: "password must be a string" }).min(8, "password must be at least 8 characters").max(72),
});

/** Change the signed-in owner's password (used by the reset flow and settings). */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const rate = checkRateLimit(req, "password", { limit: 10, windowMs: 600_000 });
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

  const { error } = await supabaseAdmin.auth.admin.updateUserById(session.user.userId, {
    password: parsed.data.password,
  });
  if (error) {
    return NextResponse.json(
      { cloud: false, error: "UPDATE_FAILED", message: "Couldn't set the new password." },
      { status: 500 },
    );
  }

  return attachOwnerSessionRotation(NextResponse.json({ cloud: true }), session);
}