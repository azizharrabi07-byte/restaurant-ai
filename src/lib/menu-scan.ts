"server-only";

import dns from "node:dns";
// api.mistral.ai resolves to both IPv4 and IPv6; some networks cannot route the
// IPv6 address, and Node's fetch (no Happy Eyeballs) can hang if it picks it.
// Prefer IPv4 to dodge connection timeouts to the OCR service.
dns.setDefaultResultOrder("ipv4first");

/**
 * Menu photo/PDF → canonical menu import result (MenuImportResult).
 *
 * Pipeline: OCR (with whole-document json_schema annotation) → NORMALIZE →
 * SANITIZE → VALIDATE → MenuImportResult → onboarding store.
 *
 * Chat completions are intentionally NOT used: on the current subscription
 * tier they are rate-limited (429 code 1300) while the OCR quota is not.
 *
 * Structure strategy (in order, both funnel through sanitizeImport):
 *   1. OCR `document_annotation` (json_schema) — primary, runs on the OCR
 *      quota. (stats.source: "ai")
 *   2. Deterministic local parser over the OCR markdown — recovers products
 *      whenever the annotation under-extracts. (stats.source: "fallback")
 *
 * The importer never knows which wizard step opened it — it always returns
 * the complete menu.
 */

const MISTRAL_BASE = "https://api.mistral.ai";

import {
  buildMenuImport,
  reconcileImports,
  type ImportedCategory,
  type MenuImportResult,
} from "./menu-import";
import { assessOcrQuality } from "./ocr-quality";

export type { MenuImportResult, ImportedCategory } from "./menu-import";

export type ScanErrorCode =
  | "NO_KEY"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "BAD_TYPE"
  | "UPLOAD_FAILED"
  | "OCR_FAILED"
  | "RATE_LIMITED"
  | "EMPTY"
  | "NETWORK";

export class MenuScanError extends Error {
  code: ScanErrorCode;
  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ── Tuning / limits ─────────────────────────────────────────────────
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB per file
export const MAX_PAGES_PER_FILE = 20; // first N pages get OCR'd

const OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";

// How many times a single document is OCR'd before a degraded (HTTP 200 but
// structurally broken) response is accepted. Each attempt is a fresh OCR call
// against the same uploaded file_id.
const OCR_QUALITY_ATTEMPTS = 3;

// ── Stage logging (no secrets: never log keys, buffers, or prompts) ──
export function log(stage: string, extra: Record<string, unknown> = {}): void {
  const parts = Object.entries(extra)
    .filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(typeof v === "number" && Number.isNaN(v)),
    )
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  console.log(`[menu-scan] ${stage}${parts.length ? " " + parts.join(" ") : ""}`);
}

function apiKey(): string {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new MenuScanError("NO_KEY", "MISTRAL_API_KEY is not configured");
  return key;
}

const RATE_LIMIT_HTTP = 429;

/** POST + retry on transient network errors and 429 (bounded, exponential). */
async function postWithRetry(
  path: string,
  headers: Record<string, string>,
  body: BodyInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Fail fast on missing configuration: apiKey() throws NO_KEY here, OUTSIDE
  // the retry loop, so a missing MISTRAL_API_KEY is never misreported as a
  // NETWORK failure after ~20s of pointless retries.
  const key = apiKey();
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${MISTRAL_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          ...headers,
        },
        body,
      });
    } catch (err) {
      log("NETWORK RETRY", {
        path,
        attempt: attempt + 1,
        error: String(err).slice(0, 120),
      });
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 6000)));
        continue;
      }
      throw new MenuScanError(
        "NETWORK",
        `Mistral unreachable after 6 attempts (${path}): ${String(err).slice(0, 200)}`,
      );
    }
    if (res.status !== RATE_LIMIT_HTTP || attempt >= 2) {
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* no body */
      }
      return { ok: res.ok, status: res.status, data };
    }
    log("RATE LIMIT RETRY", { path, attempt: attempt + 1 });
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
  }
  throw new MenuScanError("RATE_LIMITED", "unreachable");
}

