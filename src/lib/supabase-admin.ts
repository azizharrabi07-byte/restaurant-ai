import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service role key.
 * NEVER import this from client components.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseAdmin =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export function hasBackend(): boolean {
  return Boolean(supabaseAdmin);
}

/**
 * `restaurants.owner_id` is a foreign key into Supabase auth.users. Rather
 * than forcing the owner to find a UUID, we resolve the owner from the
 * existing restaurant row; if none exists yet, we auto-provision a
 * dedicated service owner account (once) and reuse it. Server calls run
 * with the service role so they bypass RLS entirely.
 */
const OWNER_EMAIL = "owner@sufra.app";

let cachedOwnerId: string | null | undefined;

export async function resolveOwnerUserId(): Promise<string | null> {
  if (!supabaseAdmin) return null;
  if (cachedOwnerId !== undefined) return cachedOwnerId;

  // Prefer the owner already bound to a restaurant row — this keeps the
  // platform working regardless of the auth account's email address.
  try {
    const { data: existing } = await supabaseAdmin
      .from("restaurants")
      .select("owner_id")
      .order("created_at", { ascending: true })
      .limit(1);
    const ownerId = existing?.[0]?.owner_id as string | undefined;
    if (ownerId) {
      cachedOwnerId = ownerId;
      return ownerId;
    }
  } catch {
    /* fall through to provisioning below */
  }

  try {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existing = list?.users?.find(
      (u) => u.email?.toLowerCase() === OWNER_EMAIL,
    );
    if (existing) {
      cachedOwnerId = existing.id;
      return existing.id;
    }

    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const password =
      [...Array(28)]
        .map(() => chars[Math.floor(Math.random() * chars.length)])
        .join("") + "x9!";

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { sufra: "owner", source: "auto-provision" },
    });
    if (error || !data.user) return null;
    cachedOwnerId = data.user.id;
    return data.user.id;
  } catch {
    return null;
  }
}