import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOwnerSessionForRequest } from "@/lib/owner-auth";
import { getWorkerSession } from "@/lib/worker-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const BUCKET = "menu-images";
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Magic-byte check — the client-declared MIME type is not trustworthy. */
function sniffImageType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function ensureBucket(): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (data) return true;
  } catch {
    /* fall through to create */
  }
  try {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Owner/staff-only image upload. Stores the file in the public `menu-images`
 * bucket and returns its URL — the client persists the URL, never base64.
 */
export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ cloud: false, error: "NO_BACKEND" }, { status: 503 });
  }

  const owner = await getOwnerSessionForRequest(req);
  const worker = owner ? null : await getWorkerSession(req);
  if (!owner && !worker) {
    return NextResponse.json({ cloud: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const rate = checkRateLimit(req, "upload", { limit: 30, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { cloud: false, error: "RATE_LIMITED", message: `try again in ${rate.retryAfterSeconds}s` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const restaurantId = owner
    ? (
        await supabaseAdmin
          .from("restaurants")
          .select("id")
          .eq("owner_id", owner.user.userId)
          .order("created_at", { ascending: true })
          .limit(1)
      ).data?.[0]?.id
    : worker?.restaurantId;
  if (!restaurantId) {
    return NextResponse.json({ cloud: false, error: "NO_RESTAURANT" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ cloud: false, error: "BAD_BODY" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ cloud: false, error: "BAD_BODY", message: "file field required" }, { status: 400 });
  }
  const declaredExt = ALLOWED_MIME[file.type];
  if (!declaredExt) {
    return NextResponse.json({ cloud: false, error: "BAD_IMAGE", message: "Only JPEG, PNG or WebP images." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ cloud: false, error: "IMAGE_TOO_LARGE", message: "Image must be under 5 MB." }, { status: 413 });
  }

  // The declared type must also match the actual bytes: an image/gif renamed to
  // .png, or a script payload served as an image, is rejected here.
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== file.type) {
    return NextResponse.json({ cloud: false, error: "BAD_IMAGE", message: "Only JPEG, PNG or WebP images." }, { status: 415 });
  }

  if (!(await ensureBucket())) {
    return NextResponse.json({ cloud: false, error: "STORAGE_UNAVAILABLE" }, { status: 503 });
  }

  const path = `${restaurantId}/${randomUUID()}.${ALLOWED_MIME[sniffed]}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: sniffed,
    upsert: false,
  });
  if (error) {
    return NextResponse.json({ cloud: false, error: "UPLOAD_FAILED" }, { status: 500 });
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ cloud: true, url: data.publicUrl, path });
}