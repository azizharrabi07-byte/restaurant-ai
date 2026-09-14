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
 * A line that is nothing but a price ("4.500 DT", "$12.50"), with the whole
 * token — currency markers included — as capture group 1. Shared with the OCR
 * quality gate so "this document carries prices" means the same thing in both
 * stages.
 */
export const PRICE_ONLY_LINE_RE = new RegExp(
  String.raw`^\s*((?:US\$|\$|€|£|¥)?\s*(?:\d[\d\s]*[.,]\d+|\d[\d\s]*)\s*(?:DT|TND|TD|EUR|USD|GBP|CHF|د\.?ت|ت|€|\$|£|E)?)\s*$`,
  "i",
);

/**
 * A "name + price" line: group 1 is the name, group 2 the whole price token.
 *
 * The name is required to END on a non-digit, and the amount may span internal
 * whitespace. Together that stops `Couscous 1 200` from being split into a name
 * "Couscous 1" plus an invented 200 DT price: the amount swallows the spaced
 * group instead, and the printed name keeps every character the printer put in
 * it (OCR-02).
 */
export const NAME_PRICE_LINE_RE = new RegExp(
  String.raw`^(.+?[^\d\s])\s+((?:US\$|\$|€|£|¥)?\s*(?:\d[\d\s]*[.,]\d+|\d[\d\s]*)\s*(?:DT|TND|TD|EUR|USD|GBP|CHF|د\.?ت|ت|€|\$|£|E)?)\s*$`,
  "i",
);

/**
 * Normalize the digit forms and separators Arabic/French menus and OCR actually
 * produce, so every stage downstream only has to handle ASCII:
 *   ٠-٩ (U+0660…) and ۰-۹ (U+06F0…) → 0-9,  ٫ (U+066B) → ".",  ٬ (U+066C) → ","
 * Non-breaking spaces become plain spaces, because "4\u00A0500" — what a PDF
 * text layer or an OCR pass emits — must take the same branch as "4 500".
 */
export function normalizeOcrDigits(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
      const code = d.charCodeAt(0);
      return String.fromCharCode(code - (code >= 0x06f0 ? 0x06f0 : 0x0660) + 0x30);
    })
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, ",")
    .replace(/[\u00A0\u2007\u202F]/g, " ");
}

/** Currency tokens lifted out of a printed price before the amount is read. */
const CURRENCY_TOKEN_RE = /(?:US\$|\$|€|د\.?ت|ت)|\b(?:DT|TND|TD|EUR|USD|E)\b/gi;

/**
 * Currencies this module has no honest TND conversion for. Reading the printed
 * number as dinars would put a *plausible but wrong* price on a live menu — the
 * one outcome this import path must never produce — so such a row imports at 0,
 * which the review UI renders as "—" and the owner fixes by hand.
 */
const UNCONVERTIBLE_CURRENCY_RE = /[£¥₺]|\b(?:GBP|CHF|CAD|AED|SAR|MAD|DZD|LYD|JOD|KWD|QAR)\b/i;

/**
 * Coerce a raw OCR value into a real price number.
 * - "4.500 DT" → 4.5, "16,500 DT" → 16.5, "12,5" → 12.5, "12.5" → 12.5,
 *   "12 DT" → 12, "$12.50" → 12.5, "€12" → 12, "١٢٫٥" → 12.5
 * - "1 200" → 1.2: TND is printed with three millime decimals, so a spaced
 *   trailing group is the FRACTION, not a thousands separator (the same rule
 *   that reads "1.200" as 1.2). Reading 200 there is the phantom price OCR-02
 *   removed.
 * - NaN / Infinity / undefined / null / negative / unparseable → 0
 *   (0 is this app's established "no price / off-card" value, so an
 *   unreadable price never poisons the onboarding state with NaN).
 * - a currency with no honest TND conversion (£, ¥, GBP…) → 0.
 *
 * "$"/"€" are read at FACE VALUE — the printed number is taken as dinars, which
 * is the convention the rest of this pipeline already relied on for "6.5€" and
 * "US$12". The annotation prompt asks the AI stage for an approximate
 * conversion; a deterministic parser must not invent one.
 *
 * This is the ONE price routine: menu-scan.ts's OCR parser calls it too, so the
 * same printed string can never become two different prices depending on which
 * stage happened to see it first (OCR-02, OCR-03, OCR-14).
 */
