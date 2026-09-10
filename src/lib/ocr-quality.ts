/**
 * Deterministic OCR completeness/quality gate.
 *
 * Mistral OCR occasionally returns HTTP 200 with degraded markdown (e.g. a
 * handful of item lines and NO heading structure). That response is currently
 * accepted silently, which collapses the whole menu extraction. This gate
 * inspects the OCR markdown and flags obviously lost responses so the OCR
 * stage can retry before annotation/parser/tuning ever see the content.
 *
 * It is PURELY structural. It never assumes a minimum number of categories or
 * products, so arbitrary real menus pass; only responses that look genuinely
 * broken (near-empty, item-free, or full of item content with no heading
 * structure / ending mid-section) are flagged.
 */

const MIN_NON_WS_CHARS = 8;
const MIN_ITEMS_FOR_STRUCTURE = 3;

const HEADING_RE = /^#{1,3}\s+\S/;
const PRICE_RE = /^(.+?)\s+(\d+(?:[,.]\d+)*)\s*(?:DT|TND|د\.?ت|€|USD|E)?\s*$/i;
const PRICE_ONLY_RE = /^(\d+(?:[,.]\d+)*)\s*(?:DT|TND|د\.?ت|€|USD|E)?\s*$/i;
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
  /** markdown heading lines (#/##/###) */
  headings: number;
  /** content lines carrying a trailing price token */
  priced: number;
}

export function assessOcrQuality(markdown: unknown): OcrQuality {
  const text = typeof markdown === "string" ? markdown : "";
  let chars = 0;
  let items = 0;
  let priced = 0;
  let headings = 0;
  let anyItem = false;
  let endsOnHeading = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    chars += line.replace(/\s+/g, "").length;

    if (HEADING_RE.test(line)) {
      headings++;
      endsOnHeading = true;
      continue;
    }
    if (NOISE_RE.test(line)) continue;
    items++;
    anyItem = true;
    endsOnHeading = false;
    if (PRICE_ONLY_RE.test(line) || PRICE_RE.test(line)) priced++;
  }

  const base = { chars, items, headings, priced };

  if (chars < MIN_NON_WS_CHARS) return { ok: false, reason: "EMPTY_TEXT", ...base };
  if (items === 0) return { ok: false, reason: "NO_ITEMS", ...base };
  if (items >= MIN_ITEMS_FOR_STRUCTURE && headings === 0) {
    // Real content exists but NOT ONE heading was OCR'd — the classic degraded
    // signature (observed: ~3 item lines, no headings). A genuine two-item
    // headingless mini-menu stays under MIN_ITEMS_FOR_STRUCTURE and passes.
    return { ok: false, reason: "NO_STRUCTURE", ...base };
  }
  if (items > 0 && endsOnHeading) {
    // Document stops on a section heading with nothing after it: looks cut.
    return { ok: false, reason: "TRUNCATED", ...base };
  }

  return { ok: true, reason: null, ...base };
}