function errorFromStatus(
  path: string,
  res: { status: number; data: unknown },
  failureCode: ScanErrorCode,
): MenuScanError {
  const detail = JSON.stringify(res.data ?? "").slice(0, 200);
  const code: ScanErrorCode =
    res.status === 401 || res.status === 403
      ? "NO_KEY"
      : res.status === RATE_LIMIT_HTTP
        ? "RATE_LIMITED"
        : failureCode;
  return new MenuScanError(code, `Mistral ${path} → ${res.status} ${detail}`);
}

async function mistralJson<T>(path: string, body: BodyInit): Promise<T> {
  const res = await postWithRetry(path, { "Content-Type": "application/json" }, body);
  if (!res.ok) throw errorFromStatus(path, res, "OCR_FAILED");
  return res.data as T;
}

// ── Upload a buffer to Mistral Files, returning a document id ──────
async function uploadDocument(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  form.append("purpose", "ocr");

  const res = await postWithRetry("/v1/files", {}, form);
  if (!res.ok) throw errorFromStatus("/v1/files", res, "UPLOAD_FAILED");
  const data = res.data as { id?: string };
  if (!data.id) throw new MenuScanError("UPLOAD_FAILED", "Mistral upload returned no file id");
  return data.id;
}

// ── Build the OCR annotation spec (json_schema for the whole document) ─
function annotationSpec(venue: string): {
  prompt: string;
  format: Record<string, unknown>;
} {
  const target = venue.trim() || "the restaurant whose menu is being scanned";
  const prompt = [
    `Extract the menu belonging to "${target}" from this document as one strict JSON object.`,
    `The document may contain several venues or menu cards: return ONLY the dishes and section`,
    `headings of the target venue. Drop other venues, advertisements, allergen disclaimers,`,
    `phone numbers, and unrelated text. Never merge dishes from another venue in.`,
    `Group each dish under its printed section heading, used verbatim, as a "category".`,
    `"price": a NUMBER in Tunisian Dinar (TND). "4.500 DT" -> 4.5, "12.500" -> 12.5, "6 DT" -> 6;`,
    `convert EUR/USD approximately (1 EUR ~ 3.4 TND, 1 USD ~ 3.1 TND); no price -> 0.`,
    `Never output currency symbols or commas. "description": only if printed, otherwise "".`,
    `Never invent dishes or categories. Output ONLY the JSON object matching the schema.`,
  ].join(" ");
  return {
    prompt,
    format: {
      type: "json_schema",
      json_schema: {
        name: "menu",
        strict: true,
        schema: {
          type: "object",
          properties: {
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        price: { type: "number" },
                      },
                      required: ["name", "description", "price"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "items"],
                additionalProperties: false,
              },
            },
          },
          required: ["categories"],
          additionalProperties: false,
        },
      },
    },
  };
}

// ── Run OCR on one uploaded document → markdown (+ annotation JSON) ─
interface OcrOutcome {
  markdown: string;
  annotation: string | null;
  pages: number;
}

