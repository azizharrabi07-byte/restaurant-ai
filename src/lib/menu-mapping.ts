import { slugify, hexToRgba } from "@/lib/utils";
import { BRAND_PALETTE, DEFAULT_COLOR, type BrandColor } from "@/lib/constants";
import { SYNC_LIMITS } from "@/lib/menu-sync-guard";

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
  position: number;
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

/**
 * The public slug is printed on QR standees and written only when the
 * restaurant row is created, so it must be non-empty, bounded and unique.
 * `slugify` strips every non-ASCII character, so an Arabic or accented name
 * collapses to its "my-cafe" fallback — a second such restaurant could then
 * never publish (every save would answer 409 SLUG_TAKEN). Suffix that
 * fallback with a value derived from ids the payload already carries (stable
 * for a given restaurant), falling back to a hash of the name.
 */
function menuSlug(state: {
  restaurantName: string;
  categories: { id: string }[];
  products: { id: string }[];
  tables: { id: string }[];
}): string {
  const name = state.restaurantName.trim();
  if (/[a-z0-9]/i.test(name)) return slugify(name).slice(0, SYNC_LIMITS.slugMax);

  const stableId =
    state.tables[0]?.id ?? state.categories[0]?.id ?? state.products[0]?.id ?? "";
  const suffix =
    stableId.replace(/[^0-9a-f]/gi, "").slice(0, 6).toLowerCase() || nameHash(name);
  return `${slugify(name)}-${suffix}`.slice(0, SYNC_LIMITS.slugMax);
}

/** FNV-1a — a stable suffix for names that contain no ASCII letter or digit. */
function nameHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(6, "0").slice(0, 6);
}

export function menuPayloadFromState(state: {
  restaurantName: string;
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
  return {
    restaurant: {
      name: state.restaurantName.trim(),
      // Baked into printed QR codes: written only when the row is created
      // (see PUT /api/menu) and bounded so long names still pass the guard.
      slug: menuSlug(state),
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
    products: state.products.map((p, index) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description ?? "",
      price: p.price,
      imageUrl: p.image,
      isAvailable: p.isAvailable ?? true,
      position: index,
    })),
    tables: state.tables.map((t) => ({
      id: t.id,
      number: t.number,
      token: t.token,
    })),
  };
}