export function sanitizePrice(raw: unknown): number {
  if (typeof raw === "number") return clampPrice(raw);
  if (typeof raw !== "string") return 0;

  let s = normalizeOcrDigits(raw);
  if (UNCONVERTIBLE_CURRENCY_RE.test(s)) return 0;
  // Drop currency words/symbols and every other non-numeric character, so
  // "$12.50" / "US$12" / "12 DT" / "3 E" all arrive below as one number.
  s = s
    .replace(CURRENCY_TOKEN_RE, "")
    .replace(/[^\d.,\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return 0;

  const spaced = s.match(/^(\d{1,3}) (\d{1,3})$/);
  if (spaced) s = `${spaced[1]}.${spaced[2]}`;
  s = s.replace(/\s/g, "");

  // Both separators left ("1,200.50"): which one is the decimal point cannot be
  // decided here, and a guess would be a plausible-but-wrong price.
  if (s.includes(",") && s.includes(".")) return 0;
  if (s.includes(",")) s = s.replace(",", ".");
  s = s.replace(/^[.,]+|[.,]+$/g, "");
  return s ? clampPrice(Number(s)) : 0;
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
const CONTACT_RE = /(\+?\d[\d\s().-]{6,}|[\w.+-]+@[\w.-]+|\bhttps?:\/\/\S+|(?:^|\s)www\.\S+)/i;

/** A line that is nothing but a phone number: "71 245 890", "+216 71 245 890". */
const PHONE_ONLY_RE = /^\+?\d[\d\s().-]{6,}$/;

/**
 * Address/contact WORDS in Latin and Arabic script, matched as whole tokens.
 *
 * Every printed menu carries the venue's own header and footer, and OCR reads
 * them as ordinary text lines. On a live run of six photographs against the
 * real provider, EVERY scan imported that furniture as products: the address
 * line "12 Rue de Marseille · Tunis · Tél." came back at 9999 DT (the phone
 * digits "71 245 890" assembled into one number and clamped to the price
 * ceiling) and the footer "Prix en dinars · Service compris" at 0 DT. The
 * Arabic/French card produced the same two rows in Arabic:
 * "نهج مرسيليا - تونس - الهاتف" and "الأسعار بالدينار - الخدمة مشمولة".
 *
 * Anchoring each word on separators (start/space/·/punctuation) keeps a dish
 * safe: only a whole token counts, so a keyword inside a longer word
 * ("Routeur", "Telyn") cannot match.
 */
const VENUE_CHROME_WORD_RE =
  /(?:^|[\s·|,;:./\\-])(?:rue|avenue|av|boulevard|bd|route|impasse|chemin|place|tél|tel|téléphone|telephone|phone|fax|mobile|gsm|adresse|address|horaires?|hours|ouvert|www|نهج|شارع|عنوان|هاتف|الهاتف|تلفون)(?=$|[\d\s·|,;:./\\-])/i;

/** The card's own footer, printed under the last price. */
const FOOTER_RE =
  /service\s+(?:compris|inclus)|prix\s+en\s+(?:dinars?|dt|tnd)|prix\s+(?:net|ttc)|الأسعار\s+بالدينار|الخدمة\s+مشمولة|خدمة\s+مشمولة/i;

/**
 * Is this NAME the venue's furniture rather than a dish or a section?
 *
 * This is the name-level test: the name is expected to have had its price
 * stripped already (as `parseOcrMarkdown` and the AI annotation both do), so a
 * phone-shaped digit run inside it is contact noise.
 *
 * Deliberately NOT a price test: a 9999 DT dish is legal (that is
 * `sanitizePrice`'s ceiling) and must still import. Rejection is on the LINE
 * being address/contact/footer text, never on how big its number is.
 */
export function isVenueChrome(raw: unknown): boolean {
  const name = normalizeName(raw);
  if (!name) return true;
  return CONTACT_RE.test(name) || VENUE_CHROME_WORD_RE.test(name) || FOOTER_RE.test(name);
}

/**
 * The same test for a WHOLE line as OCR printed it, price included.
 *
 * `CONTACT_RE` cannot be used here: a perfectly good menu row such as
 * "| Couscous | 12.500 |" contains a digit run of 7+ characters and would be
 * read as a phone number. So the line-level test only accepts the address and
 * footer WORDS, plus a line that is nothing but a phone number — which must be
 * rejected before the parser can hold it as an orphan price for the next dish.
 */
export function isVenueChromeLine(raw: unknown): boolean {
  const line = normalizeName(raw);
  if (!line) return true;
  if (VENUE_CHROME_WORD_RE.test(line) || FOOTER_RE.test(line)) return true;
  return PHONE_ONLY_RE.test(line);
}

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
  if (isVenueChrome(name)) return true;
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

/** One scanned row the merge kept as the product the owner already had. */
export interface ImportCollision {
  name: string;
  categoryName: string;
  /** price already in the menu (the merge keeps it) */
  existingPrice: number;
  /** price the scan read, discarded in favour of the existing row */
  scannedPrice: number;
}

/** What a merge did (or would do) — the review step surfaces this. */
export interface MenuImportReport {
  /** rows added to the menu */
  added: number;
  /** rows kept as-is because their category already had that product */
  keptExisting: number;
  /** the same information per row, for the review UI */
  kept: ImportCollision[];
}

export interface MenuImportPlan {
  merged: MenuStateSlice;
  report: MenuImportReport;
}

/**
 * Merge an entire MenuImportResult into app state and report what happened.
 *
 * 1. Existing categories are found by normalized name and reused.
 * 2. Unknown categories are created.
 * 3. Products resolve their categoryName through the (reused/created) category.
 * 4. Products are deduplicated by normalized name within their category. A row
 *    that collides with a product already in the menu keeps the EXISTING row
 *    (the owner's hand-typed price/description always wins) — and the collision
 *    is reported, because dropping it silently left an owner who re-scanned
 *    after editing a price with half-applied state and a success signal
 *    (OCR-09).
 *
 * Deterministic and step-independent: launching from Categories or Products
 * produces identical state.
 */
export function planMenuImport(
  state: MenuStateSlice,
  result: MenuImportResult,
  uid: () => string,
): MenuImportPlan {
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

  const report: MenuImportReport = { added: 0, keptExisting: 0, kept: [] };
  // (categoryId, nameKey) pairs this result itself already inserted: a second
  // identical row inside one scan result is a plain duplicate, not a collision
  // with what the owner had.
  const inserted = new Set<string>();

  for (const p of result.products) {
    const rawCat = p.categoryName && normalizeKey(p.categoryName) ? p.categoryName : UNCATEGORIZED;
    const catKey = normalizeKey(rawCat);
    const cat = byKey.get(catKey) ?? ensureCategory(UNCATEGORIZED);
    const nameKey = normalizeKey(p.name);
    if (!nameKey) continue;

    const slot = `${cat.id}\u0000${nameKey}`;
    const existing = products.find(
      (x) => x.categoryId === cat.id && normalizeKey(x.name) === nameKey,
    );
    if (existing) {
      if (inserted.has(slot)) continue;
      report.keptExisting++;
      report.kept.push({
        name: normalizeName(p.name),
        categoryName: cat.name,
        existingPrice: existing.price,
        scannedPrice: sanitizePrice(p.price),
      });
      continue;
    }
    inserted.add(slot);
    products.push({
      id: uid(),
      categoryId: cat.id,
      name: normalizeName(p.name),
      description: normalizeName(p.description),
      price: sanitizePrice(p.price),
      image: null,
      isAvailable: true,
    });
    report.added++;
  }

  return { merged: { categories, products }, report };
}

/**
 * Merge an entire MenuImportResult into app state (the onboarding store's entry
 * point). Same work as `planMenuImport`, report discarded.
 */
export function mergeMenuImport(
  state: MenuStateSlice,
  result: MenuImportResult,
  uid: () => string,
): MenuStateSlice {
  return planMenuImport(state, result, uid).merged;
}

/**
 * What a merge WOULD keep as-is, computed without touching any state — the
 * review step warns the owner about these rows before they are applied
 * (OCR-09).
 */
export function previewMenuImport(
  state: MenuStateSlice,
  result: MenuImportResult,
): MenuImportReport {
  return planMenuImport(state, result, () => "preview").report;
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
 * unless an entry is rejected by the final sanitize/validate pass. In
 * particular a parser product is never overwritten: when the parser printed the
 * same dish under two sections and the AI only saw it once, the second parser
 * entry gets its own slot (and its own category) rather than replacing the
 * first — which is what used to drop a listing and orphan its category
 * (OCR-01).
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
      // The parser printed this dish under a section the AI did not report.
      // Attach to the AI's bare slot ONLY when nothing is attached yet:
      // overwriting a slot that already holds a parser product destroyed that
      // product and made the documented `final >= max(ai, parser)` invariant
      // false (OCR-01).
      const bare = merged.get(nkOf(psKey))!;
      if (!bare.parser) target = bare;
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