async function ocrDocument(
  fileId: string,
  spec: ReturnType<typeof annotationSpec>,
): Promise<OcrOutcome> {
  const t0 = Date.now();
  for (let attempt = 1; attempt <= OCR_QUALITY_ATTEMPTS; attempt++) {
    const data = await mistralJson<{
      pages?: { markdown?: string }[];
      document_annotation?: string | null;
    }>(
      "/v1/ocr",
      JSON.stringify({
        model: OCR_MODEL,
        document: { type: "file", file_id: fileId },
        pages: `0-${MAX_PAGES_PER_FILE - 1}`,
        include_image_base64: false,
        image_limit: 0,
        table_format: "markdown",
        document_annotation_format: spec.format,
        document_annotation_prompt: spec.prompt,
      }),
    );
    const pages = data.pages ?? [];
    const markdown = pages
      .map((p, i) => `\n\n<!-- page ${i + 1} -->\n${p.markdown ?? ""}`)
      .join("");
    log("OCR RESPONSE PARSE", {
      fileId: fileId.slice(0, 8),
      attempt,
      pages: pages.length,
      chars: markdown.length,
      annotationBytes: data.document_annotation ? data.document_annotation.length : 0,
      ms: Date.now() - t0,
    });
    if (pages.length === 0 && !data.document_annotation) {
      throw new MenuScanError("OCR_FAILED", "Mistral OCR returned no pages");
    }

    // Quality gate: catch HTTP-200-but-degraded OCR (observed: a few item
    // lines, no heading structure) BEFORE the annotation/parser phase sees it.
    const quality = assessOcrQuality(markdown);
    log("OCR QUALITY", {
      attempt,
      ok: quality.ok,
      reason: quality.reason,
      chars: quality.chars,
      items: quality.items,
      headings: quality.headings,
      priced: quality.priced,
    });
    if (quality.ok) {
      return {
        markdown,
        annotation: data.document_annotation ?? null,
        pages: pages.length,
      };
    }
    if (attempt < OCR_QUALITY_ATTEMPTS) {
      log("OCR QUALITY RETRY", {
        fileId: fileId.slice(0, 8),
        attempt,
        reason: quality.reason,
        items: quality.items,
        headings: quality.headings,
      });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new MenuScanError(
      "OCR_FAILED",
      `OCR degraded after ${OCR_QUALITY_ATTEMPTS} attempts (${quality.reason}, ${quality.items} items, ${quality.headings} headings)`,
    );
  }
  throw new MenuScanError("OCR_FAILED", "unreachable");
}

// ── Deterministic local parser (fallback, no LLM quota) ────────────
// OCR markdown such as "# Venue" / "## Coffees" / "Cappuccino 4.500 DT" is
// structured directly: headings → categories, priced lines → items. Raw input
// cards, table links, and other artifacts are filtered later by sanitizeImport.

export interface ParserCategory {
  name: string;
  items: ImportedCategoryItems[];
}

interface ImportedCategoryItems {
  name: string;
  description: string;
  price: number;
}

const HEADING_RE = /^#{1,3}\s+(.+)$/;
const PRICE_SPLIT_RE =
  /(.+?)\s+(\d+(?:[,.]\d+)*)\s*(?:DT|TND|د\.?ت|€|USD|E)?\s*$/i;
const PRICE_ONLY_RE = /^(\d+(?:[,.]\d+)*)\s*(?:DT|TND|د\.?ت|€|USD|E)?\s*$/i;
const BULLET_RE = /^[-•*–—·]+\s*/;

function normalizeHeading(name: string): string {
  return name.replace(/\*\*/g, "").trim();
}

function isJunkHeading(name: string, venue: string): boolean {
  const v = name.toLowerCase();
  const target = venue.trim().toLowerCase();
  if (target && (v === target || v.startsWith(target))) return true;
  if (/^(menu|carte|drinks?|food|beverages?)$/i.test(v)) return true;
  return /(\+?\d[\d\s.-]{6,}|tél|tel|phone|address|horaire|hours|www\.)/i.test(v);
}

function cleanItemName(raw: string): string {
  let s = raw.replace(BULLET_RE, "").trim();
  // Strip leading list ordinals like "1." or "1)" when not part of a name.
  s = s.replace(/^(\d+)[.)]\s+/, "").trim();
  return s;
}

