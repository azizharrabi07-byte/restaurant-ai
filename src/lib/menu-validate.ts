/**
 * Deterministic gate over LLM-produced menu structure — and the pure half of
 * the NVIDIA structurer (`./menu-structure-llm`).
 *
 * A language model is what makes the scan UNDERSTAND a card: it attaches a
 * wrapped description line to the dish above it, reads `Couscous 1 200` as
 * `1200`, and drops the dietary legend and the address. It is also stochastic:
 * the same model, same prompt, `temperature: 0`, run twice over the same
 * captured OCR output, captured the Arabic-script section once and omitted it
 * the next time. Nothing it produces is trusted on its own.
 *
 * This module is the trust boundary. Three pure pieces, in the order the
 * pipeline uses them:
 *
 *   1. `MENU_STRUCTURE_RULES` — the classification/price contract the model is
 *      prompted with. It lives here rather than inside the `"server-only"`
 *      client so the contract the benchmark was measured against (15 s, 20/20
 *      priced, zero junk) is pinned by a unit test instead of drifting inside a
 *      module no test may import.
 *   2. `parseLlmJsonObject` — the model's reply text → a JSON value, or a typed
 *      failure. A fenced, prose-wrapped or truncated reply never throws a raw
 *      `SyntaxError` at the caller.
 *   3. `validateMenuImport` / `mergeStructuredMenu` — the safety gate itself.
 *
 * No `"server-only"`, no React, no network: vitest imports this module directly.
 */

import {
  normalizeKey,
  normalizeName,
  UNCATEGORIZED,
  type ImportedCategory,
  type ImportedProduct,
  type MenuImportResult,
} from "./menu-import";

// ── 1. The contract the model is prompted with ──────────────────────

/**
 * The rule block sent to the NVIDIA structurer. Every rule here was paid for:
 * the classification rules are what turned 36 junk rows into 0, and the price
 * rules are the ones the regex parser gets wrong (`1 200`, Arabic-Indic
 * digits).
 */
export const MENU_STRUCTURE_RULES = `You convert OCR text from a photographed restaurant menu into JSON.

Classify EVERY line as exactly one of:
  - item: a dish or a drink whose price is printed on the line, or immediately under it;
  - description: a line with no price of its own that continues the item printed above it;
  - section header: a printed section title such as "CAFÉS", "BOISSONS FROIDES", "PLATS";
  - ignore: anything else, including a bare page or document separator such as
    "<!-- page 2 -->" or "===== NEXT DOCUMENT =====".

Rules:
1. EVERY line that carries a price MUST become an item, including a line written
   in Arabic script (e.g. "قهوة عربية ٢٫٥٠٠" is the item "قهوة عربية" priced 2.5)
   and a line whose price uses non-ASCII digits. Never drop a priced line, and
   never leave the price inside the name.
2. A line with NO price that continues the priced item above it is that item's
   "description" — never a new item.
3. A section header becomes the "categoryName" of the items printed under it. It
   is never an item.
4. The card's own title, dietary legends ("V: Vegetarian", "VG: Vegan",
   "GF: Gluten Free"), contact details (address, phone, website, email) and
   footers ("Prix en dinars - Service compris") are NOT items and NOT category
   names. They belong nowhere in the output.
5. Prices are JSON numbers, never strings:
   - "12,5" and "12.5" both mean 12.5;
   - three digits after a dot are millimes: "4.500 DT" means 4.5;
   - a space between digit groups is a THOUSANDS separator: "1 200" means 1200;
   - Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩ are 0-9, the Arabic decimal separator ٫ is
     the dot, and the Arabic thousands separator ٬ groups digit runs:
     "٢٫٥٠٠" means 2.5 and "١٢" means 12.
6. Keep an Arabic name in its original script: "قهوة عربية" stays "قهوة عربية".
   Do not transliterate, translate or prettify any name.
7. Never invent a dish, a price or a category. Only reproduce what the text says.
8. Reply with ONLY the JSON object. No prose, no explanation, no markdown fence.

Output shape, with exactly these keys:
{"categories":[{"name":"CAFÉS"}],"products":[{"name":"Espresso","description":"","price":2.5,"categoryName":"CAFÉS"}]}

Every "categoryName" MUST be one of the "categories" names. Use "Uncategorized"
for an item the card printed under no section at all.`;

