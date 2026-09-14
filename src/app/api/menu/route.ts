import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import { getWorkerSession } from "@/lib/worker-auth";
import { isMenuTheme } from "@/lib/constants";
import {
  type MenuGetResponse,
  type MenuSyncPayload,
} from "@/lib/menu-mapping";
import {
  findSyncConflicts,
  type OwnedRow,
  type SyncConflict,
  validateSyncPayload,
} from "@/lib/menu-sync-guard";

const EMPTY: MenuGetResponse = {
  source: "empty",
  restaurant: null,
  categories: [],
  products: [],
  tables: [],
};

/**
 * Never answer an empty menu on a read error: an empty collection is
 * indistinguishable from a legitimately empty menu, and the client's autosave
 * would PUT that emptiness back — deleting every product and every table, and
 * with them the printed QR standees.
 */
const READ_FAILED = {
  cloud: false,
  error: "READ_FAILED",
  message: "Couldn't load the menu. Please retry.",
} as const;

/**
 * Rows that already exist under another restaurant (or are orphaned: a null
 * restaurant_id is treated as foreign so it is never stolen) must not be
 * upserted by us. `null` means the check itself failed: the caller has to
 * abort, because an unverifiable id is not the same as an id we own.
 */
async function fetchForeignRows(
  table: "categories" | "products" | "restaurant_tables",
  ids: string[],
  restaurantId: string | null,
): Promise<OwnedRow[] | null> {
  if (!supabaseAdmin) return null;
  const rest = ids.filter((id) => typeof id === "string" && id.length > 0);
  // Nothing to check: no id can conflict.
  if (rest.length === 0) return [];

  let query = supabaseAdmin.from(table).select("id, restaurant_id").in("id", rest);
  // Before the restaurant row exists, every matching row is foreign.
  if (restaurantId) {
    query = query.or(`restaurant_id.neq.${restaurantId},restaurant_id.is.null`);
  }
  const { data, error } = await query;
  if (error) return null;
  return (data ?? []).map((r) => ({ id: r.id, restaurantId: r.restaurant_id }));
}

export async function GET(req: Request) {
  if (!supabaseAdmin) return NextResponse.json(EMPTY);

  const owner = await getOwnerSessionForRequest(req);
  const worker = await getWorkerSession(req);
  if (!owner && !worker) return NextResponse.json(EMPTY, { status: 401 });

  let restaurantId: string | null = null;
  if (owner) {
    const { data: restaurants, error: rErr } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("owner_id", owner.user.userId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (rErr) return NextResponse.json(READ_FAILED, { status: 503 });
    restaurantId = restaurants?.[0]?.id ?? null;
  } else {
    restaurantId = worker?.restaurantId ?? null;
  }
  if (!restaurantId) return NextResponse.json(EMPTY);

  const [catsRes, prodsRes, tablesRes] = await Promise.all([
    supabaseAdmin
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("products")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("restaurant_tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("table_number", { ascending: true }),
  ]);

  if (catsRes.error || prodsRes.error || tablesRes.error) {
    return NextResponse.json(READ_FAILED, { status: 503 });
  }
  const categories = catsRes.data;
  const products = prodsRes.data;
  const tables = tablesRes.data;

  const { data: restaurantRows, error: restErr } = await supabaseAdmin
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .limit(1);
  if (restErr) return NextResponse.json(READ_FAILED, { status: 503 });
  const restaurant = restaurantRows?.[0];
  if (!restaurant) return NextResponse.json(EMPTY);

  const body = {
    source: "supabase",
    restaurant: {
      id: restaurant.id,
      name: restaurant.name ?? "",
      slug: restaurant.slug ?? "",
      tagline: restaurant.tagline ?? "",
      businessType: restaurant.business_type ?? "cafe",
      logoUrl: restaurant.logo_url,
      coverUrl: restaurant.cover_image,
      primaryColor: restaurant.primary_color ?? "#D97706",
      theme: restaurant.menu_layout_theme ?? "classic",
      isPublished: restaurant.is_published ?? false,
    },
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      position: c.sort_order ?? 0,
    })),
    products: (products ?? []).map((p) => ({
      id: p.id,
      categoryId: p.category_id,
      name: p.name,
      description: p.description ?? "",
      price: Number(p.price ?? 0),
      imageUrl: p.image_url,
      isAvailable: p.is_available ?? true,
      position: p.sort_order ?? 0,
    })),
    tables: (tables ?? []).map((t) => ({
      id: t.id,
      number: t.table_number,
      token: t.qr_token,
    })),
  } satisfies MenuGetResponse;

  const res = NextResponse.json(body);
  if (owner) return attachOwnerSessionRotation(res, owner);
  return res;
}

