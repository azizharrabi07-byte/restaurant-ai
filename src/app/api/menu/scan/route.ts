import { NextRequest, NextResponse } from "next/server";
import {
  MenuScanError,
  MAX_FILES,
  MAX_FILE_BYTES,
  type MenuImportResult,
  runMenuScan,
} from "@/lib/menu-scan";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ScanResponse {
  ok: boolean;
  result?: MenuImportResult;
  error?: string;
  detail?: string;
}

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
  const venue = (form.get("venue") as string | null) ?? "";

  if (rawFiles.length === 0 || rawFiles.length > MAX_FILES) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_FILES" } satisfies ScanResponse,
      { status: 400 },
    );
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

  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    return NextResponse.json(
      { ok: false, error: "FILE_TOO_LARGE", detail: tooBig.name } satisfies ScanResponse,
      { status: 413 },
    );
  }

  try {
    const result = await runMenuScan(files, venue);
    return NextResponse.json({ ok: true, result } satisfies ScanResponse);
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