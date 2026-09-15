"server-only";

/**
 * NVIDIA NIM structurer: OCR markdown → `MenuImportResult`.
 *
 * WHY this stage exists: Mistral's OCR annotation (an LLM) comes back
 * `{"categories": []}` on roughly half of real photos, and the deterministic
 * regex parser behind it cannot tell a dish from a wrapped description line —
 * on a real café card the two together produced 68 products of which 36 were
 * junk. A language model reading the whole card does not have that failure: the
 * measured run of this pass answered in 15 s with 20 items, all 20 priced, the
 * dietary legend / address / footer dropped and section headers kept.
 *
 * WHY it is not trusted alone: the same model, same prompt, `temperature: 0`,
 * run twice, captured an Arabic-script section once and omitted it the next
 * time. This pass therefore provides the SHAPE and every row it produces is
 * gated by `./menu-validate` (`validateMenuImport`), with the deterministic
 * parser kept as a completeness net (`mergeStructuredMenu`).
 *
 * Model entitlement matters: the account can reach 5 of the 81 models NVIDIA
 * lists; the rest answer 404 `Not found for account`. The others that DO work
 * were measured at 41-91 s and returned reasoning prose instead of JSON, so the
 * default below is the one that was measured fastest and correct.
 *
 * No SDK, no dependency: the API is OpenAI-compatible and `fetch` is enough.
 * Every request carries a hard `AbortSignal.timeout`, because a provider call
 * with no deadline is how a scan turns into a killed request with no result.
 */

import { buildMenuImport, type MenuImportResult } from "./menu-import";
// The prompt contract and the reply parser are PURE and live in `./menu-validate`
// on purpose: this module is `"server-only"`, so a unit test may not import it,
// while the two pieces that decide whether the model was understood must be
// testable without a network and without a key.
import { MENU_STRUCTURE_RULES, parseLlmJsonObject } from "./menu-validate";

export const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Wall-clock budget for one structuring call. The measured runs: the default
 * model 15 s, the other four entitled models 41-91 s. 60 s covers the fast one
 * with room for a slow network, and the scan's own `SCAN_BUDGET_MS` (110 s)
 * remains the outer bound — `structureMenuWithLlm` is given the scan deadline
 * and aborts at whichever limit comes first.
 */
const LLM_TIMEOUT_MS = 60_000;

/** A 20-item card replies in ~1.2k tokens; 4k bounds the reply without crowding it. */
const MAX_TOKENS = 4096;
/** ~30k characters is a large six-photo menu at ~4 characters per token. */
const MAX_INPUT_CHARS = 30_000;
const MAX_DETAIL_CHARS = 200;

/** Configured base URL, without a trailing slash. Read per call: env, not module scope. */
function baseUrl(): string {
  return (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Can this pass run at all? True only when `NVIDIA_API_KEY` is set, so every
 * caller has one clean branch for "no structurer configured" and the app keeps
 * working with only Mistral configured.
 */
export function hasLlmBackend(): boolean {
  return (process.env.NVIDIA_API_KEY ?? "").trim().length > 0;
}

/** The model this pass uses; `NVIDIA_MODEL` overrides the measured default. */
export function llmModel(): string {
  return (process.env.NVIDIA_MODEL ?? "").trim() || DEFAULT_NVIDIA_MODEL;
}

export type LlmMenuFailure =
  /** No `NVIDIA_API_KEY`: the pass is not configured. */
  | "NO_KEY"
  /** Nothing to structure (blank OCR text). */
  | "NO_INPUT"
  /** The scan's own budget was already spent; no request was sent. */
  | "BUDGET"
  /** The request outlived its timeout. */
  | "TIMEOUT"
  /** The provider answered a non-2xx status. */
  | "HTTP"
  /** The connection failed before a response arrived. */
  | "NETWORK"
  /** A response that is not a chat completion carrying a JSON object. */
  | "BAD_JSON"
  /** Valid JSON, but with no usable item in it. */
  | "EMPTY_RESULT";

/**
 * A typed outcome, never an exception: an LLM outage must not fail a scan. The
 * caller logs `reason`/`status`/`detail` and continues with the annotation +
 * parser path it already had.
 */
export type LlmMenuOutcome =
  | { ok: true; result: MenuImportResult; model: string; ms: number }
  | {
      ok: false;
      reason: LlmMenuFailure;
      model: string;
      ms: number;
      status?: number;
      detail?: string;
      /** Chat-completions requests actually sent: 0 when none was worth sending. */
      attempts: number;
    };

/**
 * One attempt, before the caller's retry loop attaches `attempts`. The failure
 * member is derived from the public one so a field added to the outcome cannot
 * drift out of the per-attempt shape.
 */
type LlmMenuAttempt =
  | { ok: true; result: MenuImportResult; model: string; ms: number }
  | Omit<Extract<LlmMenuOutcome, { ok: false }>, "attempts">;

/** A short, key-free excerpt of an error body for the log. */
async function errorSnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS);
  } catch {
    return "";
  }
}

/** `choices[0].message.content`, or null when the payload is not that shape. */
function completionContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) return null;
  const { choices } = payload;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const { message } = first;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const { content } = message;
  return typeof content === "string" && content.trim() ? content : null;
}

/**
 * The rule block plus the card's text. The venue is context for reading the
 * card; the rules forbid it from becoming an item or a category.
 */
function buildPrompt(venue: string, text: string): string {
  const trimmed = venue.trim();
  return [
    MENU_STRUCTURE_RULES,
    "",
    `VENUE (printed on the card, for context only — never an item): ${trimmed || "(unknown)"}`,
    "",
    "OCR TEXT:",
    "<<<MENU",
    text,
    "MENU>>>",
  ].join("\n");
}

