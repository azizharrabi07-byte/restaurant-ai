import type { MenuSyncPayload } from "./menu-mapping";

/**
 * Server-side guards for the menu sync (`PUT /api/menu`) endpoint.
 *
 * Pure functions — no I/O — so the ownership and validation rules are unit
 * testable. The route layers these on top of the persistence upserts to
 * close the cross-restaurant IDOR (products/tables/categories upserted by id
 * could otherwise rewrite rows owned by another restaurant).
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
const SLUG_RE = /^[a-z0-9-]{0,63}$/;

function label(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  return s.length > 12 ? `${s.slice(0, 12)}...` : s;
}

export function validateSyncPayload(raw: unknown): ValidateSyncResult {
  const issues: SyncIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      issues: [{ field: "body", message: "payload must be an object" }],
    };
  }
  const payload = raw as Partial<MenuSyncPayload>;

  if (!Array.isArray(payload.categories))
    issues.push({ field: "categories", message: "must be an array" });
  if (!Array.isArray(payload.products))
    issues.push({ field: "products", message: "must be an array" });
  if (!Array.isArray(payload.tables))
    issues.push({ field: "tables", message: "must be an array" });
  if (issues.length > 0) return { ok: false, issues };

  const cats = payload.categories as MenuSyncPayload["categories"];
  const prods = payload.products as MenuSyncPayload["products"];
  const tables = payload.tables as MenuSyncPayload["tables"];

  if (cats.length > SYNC_LIMITS.categories)
    issues.push({ field: "categories", message: `too many categories (max ${SYNC_LIMITS.categories})` });
  if (prods.length > SYNC_LIMITS.products)
    issues.push({ field: "products", message: `too many products (max ${SYNC_LIMITS.products})` });
  if (tables.length > SYNC_LIMITS.tables)
    issues.push({ field: "tables", message: `too many tables (max ${SYNC_LIMITS.tables})` });

  const catIds = new Set<string>();
  for (const c of cats) {
    if (typeof c.id !== "string" || !c.id) {
      issues.push({ field: "categories", message: "category id missing" });
    } else {
      if (catIds.has(c.id)) issues.push({ field: "categories", message: `duplicate category id ${label(c.id)}` });
      catIds.add(c.id);
    }
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > SYNC_LIMITS.nameMax)
      issues.push({ field: "categories", message: `category name invalid (${label(c.id)})` });
  }

  for (const p of prods) {
    if (typeof p.id !== "string" || !p.id) {
      issues.push({ field: "products", message: "product id missing" });
      continue;
    }
    const key = label(p.id);
    if (!catIds.has(p.categoryId))
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
  }

  for (const t of tables) {
    if (typeof t.id !== "string" || !t.id)
      issues.push({ field: "tables", message: "table id missing" });
    if (!Number.isInteger(t.number) || t.number < 1 || t.number > 9999)
      issues.push({ field: "tables", message: `table number must be an integer in [1, 9999] (${label(t.id)})` });
    if (typeof t.token !== "string" || !t.token || t.token.length > 128)
      issues.push({ field: "tables", message: `table token invalid (${label(t.id)})` });
  }

  const r = payload.restaurant;
  if (!r || typeof r !== "object") {
    issues.push({ field: "restaurant", message: "restaurant object required" });
  } else {
    if (typeof r.name !== "string" || !r.name.trim() || r.name.length > SYNC_LIMITS.nameMax)
      issues.push({ field: "restaurant", message: "name invalid" });
    if (!SLUG_RE.test(r.slug))
      issues.push({ field: "restaurant", message: "slug invalid (lowercase letters, digits, hyphens)" });
    if (typeof r.tagline !== "string" || r.tagline.length > 160)
      issues.push({ field: "restaurant", message: "tagline invalid" });
    if (typeof r.primaryColor !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(r.primaryColor))
      issues.push({ field: "restaurant", message: "primaryColor invalid" });
    for (const url of [r.logoUrl, r.coverUrl]) {
      if (url != null && url !== "" && !HTTP_URL_RE.test(url))
        issues.push({ field: "restaurant", message: "logoUrl/coverUrl must be http(s) or null" });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, payload: payload as MenuSyncPayload };
}