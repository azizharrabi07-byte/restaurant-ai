/**
 * Canonical menu-import contract — "whole-menu importer".
 *
 * The scanner (server) ALWAYS produces a menu import result composed of
 * categories + products (+ their relationship). It never knows or cares which
 * wizard step opened it. The onboarding store simply merges the result.
 *
 * Everything in this module is pure (React/Next-free) so it can be unit-tested
 * in isolation:
 *
 *   INPUT FILES
 *       ↓
 *   MISTRAL OCR  (+ document annotation / json_schema)
 *       ↓
 *   NORMALIZE   (name cleaning, category resolution)
 *       ↓
 *   SANITIZE    (OCR artifact rejection, price coercion, dedupe)
 *       ↓
 *   MenuImportResult (per source)
 *       ↓
 *   RECONCILE   (AI annotation + deterministic parser → one result)
 *       ↓
 *   SANITIZE/VALIDATE
 *       ↓
 *   MenuImportResult (canonical)
 *       ↓
 *   Onboarding store (mergeMenuImport)
 */

export const UNCATEGORIZED = "Uncategorized";

export type ImportSource = "ai" | "fallback";

export interface ImportedCategory {
  name: string;
}

export interface ImportedProduct {
  name: string;
  description: string;
  price: number;
  /** Resolved category reference by name — always set; UNCATEGORIZED when unknown. */
  categoryName: string;
}

export interface MenuImportResult {
  categories: ImportedCategory[];
  products: ImportedProduct[];
  stats: {
    files: number;
    pages: number;
    source: ImportSource;
    model: string;
  };
}

// ── Name normalization ──────────────────────────────────────────────

/** Clean display name: trim + collapse repeated whitespace. Keeps case/accents. */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim();
}

/** Comparison key: lowercase + NFC + whitespace collapsed. */
export function normalizeKey(raw: unknown): string {
  return normalizeName(raw).toLowerCase().normalize("NFC");
}

// ── Price coercion ──────────────────────────────────────────────────

const MAX_PRICE = 9999;

/**
 * Coerce a raw OCR value into a real price number.
 * - "4.500 DT" → 4.5, "16,500 DT" → 16.5, "4,500 DT" → 4.5 (Tunisian Dinar)
 * - NaN / Infinity / undefined / null / negative / unparseable → 0
 *   (0 is this app's established "no price / off-card" value, so an
 *   unreadable price never poisons the onboarding state with NaN).
 */
export function sanitizePrice(raw: unknown): number {
  if (typeof raw === "number") return clampPrice(raw);
  if (typeof raw !== "string") return 0;
  let s = raw
    .replace(/\s*(?:DT|TND|TD|EUR|USD|US\$|€|د\.?ت|ت)\s*/gi, "")
    .replace(/\s+/g, "");
  if (!s) return 0;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  return clampPrice(n);
}

function clampPrice(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 1000) / 1000, MAX_PRICE);
}

// ── OCR artifact detection ──────────────────────────────────────────

const OCR_LINK_RE = /^\[([^\]]*)\]\(([^)]*)\)$/;
const MD_TARGET_RE = /\.md\s*$/i;
const TBL_TOKEN_RE = /\b(?:tbl|table)[-_. ]?\d+(?:\.md)?\b/i;
const OCR_FILE_RE = /_ocr[_-]|ocr[-_ ]?ingest/i;
const PAGE_REF_RE = /^\s*\b(?:page|p\.?|page\s+\d+|seite)\s*[0-9ivx]+\b/i;
const PRICE_ONLY_RE = /^\d+(?:[,.]\d+)*\s*(?:dt|tnd|td|€|usd|د\.?ت)?\s*$/i;
const CONTACT_RE = /(\+?\d[\d\s().-]{6,}|\b[\w.+-]+@[\w.-]+\.\w{2,}\b|\bhttps?:\/\/\S+|(?:^|\s)www\.\S+)/i;

