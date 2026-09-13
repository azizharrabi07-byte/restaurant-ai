import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { setOwnerSessionCookie } from "@/lib/owner-auth";

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

  // Bind placeholder-owned restaurants (or an unowned restaurant) to the new owner.
  const targetIds = ownedByPlaceholder.map((r) => r.id as string);
  if (targetIds.length > 0) {
    for (const id of targetIds) {
      await supabaseAdmin.from("restaurants").update({ owner_id: created.user.id }).eq("id", id);
    }
  } else if (ownedByOthers.length === 0 && (restaurants?.length ?? 0) === 1) {
    await supabaseAdmin.from("restaurants").update({ owner_id: created.user.id }).eq("owner_id", null);
  }

  // Auto sign-in with the fresh account so no separate login step is needed.
  const { data: sessionData, error: sessionErr } = await supabaseAdmin.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  const res = NextResponse.json({
    cloud: true,
    user: { id: created.user.id, email: created.user.email },
  });
  if (!sessionErr && sessionData.session) {
    setOwnerSessionCookie(res, sessionData.session.access_token, sessionData.session.refresh_token);
  }

  return res;
}