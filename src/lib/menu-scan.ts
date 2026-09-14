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
  isVenueChrome,
  isVenueChromeLine,
  NAME_PRICE_LINE_RE,
  PRICE_ONLY_LINE_RE,
  normalizeName,
  normalizeOcrDigits,
  sanitizePrice,
  type ImportedCategory,
  type MenuImportResult,
} from "./menu-import";
import { assessOcrQuality, documentText, type OcrPage } from "./ocr-quality";

export type { MenuImportResult, ImportedCategory } from "./menu-import";

/**
 * The single error vocabulary of the scan feature: raised here, mapped to HTTP
 * by `api/menu/scan/route.ts` and to a localized message by the scan dialog.
 * `HEIC` and `BAD_IMAGE` are raised by the browser-side `prepareUploadFile`
 * (a HEIC photo Chrome/Firefox cannot decode / a file that is not a readable
 * image) and travel to the owner through the same table.
 */
export type ScanErrorCode =
  | "NO_KEY"
  | "PROVIDER_AUTH"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "BAD_TYPE"
  | "BAD_IMAGE"
  | "HEIC"
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

/**
 * Wall-clock budget. `route.ts` sets `maxDuration = 120`, so the whole scan —
 * uploads + OCR + quality-retry sleeps — has to finish inside two minutes or
 * the platform kills the request with no typed error and no partial result
 * (OCR-06).
 *
 * Worst case for the maximum accepted input (6 files, all serial):
 *   uploads  6 × (25 s timeout + 2 s back-off + 4 s back-off) ≈ 186 s
 *   OCR      6 × 3 attempts × (90 s timeout + 1.5–3 s back-off) ≈ 1701 s
 * Neither is allowed to elapse: `postWithRetry` refuses to START a call once
 * the deadline has passed, and every call also carries the deadline as its
 * abort signal, so an in-flight request is cut at the budget. SCAN_BUDGET_MS
 * (110 s) is therefore the real bound, and it sits 10 s below the route's
 * maxDuration so the cleanup pass below can still run and the handler can still
 * write a typed NETWORK response instead of being killed mid-flight.
 */
const UPLOAD_TIMEOUT_MS = 25_000;
const OCR_TIMEOUT_MS = 90_000;
/** Hard ceiling for one runMenuScan call; below the route's 120 s maxDuration. */
export const SCAN_BUDGET_MS = 110_000;

const OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";

// How many times a single document is OCR'd before the best markdown seen is
// accepted. A structurally degraded response is retried; after the last attempt
// the best attempt is USED rather than thrown away, because the deterministic
// parser can structure output the gate cannot (OCR-05).
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

/** Bounded back-off; the sleep budget is what the scan deadline protects. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * A per-call deadline: every provider request is aborted when the scan's total
 * budget is exhausted, or after `perAttemptMs`, whichever comes first. An abort
 * surfaces as a `DOMException`/`Error`, so the existing catch turns it into the
 * same typed `NETWORK` failure as a connection reset instead of leaking a raw
 * `TypeError` to the dialogs (OCR-06).
 */
function deadlineSignal(scanDeadline: number, perAttemptMs: number): AbortSignal {
  const remaining = scanDeadline - Date.now();
  const limits = [AbortSignal.timeout(perAttemptMs)];
  if (remaining > 0) limits.push(AbortSignal.timeout(remaining));
  return AbortSignal.any(limits);
}

