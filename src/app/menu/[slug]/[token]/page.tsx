import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { colorFromHex } from "@/lib/menu-mapping";
import { GuestMenu } from "@/components/guest-menu";
import { isMenuTheme, type Category, type Product } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function GuestMenuPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;

  if (!supabaseAdmin) {
    return <GuestMenu unavailable />;
  }

  const { data: restaurant } = await supabaseAdmin
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!restaurant) return notFound();

  const [{ data: categories }, { data: products }, { data: table }] =
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
        .eq("is_available", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("restaurant_tables")
        .select("table_number")
        .eq("restaurant_id", restaurant.id)
        .eq("qr_token", token)
        .single(),
    ]);

  if (!table) return notFound();

  const cats: Category[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    position: c.sort_order ?? 0,
  }));

  const prods: Product[] = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    price: Number(p.price ?? 0),
    categoryId: p.category_id,
    image: p.image_url,
    isAvailable: true,
  }));

  return (
    <GuestMenu
      restaurant={{
        name: restaurant.name ?? "Our Café",
        tagline: restaurant.tagline ?? "",
        logo: restaurant.logo_url,
        cover: restaurant.cover_image,
        brandColor: colorFromHex(restaurant.primary_color),
        slug,
      }}
      theme={isMenuTheme(restaurant.menu_layout_theme) ? restaurant.menu_layout_theme : "classic"}
      categories={cats}
      products={prods}
      tableNumber={table.table_number}
      tableToken={token}
    />
  );
}