function hasLettersOrDigits(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * General OCR/document-artifact predicate. Anything returning true is never
 * surfaced as a category or product. Deliberately lenient about legitimate
 * punctuation ("Brik à l'Œuf", "A-1 Special") and non-Latin text.
 */
export function isOcrArtifact(raw: unknown): boolean {
  const name = normalizeName(raw);
  if (!name) return true;
  if (name.length > 160) return true;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(name)) return true;
  // Pure separators / shed punctuation with no letter or digit anywhere.
  if (!hasLettersOrDigits(name)) return true;
  // Internal page separators / HTML comments the pipeline itself emits.
  if (/^<!--.*-->$/.test(name)) return true;
  if (/^=+[^=\n]*=+$/.test(name)) return true;

  // Markdown links: [tbl-0.md](tbl-0.md) and other *.md document references.
  const link = name.match(OCR_LINK_RE);
  if (link) {
    const text = normalizeKey(link[1]);
    const target = normalizeKey(link[2]);
    if (!text) return true;
    if (MD_TARGET_RE.test(target)) return true;
    if (TBL_TOKEN_RE.test(target) || TBL_TOKEN_RE.test(text)) return true;
    if (PAGE_REF_RE.test(target) || PAGE_REF_RE.test(text)) return true;
    if (CONTACT_RE.test(target)) return true;
    return false;
  }

  if (TBL_TOKEN_RE.test(name)) return true;
  if (OCR_FILE_RE.test(name)) return true;
  if (PAGE_REF_RE.test(name)) return true;
  if (PRICE_ONLY_RE.test(name)) return true;
  if (CONTACT_RE.test(name)) return true;
  return false;
}

// ── Normalize + sanitize + validate ─────────────────────────────────

interface RawItemLike {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  category?: unknown;
  categoryName?: unknown;
}

interface RawCategoryLike {
  name?: unknown;
  items?: unknown;
}

/**
 * Digest any scanned source (AI annotation JSON, flat product list, or the
 * deterministic parser's output) into the canonical { categories, products }
 * shape. All OCR artifacts and duplicate/malformed entries are removed here —
 * invalid data never reaches the onboarding store.
 */