function extractPriceToNumber(match: string): number {
  const s = match.trim().replace(/[\s()]/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let num: number;
  if (hasComma && !hasDot) {
    num = Number(s.replace(",", "."));
  } else {
    num = Number(s);
  }
  if (!Number.isFinite(num) || num < 0) num = 0;
  return Math.min(Math.round(num * 1000) / 1000, 9999);
}

/** Parse OCR markdown into parser categories (name + items). Not sanitized yet. */
export function parseOcrMarkdown(markdown: string, venue: string): ParserCategory[] {
  const categories: ParserCategory[] = [];
  let sink: ImportedCategoryItems[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(HEADING_RE);
    if (heading) {
      const name = normalizeHeading(heading[1]);
      if (!name || isJunkHeading(name, venue)) continue;
      categories.push({ name, items: [] });
      sink = categories[categories.length - 1].items;
      continue;
    }

    const priceOnly = line.match(PRICE_ONLY_RE);
    if (priceOnly) {
      // A lone price usually continues the previous item (OCR page break).
      const prev = sink[sink.length - 1];
      if (prev && prev.price === 0) prev.price = extractPriceToNumber(priceOnly[1]);
      continue;
    }

    const priced = line.match(PRICE_SPLIT_RE);
    const itemName = cleanItemName(priced ? priced[1] : line);
    if (!itemName) continue;

    // Skip obvious venue/contact noise while still pre-heading.
    if (!priced && categories.length === 0 && isJunkHeading(line, venue)) continue;

    sink.push({
      name: itemName,
      description: "",
      price: priced ? extractPriceToNumber(priced[2]) : 0,
    });
  }

  if (categories.length === 0 && sink.length > 0) {
    categories.push({ name: "Menu", items: sink });
  }
  return categories;
}

// ── Top-level orchestration ────────────────────────────────────────
export interface ScanInputFile {
  buffer: Buffer;
  name: string;
  mime: string;
}

export async function runMenuScan(
  files: ScanInputFile[],
  venue: string,
): Promise<MenuImportResult> {
  const t0 = Date.now();
  log("VALIDATE", { files: files.length, venue: venue.length ? venue : "(none)" });
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new MenuScanError("TOO_MANY_FILES", `expected 1..${MAX_FILES} files`);
  }
  for (const f of files) {
    if (f.buffer.length > MAX_FILE_BYTES) {
      throw new MenuScanError("FILE_TOO_LARGE", `${f.name} exceeds ${MAX_FILE_BYTES} bytes`);
    }
    const isDoc = f.mime.startsWith("image/") || f.mime === "application/pdf";
    if (!isDoc) throw new MenuScanError("BAD_TYPE", `${f.name} is not an image or PDF`);
  }

  // 1. Upload each file.
  log("UPLOAD", { count: files.length });
  const fileIds: string[] = [];
  for (const f of files) {
    const t1 = Date.now();
    const id = await uploadDocument(f.buffer, sanitizeFilename(f.name), f.mime);
    log("UPLOAD", { name: f.name, mime: f.mime, bytes: f.buffer.length, ms: Date.now() - t1 });
    fileIds.push(id);
  }

  // 2. OCR each document (markdown + whole-document annotation JSON).
  log("OCR", { count: fileIds.length });
  const spec = annotationSpec(venue);
  const outcomes: OcrOutcome[] = [];
  for (const id of fileIds) {
    outcomes.push(await ocrDocument(id, spec));
  }
  const markdown = outcomes
    .map((o) => o.markdown.trim())
    .filter(Boolean)
    .join("\n\n===== NEXT DOCUMENT =====\n\n");
  const pages = outcomes.reduce((sum, o) => sum + o.pages, 0);
  log("OCR DONE", { docs: outcomes.length, pages, chars: markdown.length });

  // 3. Structure phase. The OCR annotation (an LLM) is stochastic and can
  // under-extract categories from one run to the next, so we ALWAYS run the
  // deterministic parser too and keep whichever result is richer. This guards
  // against "it found fewer categories than last time".
  log("STRUCTURE", { strategy: "ocr-annotation", model: OCR_MODEL });
  const rawAnnotationCategories: unknown[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const a = outcomes[i].annotation;
    if (!a) {
      log("STRUCTURE SKIP", { doc: i, reason: "no-annotation" });
      continue;
    }
    try {
      const parsed = JSON.parse(a) as { categories?: unknown[] };
      if (Array.isArray(parsed.categories)) {
        rawAnnotationCategories.push(...parsed.categories);
      } else {
        log("STRUCTURE INVALID JSON", { doc: i, bytes: a.length });
      }
    } catch (e) {
      log("STRUCTURE JSON PARSE FAIL", { doc: i, reason: String(e), bytes: a.length });
    }
  }
  const aiResult = buildMenuImport(
    { categories: rawAnnotationCategories },
    { files: files.length, pages, source: "ai", model: OCR_MODEL },
  );
  log("STRUCTURE", { strategy: "local-parser", reason: "always runs as baseline" });
  if (!markdown.trim()) {
    throw new MenuScanError("EMPTY", "OCR returned no text");
  }
  const fbResult = buildMenuImport(
    { categories: parseOcrMarkdown(markdown, venue) },
    { files: files.length, pages, source: "fallback", model: "local-parser" },
  );

  const best = reconcileImports(aiResult, fbResult);
  if (best.products.length === 0) {
    throw new MenuScanError("EMPTY", "No dishes or drinks could be read from the menu");
  }
  const items = best.products.length;
  log("FINAL", {
    strategy: "reconcile",
    source: best.stats.source,
    model: best.stats.model,
    categories: best.categories.length,
    items,
    aiItems: aiResult.products.length,
    parserItems: fbResult.products.length,
    ms: Date.now() - t0,
  });
  return best;
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return base || "menu-document";
}