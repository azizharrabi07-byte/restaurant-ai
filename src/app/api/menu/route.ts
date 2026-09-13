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

/** Rows whose restaurant_id is null are treated as foreign (don't steal). */
async function fetchForeignRows(
  table: "categories" | "products" | "restaurant_tables",
  ids: string[],
  restaurantId: string,
): Promise<OwnedRow[]> {
  const rest = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (rest.length === 0 || !supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id, restaurant_id")
    .or(`restaurant_id.neq.${restaurantId},restaurant_id.is.null`)
    .in("id", rest);
  if (error) return [];
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
    if (rErr) return NextResponse.json(EMPTY, { status: 200 });
    restaurantId = restaurants?.[0]?.id ?? null;
  } else {
    restaurantId = worker?.restaurantId ?? null;
  }
  if (!restaurantId) return NextResponse.json(EMPTY);

  const [{ data: categories }, { data: products }, { data: tables }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("products")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("restaurant_tables")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("table_number", { ascending: true }),
    ]);

  const { data: restaurantRows } = await supabaseAdmin
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .limit(1);
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

  // 1. Resolve or create the restaurant row.
  let restaurantId: string | null = null;
  {
    const { data: existing } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true })
      .limit(1);
    const r = payload.restaurant;
    const theme = isMenuTheme(r.theme) ? r.theme : "classic";
    if (existing?.[0]?.id) {
      restaurantId = existing[0].id;
      await supabaseAdmin
        .from("restaurants")
        .update({
          name: r.name,
          slug: r.slug,
          tagline: r.tagline,
          business_type: r.businessType,
          logo_url: r.logoUrl,
          cover_image: r.coverUrl,
          primary_color: r.primaryColor,
          menu_layout_theme: theme,
          is_published: r.isPublished,
          updated_at: new Date().toISOString(),
        })
        .eq("id", restaurantId);
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
  }

  if (!restaurantId) {
    return NextResponse.json({ cloud: false, error: "NO_RESTAURANT" }, { status: 500 });
  }

  // 2. Slug availability (in-app uniqueness; DB lacks a constraint).
  {
    const { data: clash } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("slug", payload.restaurant.slug)
      .not("id", "eq", restaurantId)
      .limit(1);
    if ((clash ?? []).length > 0) {
      return NextResponse.json({ cloud: false, error: "SLUG_TAKEN" }, { status: 409 });
    }
  }

  // 3. Ownership checks — any payload id that already exists under another
  //    restaurant (or is orphaned) is rejected before any upsert/delete runs.
  const categoryIds = payload.categories.map((c) => c.id);
  const productIds = payload.products.map((p) => p.id);
  const tableIds = payload.tables.map((t) => t.id);
  const referencedCategoryIds = [
    ...new Set(payload.products.map((p) => p.categoryId)),
  ];

  const conflicts: SyncConflict[] = findSyncConflicts({
    restaurantId,
    incoming: { categoryIds, productIds, tableIds, referencedCategoryIds },
    foreign: {
      categories: await fetchForeignRows("categories", categoryIds, restaurantId),
      products: await fetchForeignRows("products", productIds, restaurantId),
      tables: await fetchForeignRows("restaurant_tables", tableIds, restaurantId),
      referencedCategories: await fetchForeignRows(
        "categories",
        referencedCategoryIds,
        restaurantId,
      ),
    },
  });
  if (conflicts.length > 0) {
    return NextResponse.json(
      { cloud: false, error: "FORBIDDEN", conflicting: conflicts },
      { status: 403 },
    );
  }

  // 4. Reconcile categories (upsert by id, then delete removed ones).
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

    const { data: currentCats } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("restaurant_id", restaurantId);
    const keepIds = new Set(payload.categories.map((c) => c.id));
    const removedCatIds = (currentCats ?? [])
      .map((c) => c.id)
      .filter((id) => !keepIds.has(id));

    if (removedCatIds.length > 0) {
      // Authorization re-check: only delete rows we already confirmed are ours
      // (non-null restaurant_id == restaurantId).
      await supabaseAdmin
        .from("categories")
        .delete()
        .in("id", removedCatIds)
        .eq("restaurant_id", restaurantId);
      const { data: orphanProducts } = await supabaseAdmin
        .from("products")
        .select("id")
        .in("category_id", removedCatIds)
        .eq("restaurant_id", restaurantId);
      if ((orphanProducts ?? []).length > 0) {
        await supabaseAdmin
          .from("products")
          .delete()
          .in("id", (orphanProducts ?? []).map((p) => p.id));
      }
    }
  }

  // 5. Reconcile products.
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
      is_available: p.isAvailable ?? true,
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

    const { data: currentProd } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("restaurant_id", restaurantId);
    const keepProdIds = new Set(payload.products.map((p) => p.id));
    const removedProdIds = (currentProd ?? [])
      .map((p) => p.id)
      .filter((id) => !keepProdIds.has(id));
    if (removedProdIds.length > 0) {
      await supabaseAdmin
        .from("products")
        .delete()
        .in("id", removedProdIds)
        .eq("restaurant_id", restaurantId);
    }
  }

  // 6. Reconcile tables (QR stands).
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
    const { data: currentTables } = await supabaseAdmin
      .from("restaurant_tables")
      .select("id")
      .eq("restaurant_id", restaurantId);
    const keepTableIds = new Set(payload.tables.map((t) => t.id));
    const removedTableIds = (currentTables ?? [])
      .map((t) => t.id)
      .filter((id) => !keepTableIds.has(id));
    if (removedTableIds.length > 0) {
      await supabaseAdmin
        .from("restaurant_tables")
        .delete()
        .in("id", removedTableIds)
        .eq("restaurant_id", restaurantId);
    }
  }

  return attachOwnerSessionRotation(
    NextResponse.json({ cloud: true, restaurantId }),
    session,
  );
}