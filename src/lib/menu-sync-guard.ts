import { BUSINESS_TYPES } from "./constants";
import type {
  MenuSyncCategory,
  MenuSyncPayload,
  MenuSyncProduct,
  MenuSyncRestaurant,
  MenuSyncTable,
} from "./menu-mapping";

/**
 * Server-side guards for the menu sync (`PUT /api/menu`) endpoint.
 *
 * Pure functions — no I/O — so the ownership and validation rules are unit
 * testable. The route layers these on top of the persistence upserts to
 * close the cross-restaurant IDOR (products/tables/categories upserted by id
 * could otherwise rewrite rows owned by another restaurant).
 *
 * `validateSyncPayload` also *rebuilds* the payload: the route persists the
 * normalized copy it returns, never the caller's raw JSON.
 */

export const SYNC_LIMITS = {
  categories: 60,
  products: 500,
  tables: 60,
  nameMax: 80,
  descriptionMax: 300,
  slugMax: 63,
} as const;

export interface OwnedRow {
  id: string;
  restaurantId: string | null;
}

export interface SyncOwnershipModel {
  restaurantId: string;
  incoming: {
    categoryIds: string[];
    productIds: string[];
    tableIds: string[];
    /** category ids referenced by products (must resolve to ours) */
    referencedCategoryIds: string[];
  };
  foreign: {
    categories: OwnedRow[];
    products: OwnedRow[];
    tables: OwnedRow[];
    referencedCategories: OwnedRow[];
  };
}

export interface SyncConflict {
  kind: "category" | "product" | "table" | "categoryRef";
  ids: string[];
}

/** Ids that already exist in the DB and belong to another restaurant. */
export function findConflicts(ids: string[], foreign: OwnedRow[]): string[] {
  const foreignIds = new Set(foreign.map((r) => r.id));
  return ids.filter((id) => foreignIds.has(id));
}

export function findSyncConflicts(model: SyncOwnershipModel): SyncConflict[] {
  const conflicts: SyncConflict[] = [];
  const category = findConflicts(model.incoming.categoryIds, model.foreign.categories);
  if (category.length) conflicts.push({ kind: "category", ids: category });
  const product = findConflicts(model.incoming.productIds, model.foreign.products);
  if (product.length) conflicts.push({ kind: "product", ids: product });
  const table = findConflicts(model.incoming.tableIds, model.foreign.tables);
  if (table.length) conflicts.push({ kind: "table", ids: table });
  const categoryRef = findConflicts(
    model.incoming.referencedCategoryIds,
    model.foreign.referencedCategories,
  );
  if (categoryRef.length) conflicts.push({ kind: "categoryRef", ids: categoryRef });
  return conflicts;
}

export interface SyncIssue {
  field: string;
  message: string;
}

export type ValidateSyncResult =
  | { ok: true; payload: MenuSyncPayload }
  | { ok: false; issues: SyncIssue[] };

const HTTP_URL_RE = /^https?:\/\/.+/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = new RegExp(`^[a-z0-9-]{1,${SYNC_LIMITS.slugMax}}$`);
/** `hexToRgba` renders anything but the 6-digit form as white — reject those. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function label(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  return s.length > 12 ? `${s.slice(0, 12)}...` : s;
}

const NOUN: Record<"categories" | "products" | "tables", string> = {
  categories: "category",
  products: "product",
  tables: "table",
};

/**
 * Ids are written into `uuid` columns and reused as `onConflict:"id"` upsert
 * keys, so a non-uuid is rejected by Postgres and a repeated one fails the
 * whole statement (SQLSTATE 21000). Both are rejected here instead.
 */
function checkId(
  issues: SyncIssue[],
  field: "categories" | "products" | "tables",
  seen: Set<string>,
  id: unknown,
): void {
  const noun = NOUN[field];
  if (typeof id !== "string" || !id) {
    issues.push({ field, message: `${noun} id missing` });
    return;
  }
  if (!UUID_RE.test(id)) {
    issues.push({ field, message: `${noun} id must be a uuid (${label(id)})` });
    return;
  }
  if (seen.has(id)) {
    issues.push({ field, message: `duplicate ${noun} id ${label(id)}` });
    return;
  }
  seen.add(id);
}