// ── 2. The model's reply, parsed defensively ────────────────────────

export type LlmJsonParse = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * The outermost JSON object in a chat completion's text, or a typed failure.
 *
 * The measured model answers a bare object when asked for one, but a chat
 * completion is free text: a fenced block, a sentence of preamble or a reply cut
 * off by the token ceiling are all normal events that must degrade to a logged
 * skip, not to an exception thrown across the scan.
 */
export function parseLlmJsonObject(text: unknown): LlmJsonParse {
  if (typeof text !== "string") return { ok: false, reason: "response content is not a string" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "no JSON object in the response" };
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { ok: false, reason: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "the JSON value is not an object" };
  }
  return { ok: true, value };
}

// ── 3. The safety gate ──────────────────────────────────────────────

/**
 * The dietary legend a card prints once above the prices. A live café card
 * printed `V: Vegetarian` / `VG: Vegan` / `GF: Gluten Free` on three separate
 * lines and every one of them was imported as a dish by the naive union.
 */
const DIETARY_LEGEND_RE =
  /^[\s\-•*·>|]*(?:v|vg|gf|vegan|vegetarian|végétarien|végétarienne|vegetarien|sans\s+gluten)\s*[:=]/i;

/**
 * Address words, matched as WHOLE tokens (anchored on separators, so a keyword
 * inside a longer word — "Routeur", "Telyn" — cannot match). Deliberately no
 * `st`: "Coquilles St Jacques" is a dish.
 */
const VENUE_WORD_RE =
  /(?:^|[\s·|,;:./\\-])(?:rue|avenue|av|boulevard|bd|route|impasse|chemin|place|street|tél|tel|téléphone|telephone|phone|fax|mobile|gsm|adresse|address)(?=$|[\d\s·|,;:./\\-])/i;

/** The separators an email/URL sits behind: `@`, `http://`, `www.`. */
const CONTACT_RE = /@|\bhttps?:\/\/|(?:^|\s)www\./i;

/**
 * A digit run shaped like a phone number. `12 Rue de Marseille · Tunis ·
 * Tél. 71 245 890` arrived as a product priced 9999 because the phone digits
 * were assembled into one number; this is the cheap, deterministic test for it.
 */
const PHONE_RUN_RE = /\b\d{2,}\s?\d{2,}\b/;

/** The card's footer, printed under the last price. */
const FOOTER_RE = /service\s+(?:compris|inclus)|prix\s+en\s+(?:dinars?|dt|tnd)|prix\s+(?:net|ttc)/i;

/**
 * A line that is ONLY the card's footer word. Anchored to the whole name on
 * purpose: "Menu" is furniture, but "Menu Enfant" is a dish with a price, and a
 * validator that removes real dishes is worse than the junk it was added to
 * remove.
 */
const FOOTER_WORD_RE = /^(?:le\s+|la\s+)?(?:menu|menus|carte|tarifs?)\s*$/i;

/**
 * A name the OCR wrapped: the printed line continued below, so what the parser
 * holds ends mid-phrase — "Cauliflower &" (trailing punctuation) or "Panini
 * with Pastrami, Dijon Mustard," (nothing but a trailing comma).
 */
const TRAILING_PUNCT_RE = /[&+,\-–—;:/|]\s*$/;
const DANGLING_WORD_RE =
  /(?:^|\s)(?:and|or|with|without|plus|sans|avec|et|ou|de|du|des|le|la|les|au|aux|pour|sur|dans|of|from|the)\s*$/i;

export type MenuDropReason =
  | "EMPTY_NAME"
  | "DIETARY_LEGEND"
  | "VENUE_CONTACT"
  | "FOOTER"
  | "DANGLING_FRAGMENT"
  | "NO_PRICE"
  | "DUPLICATE";

/** One product the gate removed, and the rule that removed it. */
export interface MenuDrop {
  reason: MenuDropReason;
  name: string;
  categoryName: string;
  price: number;
}