/**
 * Structure the OCR text with the NVIDIA NIM chat-completions endpoint.
 *
 * `deadline` is the scan's absolute wall-clock deadline (epoch ms); `timeoutMs`
 * overrides the per-call budget. The two collapse into the single timer that
 * fires first, so this stage can never outlive the scan — including across the
 * retry below, whose second attempt is clipped to whatever the deadline still
 * allows and skipped outright when nothing is left.
 *
 * A reply that arrives and cannot be parsed gets exactly ONE more sample. The
 * measured failure — `BAD_JSON` at position 3132 of a reply under the 4096-token
 * ceiling, so malformed rather than truncated — is a stochastic event, and the
 * second draw usually parses. The reasons that mean no reply ever arrived to
 * parse (`HTTP`, `NETWORK`, `TIMEOUT`, `NO_KEY`, `EMPTY_RESULT`) are returned on
 * the first try: re-sending cannot change any of them, and re-rolling a valid
 * empty answer would only spend the scan's budget.
 *
 * The result's `stats.files`/`stats.pages` are 0 and its `stats.source` is
 * `"llm"`: this stage cannot know the scan's totals, and `mergeStructuredMenu`
 * stamps the real counts on the merged result.
 */
export async function structureMenuWithLlm(
  markdown: string,
  venue: string,
  opts: { deadline?: number; timeoutMs?: number } = {},
): Promise<LlmMenuOutcome> {
  const model = llmModel();
  const key = (process.env.NVIDIA_API_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "NO_KEY", model, ms: 0, attempts: 0 };

  const text = typeof markdown === "string" ? markdown.trim() : "";
  if (!text) return { ok: false, reason: "NO_INPUT", model, ms: 0, attempts: 0 };

  const t0 = Date.now();
  const perAttemptMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  /** Milliseconds left of the scan's budget, read when called; infinite when none was set. */
  const budgetLeft = (): number =>
    opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - Date.now();

  const firstLeft = budgetLeft();
  if (firstLeft <= 0) {
    return {
      ok: false,
      reason: "BUDGET",
      model,
      ms: 0,
      attempts: 0,
      detail: "the scan budget was spent before the structurer ran",
    };
  }

  // Each attempt's timer is its own call budget clipped by the shared deadline.
  const first = await structureMenuOnce(
    text,
    venue,
    model,
    key,
    Math.max(1, Math.min(perAttemptMs, firstLeft)),
    t0,
  );
  if (first.ok || first.reason !== "BAD_JSON") return withAttempts(first, 1);

  // Only an unreadable reply reaches this point. Take the second sample when
  // the scan can still afford one; otherwise report the first failure rather
  // than start a request the deadline would cut off.
  const retryLeft = budgetLeft();
  if (retryLeft <= 0) return withAttempts(first, 1);

  const second = await structureMenuOnce(
    text,
    venue,
    model,
    key,
    Math.max(1, Math.min(perAttemptMs, retryLeft)),
    t0,
  );
  return withAttempts(second, 2);
}

/** Attach the attempt count the outcome reports, over the ok/failure union. */
function withAttempts(attempt: LlmMenuAttempt, attempts: number): LlmMenuOutcome {
  return attempt.ok ? attempt : { ...attempt, attempts };
}

/**
 * ONE chat-completions round: send the prompt, read the reply, classify it.
 * `t0` is the entry time of the whole call, so every `ms` is the elapsed time
 * the caller has spent — across attempts, not this attempt's own span — which
 * is what the scan's log line wants.
 */
async function structureMenuOnce(
  text: string,
  venue: string,
  model: string,
  key: string,
  timeoutMs: number,
  t0: number,
): Promise<LlmMenuAttempt> {
  let input = text;
  if (input.length > MAX_INPUT_CHARS) {
    const cut = input.lastIndexOf("\n", MAX_INPUT_CHARS);
    input = input.slice(0, cut > 0 ? cut : MAX_INPUT_CHARS);
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        // The key is used here and NEVER logged (see the failure branches).
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildPrompt(venue, input) }],
        temperature: 0,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const ms = Date.now() - t0;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: false, reason: "TIMEOUT", model, ms, detail: `aborted after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      reason: "NETWORK",
      model,
      ms,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: "HTTP",
      status: res.status,
      model,
      ms: Date.now() - t0,
      detail: await errorSnippet(res),
    };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: "BAD_JSON",
      model,
      ms: Date.now() - t0,
      detail: `response body is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const content = completionContent(payload);
  if (content === null) {
    return {
      ok: false,
      reason: "BAD_JSON",
      model,
      ms: Date.now() - t0,
      detail: "the completion carries no message content",
    };
  }

  const parsed = parseLlmJsonObject(content);
  if (!parsed.ok) {
    // A malformed object breaks near its END — the measured one at position 3132
    // of an under-limit reply — so the log carries the reply's tail, collapsed
    // and capped like an error body. Menu text only: never a header, never the key.
    const flat = content.replace(/\s+/g, " ").trim();
    const tail = flat.length <= MAX_DETAIL_CHARS ? flat : `…${flat.slice(-MAX_DETAIL_CHARS)}`;
    return {
      ok: false,
      reason: "BAD_JSON",
      model,
      ms: Date.now() - t0,
      detail: `${parsed.reason} | reply tail: ${tail}`,
    };
  }

  const result = buildMenuImport(parsed.value, { files: 0, pages: 0, source: "llm", model });
  if (result.products.length === 0) {
    return {
      ok: false,
      reason: "EMPTY_RESULT",
      model,
      ms: Date.now() - t0,
      detail: "the JSON object carries no usable item",
    };
  }

  // No secrets in the log line the caller writes from this: model, elapsed ms
  // and item counts only.
  return { ok: true, result, model, ms: Date.now() - t0 };
}
