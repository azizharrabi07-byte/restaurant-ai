import { NextResponse } from "next/server";
import { supabaseAdmin, resolveOwnerUserId } from "@/lib/supabase-admin";
import { isMenuTheme } from "@/lib/constants";
import {
  type MenuGetResponse,
  type MenuSyncPayload,
} from "@/lib/menu-mapping";

const EMPTY: MenuGetResponse = {
  source: "empty",
  restaurant: null,
  categories: [],
  products: [],
  tables: [],
};

export async function GET() {
  if (!supabaseAdmin) return NextResponse.json(EMPTY);

  const ownerId = await resolveOwnerUserId();
  if (!ownerId) return NextResponse.json(EMPTY);

  const { data: restaurants, error: rErr } = await supabaseAdmin
    .from("restaurants")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (rErr) {
    return NextResponse.json(EMPTY, { status: 200 });
  }

  const restaurant = restaurants?.[0];
  if (!restaurant) return NextResponse.json(EMPTY);

  const [{ data: categories }, { data: products }, { data: tables }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("products")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("restaurant_tables")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("table_number", { ascending: true }),
    ]);

  return NextResponse.json({
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
  } satisfies MenuGetResponse);
}

export async function PUT(req: Request) {
  if (!supabaseAdmin) {
    // Not configured — client keeps working in local mode.
    return NextResponse.json({ cloud: false, error: "NO_OWNER" });
  }

  let payload: MenuSyncPayload;
  try {
    payload = (await req.json()) as MenuSyncPayload;
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }

  const ownerId = await resolveOwnerUserId();
  if (!ownerId) {
    return NextResponse.json({ cloud: false, error: "NO_OWNER" });
  }

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
        return NextResponse.json({ cloud: false, error: "INSERT_RESTAURANT" }, { status: 500 });
      }
      restaurantId = created.id;
    }
  }

  // 2. Reconcile categories (upsert by id, then delete removed ones).
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
      await supabaseAdmin
        .from("products")
        .delete()
        .in("category_id", removedCatIds);
      await supabaseAdmin
        .from("categories")
        .delete()
        .in("id", removedCatIds);
    }
  }

  // 3. Reconcile products.
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
      await supabaseAdmin.from("products").delete().in("id", removedProdIds);
    }
  }

  // 4. Reconcile tables (QR stands).
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
        .in("id", removedTableIds);
    }
  }

  return NextResponse.json({ cloud: true, restaurantId });
}