export function sanitizeImport(raw: unknown): {
  categories: ImportedCategory[];
  products: ImportedProduct[];
} {
  const src = (raw ?? {}) as { categories?: unknown; products?: unknown };

  const categories: ImportedCategory[] = [];
  const byCatKey = new Map<string, ImportedCategory>();
  const addCategory = (rawName: unknown): ImportedCategory | null => {
    const name = normalizeName(rawName);
    const key = normalizeKey(name);
    if (!key || isOcrArtifact(name)) return null;
    const existing = byCatKey.get(key);
    if (existing) return existing;
    const cat: ImportedCategory = { name };
    categories.push(cat);
    byCatKey.set(key, cat);
    return cat;
  };

  const rows: RawItemLike[] = [];

  if (Array.isArray(src.categories)) {
    for (const c of src.categories as RawCategoryLike[]) {
      if (!c || typeof c !== "object") continue;
      const catName = normalizeName(c.name);
      if (!catName || isOcrArtifact(catName)) continue;
      addCategory(catName);
      const items = Array.isArray(c.items) ? (c.items as RawItemLike[]) : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        rows.push({ ...it, category: catName });
      }
    }
  }

  if (Array.isArray(src.products)) {
    for (const p of src.products as RawItemLike[]) {
      if (!p || typeof p !== "object") continue;
      rows.push(p);
    }
  }

  const products: ImportedProduct[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = normalizeName(row.name);
    if (!name || isOcrArtifact(name)) continue;

    const rawCat = normalizeName(row.categoryName ?? row.category ?? "");
    const resolved = rawCat && !isOcrArtifact(rawCat) ? addCategory(rawCat) : null;
    const categoryName = resolved ? resolved.name : UNCATEGORIZED;

    const product: ImportedProduct = {
      name,
      description: normalizeName(row.description),
      price: sanitizePrice(row.price),
      categoryName,
    };

    const key = `${normalizeKey(categoryName)}|${normalizeKey(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(product);
  }

  // Keep only categories that really carry products.
  const withProducts = new Set(products.map((p) => normalizeKey(p.categoryName)));
  const finalCats = categories.filter((c) => withProducts.has(normalizeKey(c.name)));

  // Explicit "Uncategorized" bucket only when orphans actually exist.
  if (
    products.some((p) => p.categoryName === UNCATEGORIZED) &&
    !finalCats.some((c) => normalizeKey(c.name) === normalizeKey(UNCATEGORIZED))
  ) {
    finalCats.push({ name: UNCATEGORIZED });
  }

  return { categories: finalCats, products };
}

/** Wrap sanitized content with import statistics. */
export function buildMenuImport(
  raw: unknown,
  opts: { files: number; pages: number; source: ImportSource; model: string },
): MenuImportResult {
  const { categories, products } = sanitizeImport(raw);
  return {
    categories,
    products,
    stats: {
      files: opts.files,
      pages: opts.pages,
      source: opts.source,
      model: opts.model,
    },
  };
}

// ── Merger consumed by the onboarding store ─────────────────────────

export interface CategoryRow {
  id: string;
  name: string;
  position: number;
}

export interface ProductRow {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  image: string | null;
  isAvailable: boolean;
}

/** The slice of app state the importer touches. */
export interface MenuStateSlice {
  categories: CategoryRow[];
  products: ProductRow[];
}

/**
 * Merge an entire MenuImportResult into app state.
 *
 * 1. Existing categories are found by normalized name and reused.
 * 2. Unknown categories are created.
 * 3. Products resolve their categoryName through the (reused/created) category.
 * 4. Products are deduplicated by normalized name within their category.
 *
 * Deterministic and step-independent: launching from Categories or Products
 * produces identical state.
 */
export function mergeMenuImport(
  state: MenuStateSlice,
  result: MenuImportResult,
  uid: () => string,
): MenuStateSlice {
  const categories = [...state.categories];
  const products = [...state.products];
  const byKey = new Map<string, CategoryRow>();
  for (const c of categories) byKey.set(normalizeKey(c.name), c);

  const ensureCategory = (rawName: unknown): CategoryRow => {
    const name = normalizeName(rawName) || UNCATEGORIZED;
    const key = normalizeKey(name);
    const existing = byKey.get(key);
    if (existing) return existing;
    const cat: CategoryRow = { id: uid(), name, position: categories.length };
    categories.push(cat);
    byKey.set(key, cat);
    return cat;
  };

  const pendingCats = new Set<string>();
  for (const c of result.categories) {
    const key = normalizeKey(c.name);
    if (!key || pendingCats.has(key)) continue;
    pendingCats.add(key);
    ensureCategory(c.name);
  }

  for (const p of result.products) {
    const rawCat = p.categoryName && normalizeKey(p.categoryName) ? p.categoryName : UNCATEGORIZED;
    const catKey = normalizeKey(rawCat);
    const cat = byKey.get(catKey) ?? ensureCategory(UNCATEGORIZED);
    const nameKey = normalizeKey(p.name);
    if (!nameKey) continue;
    const duplicate = products.some(
      (x) => x.categoryId === cat.id && normalizeKey(x.name) === nameKey,
    );
    if (duplicate) continue;
    products.push({
      id: uid(),
      categoryId: cat.id,
      name: normalizeName(p.name),
      description: normalizeName(p.description),
      price: sanitizePrice(p.price),
      image: null,
      isAvailable: true,
    });
  }

  return { categories, products };
}

// ── Reconcile AI + deterministic parser results ────────────────────

/** Parser catch-all heading used when no real headings were found. */
const PARSER_FALLBACK_HEADING = "menu";

function isMeaningfulDescription(d?: unknown): boolean {
  return typeof d === "string" && d.trim().length > 0;
}

/** A parser association is "uncertain" when it is uncategorized or the catch-all. */
function parserAssociationUncertain(catName: unknown): boolean {
  const key = normalizeKey(catName);
  return !key || key === normalizeKey(UNCATEGORIZED) || key === PARSER_FALLBACK_HEADING;
}

interface MergeSlot {
  name: string;
  ai?: ImportedProduct;
  parser?: ImportedProduct;
}

/**
 * Deterministically merge the AI annotation result with the deterministic
 * parser result into ONE canonical MenuImportResult.
 *
 * Identity of a dish is its normalized name (trim whitespace, collapse
 * repeated whitespace, lowercase; accents/punctuation preserved). A dish found
 * by both sources becomes one product; their fields merge per the rules below.
 * The union of both sources' name keys is never shrunk, so the safety
 * invariant holds:
 *
 *   final products >= max(ai products, parser products)
 *
 * unless an entry is rejected by the final sanitize/validate pass.
 *
 * Deterministic conflict rules (no invented values, documented):
 * - name:       AI spelling when the dish was found by AI, else parser.
 * - category:   AI association when it is valid AND the parser association is
 *               missing/uncertain (Uncategorized or the parser "Menu"
 *               catch-all); otherwise the parser relationship is preserved so
 *               items stay grounded in the printed section headings.
 * - price:      both agree → that value. One valid + one invalid(0) → the
 *               valid one wins. Both valid but different → the PARSER price
 *               wins, because the parser reads the digits straight from the
 *               OCR'd markdown (a literal OCR read), while the AI price is the
 *               model's interpretation — the literal OCR read is the safest
 *               deterministic ground truth.
 * - description: AI description when meaningful, else parser description.
 *               Descriptions are never invented.
 * - availability / tags / image: not part of ImportedProduct, so they are NOT
 *               reconciled here; the store supplies defaults on materialization.
 */
export function reconcileImports(
  ai: MenuImportResult,
  parser: MenuImportResult,
): MenuImportResult {
  // 1. Union of categories (dedupe by normalized name; AI spelling wins).
  const catByName = new Map<string, ImportedCategory>();
  for (const c of ai.categories) {
    const key = normalizeKey(c.name);
    if (key && !catByName.has(key)) catByName.set(key, { name: normalizeName(c.name) });
  }
  for (const c of parser.categories) {
    const key = normalizeKey(c.name);
    if (key && !catByName.has(key)) catByName.set(key, { name: normalizeName(c.name) });
  }
  const categories = [...catByName.values()];

  // 2. Group each source's products into identity slots. A dish identity is
  //    the normalized name; if ONE source happens to output the same name in
  //    several different categories, each (name, category) pair is kept as its
  //    own slot so no product is ever lost.
  const aiSlots = buildSlots(ai.products);
  const parserSlots = buildSlots(parser.products);

  const merged = new Map<string, MergeSlot>();
  for (const [key, p] of aiSlots) merged.set(key, { name: p.name, ai: p });

  for (const [psKey, ps] of parserSlots) {
    let target = merged.get(psKey);
    if (!target && !psKey.includes("\u0000")) {
      // cross-match a bare nameKey against a disambiguated AI slot with the
      // same name + category (AI had the dish in multiple categories)
      for (const [k, s] of merged) {
        if (s.parser) continue;
        if (k.split("\u0000")[0] === psKey) {
          target = s;
          break;
        }
      }
    } else if (!target && psKey.includes("\u0000") && merged.has(nkOf(psKey))) {
      target = merged.get(nkOf(psKey))!;
    }
    if (target) {
      if (!target.ai) target.name = ps.name;
      target.parser = ps;
    } else {
      merged.set(psKey, { name: ps.name, parser: ps });
    }
  }

  // 3. Resolve each merged slot into a canonical product.
  const products: ImportedProduct[] = [];
  for (const slot of merged.values()) {
    const aiP = slot.ai;
    const parserP = slot.parser;

    const aiCat = aiP?.categoryName;
    const parserCat = parserP?.categoryName;

    let categoryName: string;
    if (
      aiCat &&
      normalizeName(aiCat) &&
      !isOcrArtifact(aiCat) &&
      normalizeKey(aiCat) !== normalizeKey(UNCATEGORIZED) &&
      parserAssociationUncertain(parserCat)
    ) {
      categoryName = normalizeName(aiCat);
    } else if (parserCat && !isOcrArtifact(parserCat)) {
      categoryName = normalizeName(parserCat);
    } else if (aiCat && !isOcrArtifact(aiCat)) {
      categoryName = normalizeName(aiCat);
    } else {
      categoryName = UNCATEGORIZED;
    }

    products.push({
      name: slot.name,
      description: isMeaningfulDescription(aiP?.description)
        ? normalizeName(aiP?.description)
        : normalizeName(parserP?.description),
      price: resolveReconciledPrice(aiP?.price, parserP?.price),
      categoryName,
    });
  }

  // 4. Final sanitize/validate pass (guarantees the canonical shape; nothing
  //    that survived reconciliation is dropped beyond artifact validation).
  const stats = ai.products.length > 0 ? ai.stats : parser.stats;
  return buildMenuImport(
    { categories, products },
    { files: stats.files, pages: stats.pages, source: stats.source, model: stats.model },
  );
}

const DISAMB_SEP = "\u0000";
const nkOf = (slotKey: string) => slotKey.split(DISAMB_SEP)[0];

type SlotKey = string;

/** Group products into identity slots within ONE source (lossless). */
function buildSlots(products: ImportedProduct[]): Map<SlotKey, ImportedProduct> {
  const out = new Map<SlotKey, ImportedProduct>();
  const firstOfName = new Map<string, SlotKey>();
  const keyOf = new Map<SlotKey, string>(); // slotKey -> normalized category
  for (const p of products) {
    const nk = normalizeKey(p.name);
    if (!nk) continue;
    const ck = normalizeKey(p.categoryName || UNCATEGORIZED);
    const existing = firstOfName.get(nk);
    if (existing !== undefined && keyOf.get(existing) !== ck) {
      const sk = `${nk}${DISAMB_SEP}${ck}`;
      if (!out.has(sk)) {
        out.set(sk, p);
        keyOf.set(sk, ck);
        firstOfName.set(nk, sk);
      }
    } else {
      const sk = existing !== undefined ? existing : nk;
      if (!out.has(sk)) {
        out.set(sk, p);
        keyOf.set(sk, ck);
        firstOfName.set(nk, sk);
      }
    }
  }
  return out;
}

/** Price conflict rule (documented on reconcileImports). */
function resolveReconciledPrice(aiPrice: unknown, parserPrice: unknown): number {
  const a = sanitizePrice(aiPrice);
  const p = sanitizePrice(parserPrice);
  const aValid = a > 0;
  const pValid = p > 0;
  if (aValid && pValid) return a === p ? a : p;
  if (aValid) return a;
  if (pValid) return p;
  return 0;
}