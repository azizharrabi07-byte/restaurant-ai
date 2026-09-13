import { NextRequest, NextResponse } from "next/server";
import {
  MenuScanError,
  MAX_FILES,
  MAX_FILE_BYTES,
  type MenuImportResult,
  runMenuScan,
} from "@/lib/menu-scan";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attachOwnerSessionRotation,
  getOwnerSessionForRequest,
} from "@/lib/owner-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ScanResponse {
  ok: boolean;
  result?: MenuImportResult;
  error?: string;
  detail?: string;
}

// Max tolerated multipart body: MAX_FILES files + generous part/field overhead.
// Applied against Content-Length (fail-fast) AND per-file size before reading.
const MAX_BODY_BYTES = MAX_FILES * MAX_FILE_BYTES + 4 * 1024 * 1024;
const MAX_VENUE_CHARS = 200;

const STATUS: Record<string, number> = {
  NO_KEY: 503,
  TOO_MANY_FILES: 400,
  FILE_TOO_LARGE: 413,
  BAD_TYPE: 422,
  UPLOAD_FAILED: 502,
  OCR_FAILED: 502,
  NETWORK: 502,
  RATE_LIMITED: 429,
  INVALID_MODEL_RESPONSE: 422,
  INVALID_JSON: 422,
  EMPTY: 422,
};

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "NO_BACKEND" } satisfies ScanResponse,
      { status: 503 },
    );
  }

  // 1. Owner session required (owners scan their own menus).
  const session = await getOwnerSessionForRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" } satisfies ScanResponse,
      { status: 401 },
    );
  }

  // 2. Per-IP rate limit (Mistral uploads/OCRs cost money and time).
  const rate = checkRateLimit(req, "scan", { limit: 10, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED", detail: `try again in ${rate.retryAfterSeconds}s` } satisfies ScanResponse,
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  // 3. Fail fast when the OCR key is absent, BEFORE reading any body.
  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "NO_KEY", detail: "OCR service is not configured" } satisfies ScanResponse,
      { status: 503 },
    );
  }

  // 4. Fail fast on an obviously oversized upload (Content-Length).
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "FILE_TOO_LARGE" } satisfies ScanResponse,
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD_BODY" } satisfies ScanResponse,
      { status: 400 },
    );
  }

  const rawFiles = form.getAll("files").filter((v): v is File => v instanceof File);
  const venueRaw = (form.get("venue") as string | null) ?? "";
  const venue = venueRaw.slice(0, MAX_VENUE_CHARS);

  if (rawFiles.length === 0 || rawFiles.length > MAX_FILES) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_FILES" } satisfies ScanResponse,
      { status: 400 },
    );
  }

  // 5. Enforce the per-file cap BEFORE buffering any file into memory.
  for (const f of rawFiles) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "FILE_TOO_LARGE", detail: f.name } satisfies ScanResponse,
        { status: 413 },
      );
    }
  }

  const files: { name: string; mime: string; size: number; buffer: Buffer }[] = [];
  for (const f of rawFiles) {
    files.push({
      name: f.name,
      mime: f.type || "application/octet-stream",
      size: f.size,
      buffer: Buffer.from(await f.arrayBuffer()),
    });
  }

  try {
    const result = await runMenuScan(files, venue);
    return attachOwnerSessionRotation(
      NextResponse.json({ ok: true, result } satisfies ScanResponse),
      session,
    );
  } catch (err) {
    if (err instanceof MenuScanError) {
      return NextResponse.json(
        { ok: false, error: err.code, detail: err.message } satisfies ScanResponse,
        { status: STATUS[err.code] ?? 500 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "UNKNOWN", detail: String(err) } satisfies ScanResponse,
      { status: 500 },
    );
  }
}