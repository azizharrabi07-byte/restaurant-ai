import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionAuthClient, supabaseAdmin } from "@/lib/supabase-admin";
import { setOwnerSessionCookie } from "@/lib/owner-auth";
import { checkRateLimit, retryAfterHeaders } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string({ invalid_type_error: "email must be a string" }).trim().toLowerCase().email("valid email required"),
  password: z.string({ invalid_type_error: "password must be a string" }).min(8, "password must be at least 8 characters").max(72),
  name: z.string({ invalid_type_error: "name must be a string" }).trim().max(80).optional(),
});

/**
 * First-run owner signup. Creates a real auth account and binds it to the
 * restaurant rows currently owned by the auto-provisioned placeholder owner
 * (owner@sufra.app) or, if none exists, to an unowned first restaurant. If a
 * real (non-placeholder) owner already owns restaurants, signup is rejected so
 * this can never hijack an existing store.
 */

function isPlaceholderOwner(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase() === process.env.SUFRA_PLACEHOLDER_OWNER_EMAIL?.toLowerCase());
}

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }
  // Throttled before any DB work: this route both answers whether an address
  // exists (EMAIL_TAKEN) and creates confirmed auth users through the
  // service-role client, so it must not be free to script.
  const rate = checkRateLimit(req, "signup", { limit: 5, windowMs: 600_000 });
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
    const first = parsed.error.errors[0];
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: first?.message ?? "Invalid input." }, { status: 400 });
  }

  // Resolve current ownership.
  let placeholderOwnerId: string | null = null;
  {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const placeholder = list?.users?.find((u) =>
      isPlaceholderOwner(u.email) || u.email?.toLowerCase() === "owner@sufra.app",
    );
    placeholderOwnerId = placeholder?.id ?? null;
  }

  const { data: restaurants } = await supabaseAdmin
    .from("restaurants")
    .select("id, owner_id")
    .limit(100);

  const ownedByPlaceholder = restaurants?.filter((r) => r.owner_id === placeholderOwnerId) ?? [];
  const ownedByOthers = restaurants?.filter((r) => r.owner_id !== placeholderOwnerId && r.owner_id) ?? [];

  if (ownedByOthers.length > 0 && ownedByPlaceholder.length === 0) {
    return NextResponse.json({ cloud: false, error: "OWNER_EXISTS", message: "This restaurant already has an owner." }, { status: 409 });
  }

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      sufra: "owner",
      source: "signup",
    },
  });

  if (createErr || !created?.user) {
    if ((createErr?.message ?? "").toLowerCase().includes("already")) {
      return NextResponse.json({ cloud: false, error: "EMAIL_TAKEN", message: "That email is already registered." }, { status: 409 });
    }
    return NextResponse.json({ cloud: false, error: "CREATE_USER", message: "Couldn't create this account." }, { status: 500 });
  }

  // Bind placeholder-owned restaurants (or an unowned restaurant) to the new
  // owner. A binding that fails leaves the account owning nothing, so report
  // it instead of returning a success the owner cannot act on.
  const targetIds = ownedByPlaceholder.map((r) => r.id as string);
  if (targetIds.length > 0) {
    for (const id of targetIds) {
      const { error: bindErr } = await supabaseAdmin
        .from("restaurants")
        .update({ owner_id: created.user.id })
        .eq("id", id);
      if (bindErr) {
        return NextResponse.json(
          { cloud: false, error: "PROVISION_FAILED", message: "Your account was created, but the restaurant could not be linked. Please sign in and try again." },
          { status: 500 },
        );
      }
    }
  } else if (ownedByOthers.length === 0 && (restaurants?.length ?? 0) === 1) {
    const { data: bound, error: bindErr } = await supabaseAdmin
      .from("restaurants")
      .update({ owner_id: created.user.id })
      .eq("owner_id", null)
      .select("id");
    if (bindErr || !bound?.length) {
      return NextResponse.json(
        { cloud: false, error: "PROVISION_FAILED", message: "Your account was created, but the restaurant could not be linked. Please sign in and try again." },
        { status: 500 },
      );
    }
  }

  // Auto sign-in with the fresh account so no separate login step is needed.
  // Throwaway client — see the note in src/lib/supabase-admin.ts: signing in on
  // the shared client would re-authenticate this whole process as the new user.
  const auth = createSessionAuthClient();
  const { data: sessionData, error: sessionErr } = await auth!.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (sessionErr || !sessionData?.session) {
    // The account exists but carries no session: reporting 200 here would land
    // the owner on /dashboard and bounce them straight back to /auth/login.
    return NextResponse.json(
      { cloud: false, error: "SESSION", message: "Your account was created, but signing in failed. Please sign in." },
      { status: 500 },
    );
  }

  const res = NextResponse.json({
    cloud: true,
    user: { id: created.user.id, email: created.user.email },
  });
  setOwnerSessionCookie(res, sessionData.session.access_token, sessionData.session.refresh_token);

  return res;
}