/** POST + retry on transient network errors and 429 (bounded, exponential). */
async function postWithRetry(
  path: string,
  headers: Record<string, string>,
  body: BodyInit,
  opts: { timeoutMs: number; deadline: number },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Fail fast on missing configuration: apiKey() throws NO_KEY here, OUTSIDE
  // the retry loop, so a missing MISTRAL_API_KEY is never misreported as a
  // NETWORK failure after ~20s of pointless retries.
  const key = apiKey();
  for (let attempt = 0; attempt < 6; attempt++) {
    // Refuse to start a provider call we cannot finish inside the budget: the
    // alternative is the platform killing the request with no partial result.
    if (Date.now() >= opts.deadline) {
      throw new MenuScanError("NETWORK", `scan budget exhausted before ${path}`);
    }
    let res: Response;
    try {
      res = await fetch(`${MISTRAL_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          ...headers,
        },
        body,
        signal: deadlineSignal(opts.deadline, opts.timeoutMs),
      });
    } catch (err) {
      // An abort (timeout or budget) is retryable exactly like a network error,
      // but it is not worth a further attempt once the budget is gone.
      log("NETWORK RETRY", {
        path,
        attempt: attempt + 1,
        aborted: isAbortError(err),
        error: String(err).slice(0, 120),
      });
      if (attempt < 5 && Date.now() < opts.deadline) {
        await sleep(Math.min(2000 * (attempt + 1), 6000));
        continue;
      }
      throw new MenuScanError(
        "NETWORK",
        `Mistral unreachable after ${attempt + 1} attempt(s) (${path}): ${String(err).slice(0, 200)}`,
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
    await sleep(5000 * (attempt + 1));
  }
  throw new MenuScanError("RATE_LIMITED", "unreachable");
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function errorFromStatus(
  path: string,
  res: { status: number; data: unknown },
  failureCode: ScanErrorCode,
): MenuScanError {
  const detail = JSON.stringify(res.data ?? "").slice(0, 200);
  const code: ScanErrorCode =
    res.status === 401 || res.status === 403
      ? // A revoked/expired/plan-limited key is an operations incident, NOT the
        // "feature is unconfigured" state NO_KEY reports — telling the owner to
        // configure a key that is already configured sends them the wrong way
        // (OCR-16).
        "PROVIDER_AUTH"
      : res.status === RATE_LIMIT_HTTP
        ? "RATE_LIMITED"
        : failureCode;
  return new MenuScanError(code, `Mistral ${path} → ${res.status} ${detail}`);
}

async function mistralJson<T>(
  path: string,
  body: BodyInit,
  opts: { timeoutMs: number; deadline: number },
): Promise<T> {
  const res = await postWithRetry(path, { "Content-Type": "application/json" }, body, opts);
  if (!res.ok) throw errorFromStatus(path, res, "OCR_FAILED");
  return res.data as T;
}

/**
 * The annotation's category array, CLASSIFIED rather than merely narrowed.
 *
 * "malformed" (payload is not an object, or `categories` is not an array) and
 * "empty" (a valid `categories` array carrying no dish at all) are different
 * outcomes and must not collapse into one. The venue-gated prompt made the
 * empty one the normal answer whenever the typed venue name did not match the
 * header printed on the card, and the caller could not tell it apart from a
 * schema violation, so it logged NOTHING: the same photograph with venue
 * "ZZ Test Cafe" returned 0 AI items, with the printed venue name 19.
 * The split is exported so a test can pin it.
 */
export type AnnotationCategories =
  | { kind: "categories"; categories: unknown[] }
  | { kind: "empty" }
  | { kind: "malformed" };

export function annotationCategories(annotation: unknown): AnnotationCategories {
  if (annotation === null || typeof annotation !== "object") return { kind: "malformed" };
  const { categories } = annotation as { categories?: unknown };
  if (!Array.isArray(categories)) return { kind: "malformed" };
  // A category with an empty `items` array is the same "read nothing" outcome:
  // `{"categories":[{"name":"CAFÉS","items":[]}]}` carries no dish either.
  const carriesDishes = categories.some((c) => {
    if (c === null || typeof c !== "object") return false;
    const { items } = c as { items?: unknown };
    return Array.isArray(items) && items.length > 0;
  });
  return carriesDishes ? { kind: "categories", categories } : { kind: "empty" };
}

// ── Upload bytes to Mistral Files, returning a document id ──────
async function uploadDocument(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  deadline: number,
): Promise<string> {
  const form = new FormData();
  // `bytes` is already a view over the request's own ArrayBuffer (the route
  // avoids copying it into a Buffer), so only the Blob and the multipart body
  // for the in-flight file are extra copies (OCR-07).
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("purpose", "ocr");

  const res = await postWithRetry("/v1/files", {}, form, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    deadline,
  });
  if (!res.ok) throw errorFromStatus("/v1/files", res, "UPLOAD_FAILED");
  const data = res.data as { id?: string };
  if (!data.id) throw new MenuScanError("UPLOAD_FAILED", "Mistral upload returned no file id");
  return data.id;
}

/**
 * Best-effort DELETE of an uploaded document. Mistral keeps every uploaded file
 * until it is deleted, so without this each scan permanently retains the
 * owner's menu photographs (quota growth + a data-retention exposure) — OCR-08.
 * A failed delete is logged and never fails the scan: the scan's real result is
 * worth more than the cleanup.
 */
async function deleteDocument(fileId: string): Promise<void> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return;
  try {
    const res = await fetch(`${MISTRAL_BASE}/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    log("UPLOAD CLEANUP", { fileId: fileId.slice(0, 8), status: res.status });
  } catch (err) {
    log("UPLOAD CLEANUP FAILED", { fileId: fileId.slice(0, 8), error: String(err).slice(0, 120) });
  }
}

// ── Build the OCR annotation spec (json_schema for the whole document) ─
/** Prompt + `document_annotation_format` sent to Mistral's OCR endpoint. */
export interface AnnotationSpec {
  prompt: string;
  format: Record<string, unknown>;
}
/** Exported so the prompt's contract is pinned by a test. */
export function annotationSpec(venue: string): AnnotationSpec {
  const target = venue.trim();
  const prompt = [
    `Read every dish and drink printed on this document and return them as one strict JSON object.`,
    // The venue is a HINT, never a gate. The owner types a display name while
    // the card's header may differ, be abbreviated, or be written in another
    // script, and a filter that authorises "nothing matched this venue" is
    // exactly what made the model answer {"categories": []} — a silent,
    // unlogged fallback for a perfectly readable photograph.
    target
      ? `"${target}" is only a DISAMBIGUATION HINT for choosing between several venues on one page: the printed header may spell it differently, abbreviate it, or be in another script, so never let it decide whether to extract.`
      : `If the document holds several venues or menu cards, extract the main printed menu.`,
    `Always extract the dishes visible in the document, including when one venue holds the only menu and whatever that menu is called;`,
    `a non-empty categories array is required whenever the card prints at least one dish.`,
    `Drop other venues, advertisements, allergen disclaimers, phone numbers, addresses, card footers, and unrelated text.`,
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
  annotation: unknown;
  pages: number;
  /**
   * Which upload and which OCR attempt produced this outcome. Carried so the
   * structure phase can name both when it has to report a degradation: without
   * them, "the annotation came back empty" is unactionable in the logs.
   */
  fileId: string;
  attempt: number;
}

// The provider's page objects are folded into parser input by `documentText`
// in `./ocr-quality`: it is pure (no "server-only"), so the folding can be
// tested against captured provider payloads. See there for why a table's body
// lives in `content` rather than in `markdown`.

async function ocrDocument(
  fileId: string,
  spec: AnnotationSpec,
  deadline: number,
): Promise<OcrOutcome> {
  const t0 = Date.now();
  // The structurally FITTEST response seen so far. A degraded response is
  // retried, but a retry that comes back and is still degraded must not throw
  // away a perfectly parseable first attempt: the deterministic parser can
  // structure headingless content (OCR-05).
  let best: { outcome: OcrOutcome; score: number } | null = null;

  for (let attempt = 1; attempt <= OCR_QUALITY_ATTEMPTS; attempt++) {
    const data = await mistralJson<{
      pages?: OcrPage[];
      document_annotation?: unknown;
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
      { timeoutMs: OCR_TIMEOUT_MS, deadline },
    );
    const pages = data.pages ?? [];
    const markdown = documentText(pages);
    const annotationType = Array.isArray(data.document_annotation)
      ? "array"
      : (data.document_annotation ?? null) === null
        ? "null"
        : typeof data.document_annotation;
    log("OCR RESPONSE PARSE", {
      fileId: fileId.slice(0, 8),
      attempt,
      pages: pages.length,
      chars: markdown.length,
      annotationType,
      tables: pages.reduce((n, p) => n + (p.tables?.length ?? 0), 0),
      // The format each table body DECLARES. `documentText` never branches on
      // it (no format may silently drop a body), so it is surfaced here so a
      // non-markdown body is at least visible in the logs.
      tableFormats: [
        ...new Set(pages.flatMap((p) => (p.tables ?? []).map((t) => t?.format ?? "(none)"))),
      ],
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
    const outcome: OcrOutcome = {
      markdown,
      annotation: data.document_annotation ?? null,
      pages: pages.length,
      fileId,
      attempt,
    };
    // "Fitness" = information, not structure: a headingless 3-item menu the
    // gate dislikes is still worth far more than an image-free stub.
    const score = quality.chars + quality.items * 10 + quality.priced * 10;
    if (!best || score > best.score) best = { outcome, score };
    if (quality.ok) return outcome;

    if (attempt < OCR_QUALITY_ATTEMPTS && Date.now() < deadline) {
      log("OCR QUALITY RETRY", {
        fileId: fileId.slice(0, 8),
        attempt,
        reason: quality.reason,
        items: quality.items,
        headings: quality.headings,
      });
      await sleep(1500 * attempt);
      continue;
    }
    break;
  }

  // Every attempt was structurally imperfect. Use the best one: the parser's
  // catch-all section structures even a headingless price board, so failing the
  // whole scan here burns three paid OCR calls to return nothing (OCR-05).
  if (best) {
    log("OCR QUALITY DEGRADED ACCEPT", {
      fileId: fileId.slice(0, 8),
      chars: best.outcome.markdown.length,
      score: best.score,
    });
    return best.outcome;
  }
  throw new MenuScanError("OCR_FAILED", "OCR returned nothing usable");
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

// `#{1,6}`: `#### Starters` is an ordinary OCR rendering of a section heading
// and used to become a *product* named "#### Starters" (OCR-05, OCR-17).
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
/** A fully-bold line is a heading too: "**Nos Boissons**". */
const BOLD_HEADING_RE = /^\*\*(.+?)\*\*:?$/;
/** Data row of a markdown table: "| Café | 2.500 |". */
const TABLE_ROW_RE = /^\|(.*)\|\s*$/;
const BULLET_RE = /^[-•*–—·]+\s*/;

function normalizeHeading(name: string): string {
  return name.replace(/\*\*/g, "").replace(/\s*:\s*$/, "").trim();
}

/**
 * Headings that are venue chrome rather than menu sections. The venue match
 * needs a word boundary: with venue "Le", the old prefix test dropped the real
 * heading "Legumes Grilles" and moved its dishes into the catch-all (OCR-17).
 * The chrome test itself is the shared `isVenueChrome`, so a line the sanitizer
 * would reject can no longer open a category here either.
 */
function isJunkHeading(name: string, venue: string): boolean {
  const v = name.toLowerCase();
  const target = venue.trim().toLowerCase();
  if (target && (v === target || v.startsWith(`${target} `))) return true;
  return isVenueChrome(name);
}

function cleanItemName(raw: string): string {
  let s = raw.replace(BULLET_RE, "").trim();
  // Strip leading list ordinals like "1." or "1)" when not part of a name.
  s = s.replace(/^(\d+)[.)]\s+/, "").trim();
  return s;
}

/**
 * Cells of a markdown table row, or null when the line is not one. A row made
 * only of `-`/`:` padding (`|---|---|`) is the alignment separator, reported as
 * such so the caller can also discard the header row above it.
 */
function tableRow(line: string): { cells: string[]; separator: boolean } | null {
  const row = line.match(TABLE_ROW_RE);
  if (!row) return null;
  const cells = row[1].split("|").map((c) => c.trim());
  return { cells, separator: !cells.some((c) => /[^-:\s]/.test(c)) };
}

/**
 * Is the line at `i` the printed caption of a table whose first row follows it?
 *
 * With `table_format:"markdown"` Mistral prints a table's caption as ordinary
 * text ("CAFÉS") and puts its rows in the table body, so the caption used to be
 * imported as a 0-price product while its dishes landed in whatever category
 * came before it — 5 junk rows and a lost section on the captured
 * table-laid-out photograph. A caption carries no price of its own and is
 * immediately followed (blank lines aside) by a table row, which no printed
 * dish line ever is.
 */
function isTableCaption(lines: string[], i: number): boolean {
  const line = lines[i].trim();
  if (!line || TABLE_ROW_RE.test(line)) return false;
  if (NAME_PRICE_LINE_RE.test(line) || PRICE_ONLY_LINE_RE.test(line)) return false;
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j].trim();
    if (next) return TABLE_ROW_RE.test(next);
  }
  return false;
}

/**
 * Parse OCR markdown into parser categories (name + items). Not sanitized yet.
 *
 * Structure: `#`/`##` headings (and fully-bold lines, and a line captioning a
 * table) open categories, priced lines become items, markdown table rows are
 * split into cells. Lines before the first heading are kept and flushed into
 * the first category instead of being orphaned (OCR-12).
 */
export function parseOcrMarkdown(markdown: string, venue: string): ParserCategory[] {
  const categories: ParserCategory[] = [];
  /** Content read before the first heading, migrated into it once known. */
  const preamble: ImportedCategoryItems[] = [];
  let sink: ImportedCategoryItems[] = preamble;
  // A price printed on its own line, waiting for the item it belongs to.
  let pendingPrice = 0;
  let droppedPrices = 0;
  // A table row with no price is the table's heading row until a separator
  // proves it: "| Plat | Prix |" is not a dish (OCR-04).
  let lastWasHeaderRow = false;

  // Normalize Arabic-Indic digits / separators once, up front, so every line
  // below is matched with the same ASCII rules — `\d` is ASCII-only in JS, and
  // "عصير ١٢٫٥" used to import with the price still inside the name (OCR-03).
  const lines = normalizeOcrDigits(markdown).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const hashHeading = line.match(HEADING_RE);
    const boldHeading = hashHeading ? null : line.match(BOLD_HEADING_RE);
    const printedHeading = hashHeading ? hashHeading[2] : boldHeading ? boldHeading[1] : null;
    const rawHeading = printedHeading ?? (isTableCaption(lines, i) ? line : null);
    if (rawHeading !== null) {
      const name = normalizeHeading(rawHeading);
      if (!name || isJunkHeading(name, venue)) continue;
      categories.push({ name, items: [] });
      sink = categories[categories.length - 1].items;
      if (preamble.length > 0 && sink !== preamble) sink.push(...preamble.splice(0));
      lastWasHeaderRow = false;
      continue;
    }

    // The venue's own furniture — address line, phone number, card footer — is
    // not a menu row, and must not become the NEXT dish's price either: a bare
    // "71 245 890" line above "Espresso" was held as an orphan price and priced
    // Espresso at 9999 DT. Rejection is on the LINE (address/phone/footer
    // words), never on the number: a 9999 DT dish is legal.
    if (isVenueChromeLine(line)) continue;

    const row = tableRow(line);
    if (row) {
      if (row.separator) {
        // The row above a separator is the header ("Plat | Prix"), not a dish.
        if (lastWasHeaderRow && sink.length > 0) sink.pop();
        lastWasHeaderRow = false;
        continue;
      }
      const priceIdx = row.cells.findIndex((c) => PRICE_ONLY_LINE_RE.test(c));
      const textCells = row.cells.filter((_, cellIndex) => cellIndex !== priceIdx);
      const name = cleanItemName(textCells[0] ?? "");
      if (name && !isJunkHeading(name, venue)) {
        sink.push({
          name,
          // Middle cells are the printed description; never invented.
          description: normalizeName(textCells.slice(1).join(" ")),
          price: priceIdx >= 0 ? sanitizePrice(row.cells[priceIdx]) : 0,
        });
        lastWasHeaderRow = priceIdx < 0;
      }
      continue;
    }
    if (PRICE_ONLY_LINE_RE.test(line)) {
      // A lone price continues the previous item (OCR page break) — or is held
      // for the NEXT item, the "Menu du jour / 12.500" layout where the price
      // is printed above the dish (OCR-18).
      const prev = sink[sink.length - 1];
      if (prev && prev.price === 0) {
        prev.price = sanitizePrice(line);
      } else {
        if (pendingPrice > 0) droppedPrices++;
        pendingPrice = sanitizePrice(line);
      }
      continue;
    }

    const priced = line.match(NAME_PRICE_LINE_RE);
    const itemName = cleanItemName(priced ? priced[1] : line);
    if (!itemName) continue;

    // Skip obvious venue/contact noise while still pre-heading.
    if (!priced && categories.length === 0 && isJunkHeading(line, venue)) continue;

    let price = priced ? sanitizePrice(priced[2]) : 0;
    if (price === 0 && pendingPrice > 0) price = pendingPrice;
    pendingPrice = 0;
    sink.push({ name: itemName, description: "", price });
  }

  // Prices that never found an item are counted, never silently dropped.
  if (pendingPrice > 0) droppedPrices++;
  if (droppedPrices > 0) log("PARSER ORPHAN PRICES", { count: droppedPrices });

  if (categories.length === 0 && sink.length > 0) {
    categories.push({ name: "Menu", items: sink });
  }
  return categories;
}

// ── Top-level orchestration ────────────────────────────────────────
export interface ScanInputFile {
  /**
   * Raw bytes. Deliberately `Uint8Array`, not `Buffer`: the route hands over a
   * view of the ArrayBuffer it already read, so this stage adds no full copy of
   * every uploaded byte (OCR-07).
   */
  buffer: Uint8Array;
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

  // Everything below shares one deadline, so a hanging or repeatedly-failing
  // provider ends in a typed NETWORK error instead of the platform killing the
  // request at maxDuration with no result and no message (OCR-06).
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const fileIds: string[] = [];
  try {
    // 1. Upload each file.
    log("UPLOAD", { count: files.length });
    for (const f of files) {
      const t1 = Date.now();
      const id = await uploadDocument(f.buffer, sanitizeFilename(f.name), f.mime, deadline);
      log("UPLOAD", { name: f.name, mime: f.mime, bytes: f.buffer.length, ms: Date.now() - t1 });
      fileIds.push(id);
    }

    // 2. OCR each document (markdown + tables + whole-document annotation).
    log("OCR", { count: fileIds.length });
    const spec = annotationSpec(venue);
    const outcomes: OcrOutcome[] = [];
    for (const id of fileIds) {
      outcomes.push(await ocrDocument(id, spec, deadline));
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
      if (a === null || a === undefined) {
        log("STRUCTURE SKIP", { doc: i, reason: "no-annotation" });
        continue;
      }
      // Mistral's response reference documents `document_annotation` as
      // `dict|null`, while this code used to assume a JSON string. Accepting
      // BOTH shapes is what keeps the AI extraction from silently disappearing
      // behind a healthy-looking log line (OCR-15).
      let parsedAnnotation: unknown = a;
      if (typeof a === "string") {
        try {
          parsedAnnotation = JSON.parse(a);
        } catch (e) {
          log("STRUCTURE JSON PARSE FAIL", {
            doc: i,
            shape: "string",
            reason: String(e),
            bytes: a.length,
          });
          continue;
        }
      } else if (typeof a !== "object") {
        log("STRUCTURE BAD ANNOTATION", { doc: i, shape: typeof a });
        continue;
      }
      const cats = annotationCategories(parsedAnnotation);
      if (cats.kind === "categories") {
        rawAnnotationCategories.push(...cats.categories);
      } else if (cats.kind === "empty") {
        // A valid annotation that carries no dish. This is the degradation that
        // used to be invisible — `[]` is truthy, so the old code took the
        // success branch and pushed nothing, and "STRUCTURE NO CATEGORIES" was
        // unreachable. Keep it loud: it names the document, the attempt and the
        // page count so the next person sees WHY the scan fell back.
        log("STRUCTURE EMPTY ANNOTATION", {
          doc: i,
          fileId: outcomes[i].fileId.slice(0, 8),
          attempt: outcomes[i].attempt,
          pages: outcomes[i].pages,
        });
      } else {
        log("STRUCTURE NO CATEGORIES", { doc: i, shape: typeof a });
      }
    }
    const aiResult = buildMenuImport(
      { categories: rawAnnotationCategories },
      { files: files.length, pages, source: "ai", model: OCR_MODEL },
    );
    log("STRUCTURE", { strategy: "local-parser", reason: "always runs as baseline" });
    // A page always contributes its `<!-- page N -->` marker, so blank markdown
    // only happens for a document the provider returned WITHOUT pages but WITH
    // an annotation. Failing that scan outright discarded an extraction we had
    // already paid for, and the old blank-markdown guard was unreachable in
    // every other case; the empty guard below covers both (OCR-13).
    const fbResult = markdown.trim()
      ? buildMenuImport(
          { categories: parseOcrMarkdown(markdown, venue) },
          { files: files.length, pages, source: "fallback", model: "local-parser" },
        )
      : buildMenuImport(
          { categories: [] },
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
  } finally {
    // Release the provider-side documents whether the scan succeeded or failed:
    // uploaded menu photographs are otherwise retained forever (OCR-08). This
    // is best-effort and never changes the scan's outcome.
    await Promise.all(fileIds.map(deleteDocument));
  }
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return base || "menu-document";
}