export function validateSyncPayload(raw: unknown): ValidateSyncResult {
  const issues: SyncIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      issues: [{ field: "body", message: "payload must be an object" }],
    };
  }
  const payload = raw as {
    restaurant?: Partial<MenuSyncRestaurant>;
    categories?: Partial<MenuSyncCategory>[];
    products?: Partial<MenuSyncProduct>[];
    tables?: Partial<MenuSyncTable>[];
  };

  const cats = payload.categories;
  const prods = payload.products;
  const tables = payload.tables;
  if (!Array.isArray(cats) || !Array.isArray(prods) || !Array.isArray(tables)) {
    if (!Array.isArray(cats)) issues.push({ field: "categories", message: "must be an array" });
    if (!Array.isArray(prods)) issues.push({ field: "products", message: "must be an array" });
    if (!Array.isArray(tables)) issues.push({ field: "tables", message: "must be an array" });
    return { ok: false, issues };
  }

  if (cats.length > SYNC_LIMITS.categories)
    issues.push({ field: "categories", message: `too many categories (max ${SYNC_LIMITS.categories})` });
  if (prods.length > SYNC_LIMITS.products)
    issues.push({ field: "products", message: `too many products (max ${SYNC_LIMITS.products})` });
  if (tables.length > SYNC_LIMITS.tables)
    issues.push({ field: "tables", message: `too many tables (max ${SYNC_LIMITS.tables})` });

  const catIds = new Set<string>();
  for (const c of cats) {
    checkId(issues, "categories", catIds, c.id);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > SYNC_LIMITS.nameMax)
      issues.push({ field: "categories", message: `category name invalid (${label(c.id)})` });
  }

  const productIds = new Set<string>();
  for (const p of prods) {
    checkId(issues, "products", productIds, p.id);
    const key = label(p.id);
    if (typeof p.categoryId !== "string" || !catIds.has(p.categoryId))
      issues.push({ field: "products", message: `product ${key} references unknown category ${label(p.categoryId)}` });
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > SYNC_LIMITS.nameMax)
      issues.push({ field: "products", message: `product ${key} name invalid` });
    if (
      typeof p.price !== "number" ||
      !Number.isFinite(p.price) ||
      p.price < 0 ||
      p.price > 999_999
    )
      issues.push({ field: "products", message: `product ${key} price must be a finite number in [0, 999999]` });
    if (p.imageUrl != null && p.imageUrl !== "" && !HTTP_URL_RE.test(p.imageUrl))
      issues.push({ field: "products", message: `product ${key} imageUrl must be an http(s) URL` });
    if (typeof p.description !== "string" || p.description.length > SYNC_LIMITS.descriptionMax)
      issues.push({ field: "products", message: `product ${key} description invalid` });
    if (p.isAvailable !== undefined && typeof p.isAvailable !== "boolean")
      issues.push({ field: "products", message: `product ${key} isAvailable must be a boolean` });
  }

  const tableIds = new Set<string>();
  const tokens = new Set<string>();
  const numbers = new Set<number>();
  for (const t of tables) {
    checkId(issues, "tables", tableIds, t.id);
    if (typeof t.number !== "number" || !Number.isInteger(t.number) || t.number < 1 || t.number > 9999) {
      issues.push({ field: "tables", message: `table number must be an integer in [1, 9999] (${label(t.id)})` });
    } else if (numbers.has(t.number)) {
      // `restaurant_tables (restaurant_id, table_number)` is UNIQUE, so the
      // upsert would fail with 23505 and block the whole sync.
      issues.push({ field: "tables", message: `duplicate table number ${t.number} (${label(t.id)})` });
    } else {
      numbers.add(t.number);
    }
    if (typeof t.token !== "string" || !t.token || t.token.length > 128) {
      issues.push({ field: "tables", message: `table token invalid (${label(t.id)})` });
    } else if (tokens.has(t.token)) {
      // Two rows sharing a token make `maybeSingle()` error, so every order
      // from those tables would 404 forever.
      issues.push({ field: "tables", message: `duplicate table token (${label(t.id)})` });
    } else {
      tokens.add(t.token);
    }
  }

  const r = payload.restaurant;
  if (!r || typeof r !== "object") {
    return {
      ok: false,
      issues: [...issues, { field: "restaurant", message: "restaurant object required" }],
    };
  }

  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > SYNC_LIMITS.nameMax)
    issues.push({ field: "restaurant", message: "name invalid" });
  if (typeof r.slug !== "string" || !SLUG_RE.test(r.slug))
    issues.push({ field: "restaurant", message: "slug invalid (lowercase letters, digits, hyphens)" });
  if (typeof r.tagline !== "string" || r.tagline.length > 160)
    issues.push({ field: "restaurant", message: "tagline invalid" });
  if (typeof r.primaryColor !== "string" || !HEX_COLOR_RE.test(r.primaryColor))
    issues.push({ field: "restaurant", message: "primaryColor invalid (#RRGGBB)" });
  if (!BUSINESS_TYPES.some((b) => b.value === r.businessType))
    issues.push({ field: "restaurant", message: "businessType invalid" });
  if (r.isPublished !== undefined && typeof r.isPublished !== "boolean")
    issues.push({ field: "restaurant", message: "isPublished must be a boolean" });
  for (const url of [r.logoUrl, r.coverUrl]) {
    if (url != null && url !== "" && !HTTP_URL_RE.test(url))
      issues.push({ field: "restaurant", message: "logoUrl/coverUrl must be http(s) or null" });
  }

  if (issues.length > 0) return { ok: false, issues };

  // Rebuild: everything below was inspected above, so the route can persist
  // this object as-is. Handing back the caller's raw object is what let
  // unchecked values (position, isAvailable, isPublished) reach the upserts.
  return {
    ok: true,
    payload: {
      restaurant: {
        name: r.name ?? "",
        slug: r.slug ?? "",
        tagline: r.tagline ?? "",
        businessType: r.businessType ?? "",
        logoUrl: r.logoUrl ?? null,
        coverUrl: r.coverUrl ?? null,
        primaryColor: r.primaryColor ?? "",
        theme: r.theme ?? "classic",
        isPublished: r.isPublished === true,
      },
      categories: cats.map((c) => ({
        id: c.id ?? "",
        name: c.name ?? "",
        position:
          typeof c.position === "number" && Number.isInteger(c.position) ? c.position : 0,
      })),
      products: prods.map((p) => ({
        id: p.id ?? "",
        categoryId: p.categoryId ?? "",
        name: p.name ?? "",
        description: p.description ?? "",
        price: p.price ?? 0,
        imageUrl: p.imageUrl || null,
        isAvailable: p.isAvailable !== false,
        position:
          typeof p.position === "number" && Number.isInteger(p.position) ? p.position : 0,
      })),
      tables: tables.map((t) => ({
        id: t.id ?? "",
        number: t.number ?? 0,
        token: t.token ?? "",
      })),
    },
  };
}