/**
 * What the gate did. `dropped` is returned rather than swallowed on purpose:
 * silently discarding a row was the audit's complaint (OCR-09), so the scan
 * logs this report instead of a bare count.
 */
export interface MenuValidationReport {
  dropped: MenuDrop[];
  /** Categories left with no product at all, removed with them. */
  droppedCategories: string[];
  /** Prices floored at 0 / re-rounded to a millime. */
  pricesAdjusted: number;
}

export interface MenuValidationResult extends MenuImportResult {
  report: MenuValidationReport;
}

/**
 * Millime-based currency: three decimals is the printed precision, so anything
 * finer is noise. A negative or non-finite value is not a price at all — 0 is
 * this app's established "no price" value, which the review UI renders as "—".
 */
function normalizePrice(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * The first rule `name` (already normalized) trips, or null when it is a dish.
 *
 * Furniture is tested BEFORE price: "12 Rue de Marseille · Tunis · Tél. 71 245
 * 890" must be reported as the venue's address, not merely as a row without a
 * price, or the next person reading the log learns nothing.
 */
function dropReason(name: string, price: number, description: string): MenuDropReason | null {
  if (!name) return "EMPTY_NAME";
  if (DIETARY_LEGEND_RE.test(name)) return "DIETARY_LEGEND";
  if (VENUE_WORD_RE.test(name) || CONTACT_RE.test(name) || PHONE_RUN_RE.test(name)) {
    return "VENUE_CONTACT";
  }
  if (FOOTER_RE.test(name) || FOOTER_WORD_RE.test(name)) return "FOOTER";
  if (TRAILING_PUNCT_RE.test(name) || DANGLING_WORD_RE.test(name)) return "DANGLING_FRAGMENT";
  // An un-priced row is a fragment of the row above it — a wrapped description,
  // a section header, a legend — unless it carries a description of its own, in
  // which case it is a genuinely free item.
  if (price <= 0 && !description) return "NO_PRICE";
  return null;
}

/**
 * Remove what is not a dish, normalize what is, and report both.
 *
 * It never invents and never renames: the only strings it writes are the rows it
 * received. It removes (un-priced fragments, dietary legends, addresses/phones,
 * footers, wrapped-line fragments, duplicates) and normalizes (whitespace,
 * prices to millimes, categories that lost every product).
 */
export function validateMenuImport(input: MenuImportResult): MenuValidationResult {
  const dropped: MenuDrop[] = [];
  const products: ImportedProduct[] = [];
  const index = new Map<string, number>();
  let pricesAdjusted = 0;

  const drop = (
    reason: MenuDropReason,
    row: { name: string; categoryName: string; price: number },
  ): MenuDrop => ({ reason, name: row.name, categoryName: row.categoryName, price: row.price });

  for (const raw of input.products) {
    const name = normalizeName(raw.name);
    const description = normalizeName(raw.description);
    const categoryName = normalizeName(raw.categoryName) || UNCATEGORIZED;
    const price = normalizePrice(raw.price);
    if (raw.price !== price) pricesAdjusted += 1;

    const reason = dropReason(name, price, description);
    if (reason) {
      dropped.push(drop(reason, { name, categoryName, price }));
      continue;
    }

    const product: ImportedProduct = { name, description, price, categoryName };

    // Duplicates are compared inside their section: the same dish printed under
    // two sections is two rows, and the same dish listed twice in one section is
    // one row.
    const key = `${normalizeKey(categoryName)}\u0000${normalizeKey(name)}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, products.length);
      products.push(product);
      continue;
    }
    // Keep the richer row (a price beats no price, a description beats none);
    // on a tie the first spelling wins.
    const kept = products[at];
    const incomingWorth = (product.price > 0 ? 2 : 0) + (product.description ? 1 : 0);
    const keptWorth = (kept.price > 0 ? 2 : 0) + (kept.description ? 1 : 0);
    if (incomingWorth > keptWorth) {
      dropped.push(drop("DUPLICATE", products[at]));
      products[at] = product;
    } else {
      dropped.push(drop("DUPLICATE", product));
    }
  }

  // A category with no product is a section header that lost every listing to
  // the rules above; it must not reach the onboarding store as an empty shelf.
  const used = new Set(products.map((p) => normalizeKey(p.categoryName)));
  const categories: ImportedCategory[] = [];
  const droppedCategories: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.categories) {
    const name = normalizeName(raw.name);
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!used.has(key)) {
      droppedCategories.push(name);
      continue;
    }
    categories.push({ name });
  }

  return {
    categories,
    products,
    stats: input.stats,
    report: { dropped, droppedCategories, pricesAdjusted },
  };
}

/**
 * Merge the NVIDIA structurer's result with the deterministic parser's, then
 * gate the outcome — the merge that replaced the naive name-key union.
 *
 * `reconcileImports` (in `./menu-import`) unions both sources' names and lets
 * the parser keep the price on a conflict; run on a real café card that union
 * produced 68 products of which 36 were junk — description fragments split into
 * products, the section header `FOOD & DRINKS`, the three dietary-legend lines
 * and the address line. The union cannot be fixed by re-weighting it, because
 * the two sources disagree about WHAT AN ITEM IS, not about what it costs.
 *
 * So the structurer owns the shape and the parser only fills gaps:
 *   1. every structured row survives as-is (categories, descriptions and the
 *      item-vs-description judgement are the model's);
 *   2. a parser row is added ONLY when the name is absent AND the row carries a
 *      positive price — the completeness net for a priced line the model
 *      dropped, which is exactly the failure the two-run comparison caught;
 *   3. the merged result goes through `validateMenuImport`, so a recovered
 *      address line or legend cannot survive on its way to the owner.
 *
 * Identity is the normalized name alone, not name+section: a dish the
 * structurer already emitted is never re-added under a second section, which is
 * what would double-list it.
 */
export function mergeStructuredMenu(
  structured: MenuImportResult,
  parser: MenuImportResult,
): { result: MenuImportResult; report: MenuValidationReport; recovered: number } {
  const known = new Set(structured.products.map((p) => normalizeKey(p.name)).filter(Boolean));
  const products: ImportedProduct[] = [...structured.products];
  const categories: ImportedCategory[] = structured.categories.map((c) => ({ name: c.name }));
  const categoryKeys = new Set(categories.map((c) => normalizeKey(c.name)));
  const added: ImportedProduct[] = [];

  for (const row of parser.products) {
    const key = normalizeKey(row.name);
    if (!key || known.has(key)) continue;
    // A parser row with no printed price is a fragment — a wrapped description,
    // a header, a legend — and never a recoverable item.
    if (!(row.price > 0)) continue;

    const product: ImportedProduct = {
      name: normalizeName(row.name),
      description: normalizeName(row.description),
      price: normalizePrice(row.price),
      categoryName: normalizeName(row.categoryName) || UNCATEGORIZED,
    };
    known.add(key);
    products.push(product);
    added.push(product);

    const catKey = normalizeKey(product.categoryName);
    if (catKey && !categoryKeys.has(catKey)) {
      categoryKeys.add(catKey);
      categories.push({ name: product.categoryName });
    }
  }

  // The scan's own counts live on the parser result (it is built with the real
  // file/page totals); the structurer stage cannot know them. Its `model` is
  // what names this path.
  const counts = { files: parser.stats.files, pages: parser.stats.pages };
  const validated = validateMenuImport({
    categories,
    products,
    stats: { ...counts, source: "llm", model: structured.stats.model },
  });

  // The parser is only credited with a contribution that SURVIVED the gate: a
  // recovered address line the validator throws out must not be reported as a
  // source of the shipped menu.
  const survived = new Set(validated.products.map((p) => normalizeKey(p.name)));
  const recovered = added.filter((p) => survived.has(normalizeKey(p.name))).length;

  return {
    result: {
      categories: validated.categories,
      products: validated.products,
      stats: { ...counts, source: recovered > 0 ? "llm+parser" : "llm", model: structured.stats.model },
    },
    report: validated.report,
    recovered,
  };
}