export async function PUT(req: Request) {
  if (!supabaseAdmin) {
    // Not configured — client keeps working in local mode.
    return NextResponse.json({ cloud: false, error: "NO_OWNER" });
  }

  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const ownerId = session.user.userId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const validated = validateSyncPayload(raw);
  if (!validated.ok) {
    return NextResponse.json(
      { cloud: false, error: "BAD_PAYLOAD", issues: validated.issues },
      { status: 400 },
    );
  }
  const payload = validated.payload;

  // 1. Resolve the existing restaurant. A read: nothing is written until every
  //    uniqueness and ownership check below has passed.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("restaurants")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (lookupErr) {
    return NextResponse.json({ cloud: false, error: "READ_RESTAURANT" }, { status: 500 });
  }
  const existingId = existing?.[0]?.id ?? null;

  // 2. Slug availability (in-app uniqueness; the DB has no constraint yet).
  //    The slug is baked into printed QR codes, so it is never rewritten after
  //    creation — only a restaurant that does not exist yet can clash, and it
  //    is created with exactly the slug it sent.
  if (!existingId) {
    const { data: clash, error: clashErr } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("slug", payload.restaurant.slug)
      .limit(1);
    if (clashErr) {
      return NextResponse.json({ cloud: false, error: "READ_RESTAURANT" }, { status: 500 });
    }
    if ((clash ?? []).length > 0) {
      return NextResponse.json({ cloud: false, error: "SLUG_TAKEN" }, { status: 409 });
    }
  }

  // 3. Ownership checks — any payload id that already exists under another
  //    restaurant (or is orphaned) is rejected before any write, so a rejected
  //    sync cannot leave a half-updated restaurant behind.
  const categoryIds = payload.categories.map((c) => c.id);
  const productIds = payload.products.map((p) => p.id);
  const tableIds = payload.tables.map((t) => t.id);
  const referencedCategoryIds = [
    ...new Set(payload.products.map((p) => p.categoryId)),
  ];

  const [foreignCats, foreignProds, foreignTables, foreignRefCats] =
    await Promise.all([
      fetchForeignRows("categories", categoryIds, existingId),
      fetchForeignRows("products", productIds, existingId),
      fetchForeignRows("restaurant_tables", tableIds, existingId),
      fetchForeignRows("categories", referencedCategoryIds, existingId),
    ]);
  if (!foreignCats || !foreignProds || !foreignTables || !foreignRefCats) {
    return NextResponse.json(
      { cloud: false, error: "OWNERSHIP_CHECK_FAILED" },
      { status: 500 },
    );
  }

  const conflicts: SyncConflict[] = findSyncConflicts({
    restaurantId: existingId ?? "",
    incoming: { categoryIds, productIds, tableIds, referencedCategoryIds },
    foreign: {
      categories: foreignCats,
      products: foreignProds,
      tables: foreignTables,
      referencedCategories: foreignRefCats,
    },
  });
  if (conflicts.length > 0) {
    return NextResponse.json(
      { cloud: false, error: "FORBIDDEN", conflicting: conflicts },
      { status: 403 },
    );
  }

  // 4. Every check passed — the restaurant row can now be written.
  const r = payload.restaurant;
  const theme = isMenuTheme(r.theme) ? r.theme : "classic";
  let restaurantId: string;
  if (existingId) {
    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({
        name: r.name,
        // `slug` is deliberately absent: it is already printed on QR standees,
        // so the stored value stays authoritative for the public URL.
        tagline: r.tagline,
        business_type: r.businessType,
        logo_url: r.logoUrl,
        cover_image: r.coverUrl,
        primary_color: r.primaryColor,
        menu_layout_theme: theme,
        is_published: r.isPublished,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId);
    if (updateErr) {
      return NextResponse.json({ cloud: false, error: "UPDATE_RESTAURANT" }, { status: 500 });
    }
    restaurantId = existingId;
  } else {
    const { data: created, error: cErr } = await supabaseAdmin
      .from("restaurants")
      .insert({
        owner_id: ownerId,
        name: r.name,
        slug: r.slug,
        business_type: r.businessType,
        currency: "TND",
        logo_url: r.logoUrl,
        primary_color: r.primaryColor,
        cover_image: r.coverUrl,
        tagline: r.tagline,
        menu_layout_theme: theme,
        is_published: r.isPublished,
      })
      .select("id")
      .single();
    if (cErr || !created) {
      if (String(cErr?.message ?? "").toLowerCase().includes("slug"))
        return NextResponse.json({ cloud: false, error: "SLUG_TAKEN" }, { status: 409 });
      return NextResponse.json({ cloud: false, error: "INSERT_RESTAURANT" }, { status: 500 });
    }
    restaurantId = created.id;
  }

  // 5. Reconcile categories (upsert by id, then delete removed ones).
  {
    const rows = payload.categories.map((c) => ({
      id: c.id,
      restaurant_id: restaurantId,
      name: c.name,
      sort_order: c.position,
    }));

    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("categories").upsert(rows, {
        onConflict: "id",
      });
      if (error) {
        return NextResponse.json({ cloud: false, error: "UPSERT_CATEGORIES" }, { status: 500 });
      }
    }

    const { data: currentCats, error: catsErr } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("restaurant_id", restaurantId);
    if (catsErr) {
      return NextResponse.json({ cloud: false, error: "RECONCILE_CATEGORIES" }, { status: 500 });
    }
    const keepIds = new Set(payload.categories.map((c) => c.id));
    const removedCatIds = (currentCats ?? [])
      .map((c) => c.id)
      .filter((id) => !keepIds.has(id));

    if (removedCatIds.length > 0) {
      // Authorization re-check: only delete rows we already confirmed are ours
      // (non-null restaurant_id == restaurantId).
      const { error: delCatErr } = await supabaseAdmin
        .from("categories")
        .delete()
        .in("id", removedCatIds)
        .eq("restaurant_id", restaurantId);
      if (delCatErr) {
        return NextResponse.json({ cloud: false, error: "RECONCILE_CATEGORIES" }, { status: 500 });
      }
      const { data: orphanProducts, error: orphanErr } = await supabaseAdmin
        .from("products")
        .select("id")
        .in("category_id", removedCatIds)
        .eq("restaurant_id", restaurantId);
      if (orphanErr) {
        return NextResponse.json({ cloud: false, error: "RECONCILE_PRODUCTS" }, { status: 500 });
      }
      if ((orphanProducts ?? []).length > 0) {
        const { error: delOrphanErr } = await supabaseAdmin
          .from("products")
          .delete()
          .in("id", (orphanProducts ?? []).map((p) => p.id));
        if (delOrphanErr) {
          return NextResponse.json({ cloud: false, error: "RECONCILE_PRODUCTS" }, { status: 500 });
        }
      }
    }
  }

  // 6. Reconcile products (upsert by id, carry the owner's ordering).
  {
    const rows = payload.products.map((p) => ({
      id: p.id,
      restaurant_id: restaurantId,
      category_id: p.categoryId,
      name: p.name,
      description: p.description ?? "",
      price: p.price,
      image_url: p.imageUrl,
      image_source: "pending",
      is_available: p.isAvailable,
      sort_order: p.position,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("products").upsert(rows, {
        onConflict: "id",
      });
      if (error) {
        return NextResponse.json({ cloud: false, error: "UPSERT_PRODUCTS" }, { status: 500 });
      }
    }

    const { data: currentProd, error: prodsErr } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("restaurant_id", restaurantId);
    if (prodsErr) {
      return NextResponse.json({ cloud: false, error: "RECONCILE_PRODUCTS" }, { status: 500 });
    }
    const keepProdIds = new Set(payload.products.map((p) => p.id));
    const removedProdIds = (currentProd ?? [])
      .map((p) => p.id)
      .filter((id) => !keepProdIds.has(id));
    if (removedProdIds.length > 0) {
      const { error: delProdErr } = await supabaseAdmin
        .from("products")
        .delete()
        .in("id", removedProdIds)
        .eq("restaurant_id", restaurantId);
      if (delProdErr) {
        return NextResponse.json({ cloud: false, error: "RECONCILE_PRODUCTS" }, { status: 500 });
      }
    }
  }

  // 7. Reconcile tables (QR stands).
  {
    const rows = payload.tables.map((t) => ({
      id: t.id,
      restaurant_id: restaurantId,
      table_number: t.number,
      qr_token: t.token,
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("restaurant_tables").upsert(rows, {
        onConflict: "id",
      });
      if (error) {
        return NextResponse.json({ cloud: false, error: "UPSERT_TABLES" }, { status: 500 });
      }
    }
    const { data: currentTables, error: tablesErr } = await supabaseAdmin
      .from("restaurant_tables")
      .select("id")
      .eq("restaurant_id", restaurantId);
    if (tablesErr) {
      return NextResponse.json({ cloud: false, error: "RECONCILE_TABLES" }, { status: 500 });
    }
    const keepTableIds = new Set(payload.tables.map((t) => t.id));
    const removedTableIds = (currentTables ?? [])
      .map((t) => t.id)
      .filter((id) => !keepTableIds.has(id));
    if (removedTableIds.length > 0) {
      const { error: delTableErr } = await supabaseAdmin
        .from("restaurant_tables")
        .delete()
        .in("id", removedTableIds)
        .eq("restaurant_id", restaurantId);
      if (delTableErr) {
        return NextResponse.json({ cloud: false, error: "RECONCILE_TABLES" }, { status: 500 });
      }
    }
  }

  return attachOwnerSessionRotation(
    NextResponse.json({ cloud: true, restaurantId }),
    session,
  );
}