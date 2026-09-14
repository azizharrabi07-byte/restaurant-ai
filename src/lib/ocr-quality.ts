import { NAME_PRICE_LINE_RE, PRICE_ONLY_LINE_RE } from "./menu-import";

/**
 * Deterministic OCR completeness/quality gate.
 *
 * Mistral OCR occasionally returns HTTP 200 with genuinely broken markdown
 * (near-empty, or page markers with no content at all). This gate inspects the
 * OCR markdown and flags those responses so the OCR stage can retry.
 *
 * It is PURELY structural. It never assumes a minimum number of categories or
 * products, so arbitrary real menus pass; only responses that look genuinely
 * broken (near-empty, item-free, or ending mid-section) are flagged.
 *
 * It deliberately does NOT reject headingless content that carries prices: a
 * three-line price board IS a menu, and `parseOcrMarkdown`'s "Menu" catch-all
 * exists precisely to structure it. Rejecting it burned three paid OCR calls
 * and then failed the whole scan on a legitimate small menu (OCR-05).
 */

const MIN_NON_WS_CHARS = 8;
const MIN_ITEMS_FOR_STRUCTURE = 3;

const HEADING_RE = /^#{1,6}\s+\S/;
/** A whole line set in bold is how OCR often renders a section heading. */
const BOLD_HEADING_RE = /^\*\*[^*]{1,80}\*\*:?$/;
// Structural separators the pipeline itself emits (page markers, doc separators).
const NOISE_RE = /^(<!--|===+|-{3,})/;

export type OcrQualityReason = "EMPTY_TEXT" | "NO_ITEMS" | "NO_STRUCTURE" | "TRUNCATED";

export interface OcrQuality {
  ok: boolean;
  reason: OcrQualityReason | null;
  /** non-whitespace characters */
  chars: number;
  /** content lines that look like menu items (priced or not) */
  items: number;
  /** markdown heading lines (#/##/###/…, or a fully-bold line) */
  headings: number;
  /** content lines carrying a price token */
  priced: number;
}

export function assessOcrQuality(markdown: unknown): OcrQuality {
  const text = typeof markdown === "string" ? markdown : "";
  let chars = 0;
  let items = 0;
  let priced = 0;
  let headings = 0;
  let endsOnHeading = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    chars += line.replace(/\s+/g, "").length;

    if (HEADING_RE.test(line) || BOLD_HEADING_RE.test(line)) {
      headings++;
      endsOnHeading = true;
      continue;
    }
    if (NOISE_RE.test(line)) continue;
    items++;
    endsOnHeading = false;
    if (PRICE_ONLY_LINE_RE.test(line) || NAME_PRICE_LINE_RE.test(line)) priced++;
  }

  const base = { chars, items, headings, priced };

  if (chars < MIN_NON_WS_CHARS) return { ok: false, reason: "EMPTY_TEXT", ...base };
  if (items === 0) return { ok: false, reason: "NO_ITEMS", ...base };
  if (items >= MIN_ITEMS_FOR_STRUCTURE && headings === 0 && priced === 0) {
    // Several content lines, no heading and NOT ONE price: the document carries
    // text but no menu shape at all. Headingless content that DOES carry prices
    // is a legitimate (if small) price board and is accepted —
    // `parseOcrMarkdown` files it under its "Menu" catch-all, which the old
    // blanket rejection made unreachable (OCR-05).
    return { ok: false, reason: "NO_STRUCTURE", ...base };
  }
  if (items > 0 && endsOnHeading) {
    // Document stops on a section heading with nothing after it: looks cut.
    return { ok: false, reason: "TRUNCATED", ...base };
  }

  return { ok: true, reason: null, ...base };
}

// ── Provider response → parser input ───────────────────────────────
//
// This lives here, next to the gate that also reads the assembled text, so the
// folding logic is unit-testable against captured provider payloads: it is a
// pure function of the OCR response, while `menu-scan.ts` is `"server-only"`.

/**
 * One table as Mistral returns it. With `table_format: "markdown"` the BODY
 * arrives in `content`; the captured live response for a table-laid-out menu
 * is `{id:"tbl-0.md", content:"|  Espresso | 1.200  |\n| --- | --- |…",
 * format:"markdown", word_confidence_scores:{…}}` — there is no `markdown` key
 * at all on the table object. `markdown` is kept as the fallback field name for
 * provider versions that use it.
 */
export interface OcrTable {
  /** The table's own name: the string the page markdown links to. */
  id?: string | null;
  content?: string | null;
  markdown?: string | null;
  format?: string | null;
}

/** One OCR page as Mistral returns it. */
export interface OcrPage {
  markdown?: string | null;
  tables?: (OcrTable | null)[] | null;
}

/** The body of one table, whichever field this provider version filled. */
function tableBody(table: OcrTable | null | undefined): string {
  // `||` (not `??`): an empty string is no content, so it falls through to the
  // other field name rather than contributing nothing.
  return (table?.content || table?.markdown || "").trim();
}

/** `[tbl-3.md](tbl-3.md)` — what the page text keeps in place of a table. */
const TABLE_PLACEHOLDER_RE = /\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * One page's text with every table placeholder REPLACED by that table's body.
 *
 * The provider pairs them by name: the placeholder links to the table's own
 * `id` (`[tbl-0.md](tbl-0.md)` ↔ `tables[i].id === "tbl-0.md"`). Keeping that
 * pairing is what preserves the printed structure. Appending the bodies at the
 * end instead leaves each section caption ("CAFÉS", "BOISSONS FROIDES", …)
 * stranded on its own line with its dishes unattached, so the captions were
 * imported as 0-price products and all 19 dishes were filed under the venue's
 * own name.
 *
 * A body whose placeholder is missing (or a placeholder whose body is missing)
 * is kept below the page text, in table order, so no content is ever lost.
 */
function pageWithTables(page: OcrPage): string {
  const text = page.markdown ?? "";
  const tables = page.tables ?? [];
  const indexById = new Map<string, number>();
  tables.forEach((table, i) => {
    if (table?.id) indexById.set(table.id, i);
  });
  const placed = new Set<number>();
  let order = 0;
  const withBodies = text.replace(TABLE_PLACEHOLDER_RE, (whole, label: string, target: string) => {
    // By name when the provider gave one, otherwise in document order.
    const index = indexById.get(target) ?? indexById.get(label) ?? order;
    order++;
    const body = tableBody(tables[index]);
    if (!body || placed.has(index)) return whole;
    placed.add(index);
    return body;
  });
  const leftovers = tables
    .map((table, i) => (placed.has(i) ? "" : tableBody(table)))
    .filter(Boolean)
    .join("\n\n");
  return leftovers ? `${withBodies}\n\n${leftovers}` : withBodies;
}

/**
 * The parser input for one document: every page's text with its table bodies in
 * place. `table_format: "markdown"` makes Mistral return tables OUT of
 * `page.markdown` — which keeps only a `[tbl-N.md](tbl-N.md)` placeholder — and
 * into `page.tables`, so a grid-laid-out menu (most printed Tunisian menus) is
 * invisible to the deterministic baseline unless the bodies are folded back in
 * (OCR-04).
 *
 * `format` is deliberately NOT used to choose a field: a body the provider
 * labels `html` (or anything else) still reaches the parser instead of being
 * dropped in silence, and `menu-scan.ts` logs the formats it saw.
 */
export function documentText(pages: OcrPage[]): string {
  return pages.map((p, i) => `\n\n<!-- page ${i + 1} -->\n${pageWithTables(p)}`).join("");
}