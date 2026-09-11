import { slugify, hexToRgba } from "@/lib/utils";
import { BRAND_PALETTE, DEFAULT_COLOR, type BrandColor } from "@/lib/constants";

export const MENU_SYNC_KEY = "sufra.menu.v1";

export interface MenuSyncRestaurant {
  name: string;
  slug: string;
  tagline: string;
  businessType: string;
  logoUrl: string | null;
  coverUrl: string | null;
  primaryColor: string;
  theme: string;
  isPublished: boolean;
}

export interface MenuSyncCategory {
  id: string;
  name: string;
  position: number;
}

export interface MenuSyncProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
}

export interface MenuSyncTable {
  id: string;
  number: number;
  token: string;
}

export interface MenuSyncPayload {
  restaurant: MenuSyncRestaurant;
  categories: MenuSyncCategory[];
  products: MenuSyncProduct[];
  tables: MenuSyncTable[];
}

export interface MenuGetResponse {
  source: "supabase" | "empty";
  restaurant: null | (MenuSyncRestaurant & { id: string });
  categories: MenuSyncCategory[];
  products: MenuSyncProduct[];
  tables: MenuSyncTable[];
}

export interface MenuSyncResult {
  cloud: boolean;
  error?: string;
  restaurantId?: string;
}

export function colorFromHex(hex?: string | null): BrandColor {
  const value = (hex ?? "").trim();
  const found = BRAND_PALETTE.find(
    (p) => p.value.toLowerCase() === value.toLowerCase(),
  );
  if (found) return found;
  const fallback = DEFAULT_COLOR.value;
  return {
    id: "custom",
    name: "Custom",
    value: value || fallback,
    accentBg: hexToRgba(value || fallback, 0.15),
    category: "Custom",
  };
}

export function menuPayloadFromState(state: {
  restaurantName: string;
  restaurantSlug?: string;
  tagline: string;
  businessType: string;
  logo: string | null;
  cover: string | null;
  brandColor: BrandColor;
  theme: string;
  categories: { id: string; name: string; position: number }[];
  products: {
    id: string;
    categoryId: string;
    name: string;
    description: string;
    price: number;
    image: string | null;
    isAvailable: boolean;
  }[];
  tables: { id: string; number: number; token: string }[];
}): MenuSyncPayload {
  const name = state.restaurantName.trim();
  const computedSlug = slugify(name || "my-cafe");
  const slug = state.restaurantSlug || computedSlug;
  return {
    restaurant: {
      name,
      slug,
      tagline: state.tagline.trim(),
      businessType: state.businessType,
      logoUrl: state.logo,
      coverUrl: state.cover,
      primaryColor: state.brandColor.value,
      theme: state.theme,
      isPublished: true,
    },
    categories: state.categories.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
    })),
    products: state.products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description ?? "",
      price: p.price,
      imageUrl: p.image,
      isAvailable: p.isAvailable ?? true,
    })),
    tables: state.tables.map((t) => ({
      id: t.id,
      number: t.number,
      token: t.token,
    })),
  };
}