import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { WORKER_SESSION_COOKIE, WORKER_SESSION_MAX_AGE } from "@/lib/worker-auth";
import { newWorkerSessionToken } from "@/lib/worker-invite";
import { checkRateLimit } from "@/lib/rate-limit";
import type { WorkerRole } from "@/lib/constants";

const schema = z.object({
  token: z
    .string({ invalid_type_error: "token must be a string" })
    .trim()
    .min(8, "invalid invite")
    .max(128, "invalid invite"),
  name: z
    .string({ invalid_type_error: "name must be a string" })
    .trim()
    .min(1, "name is required")
    .max(80, "name must be at most 80 characters"),
});

function isWorkerRole(v: unknown): v is WorkerRole {
  return v === "Cashier" || v === "Manager";
}

/**
 * Public: redeem a one-time invite. The claim
 * (`is_used=false → true`) is conditional so concurrent redemptions can't
 * both succeed; role comes from the stored invite, never the client.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const rate = checkRateLimit(req, "worker-accept", { limit: 20, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { cloud: false, error: "RATE_LIMITED", message: `try again in ${rate.retryAfterSeconds}s` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: first?.message ?? "Invalid input." }, { status: 400 });
  }

  const { data: invite } = await supabaseAdmin
    .from("worker_invites")
    .select("id, restaurant_id, role, expires_at, is_used")
    .eq("invite_token", parsed.data.token)
    .maybeSingle();

  if (
    !invite ||
    (invite.is_used as boolean) === true ||
    (invite.expires_at && new Date(invite.expires_at as string).getTime() < Date.now())
  ) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (!isWorkerRole(invite.role)) {
    return NextResponse.json({ cloud: false, error: "NOT_FOUND" }, { status: 404 });
  }

  // Create the worker BEFORE claiming, so a failed insert never burns the
  // invite. If the later claim loses a concurrent race, the orphan row is
  // removed and the loser gets 409.
  const sessionToken = newWorkerSessionToken();
  const { data: worker, error: wErr } = await supabaseAdmin
    .from("workers")
    .insert({
      id: randomUUID(),
      restaurant_id: invite.restaurant_id,
      full_name: parsed.data.name,
      role: invite.role,
      session_token: sessionToken,
    })
    .select("id, full_name, role")
    .single();

  if (wErr || !worker) {
    const msg = (wErr?.message ?? "").toLowerCase();
    const code = (wErr as { code?: string } | null)?.code;
    if (code === "42703" || msg.includes("session_token")) {
      // `session_token` column missing — migration 1002 not applied yet.
      return NextResponse.json(
        { cloud: false, error: "NEEDS_MIGRATION", message: "Worker login needs a database update. Ask the owner to run the migration." },
        { status: 503 },
      );
    }
    return NextResponse.json({ cloud: false, error: "CREATE_WORKER" }, { status: 500 });
  }

  // Conditional claim: only the first concurrent redeemer wins.
  const { data: claimed } = await supabaseAdmin
    .from("worker_invites")
    .update({ is_used: true })
    .eq("id", invite.id)
    .eq("is_used", false)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    await supabaseAdmin.from("workers").delete().eq("id", worker.id);
    return NextResponse.json({ cloud: false, error: "ALREADY_USED" }, { status: 409 });
  }

  // Best-effort: record which worker consumed the invite.
  await supabaseAdmin
    .from("worker_invites")
    .update({ used_by: worker.id })
    .eq("id", invite.id);

  const res = NextResponse.json({
    cloud: true,
    worker: {
      id: worker.id as string,
      name: (worker.full_name as string) ?? parsed.data.name,
      role: worker.role as WorkerRole,
    },
  });
  res.cookies.set(WORKER_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WORKER_SESSION_MAX_AGE,
  });
  return res;
}