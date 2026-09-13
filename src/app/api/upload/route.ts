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
  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    return NextResponse.json({ cloud: false, error: "BAD_IMAGE", message: "Only JPEG, PNG or WebP images." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ cloud: false, error: "IMAGE_TOO_LARGE", message: "Image must be under 5 MB." }, { status: 413 });
  }

  if (!(await ensureBucket())) {
    return NextResponse.json({ cloud: false, error: "STORAGE_UNAVAILABLE" }, { status: 503 });
  }

  const path = `${restaurantId}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    return NextResponse.json({ cloud: false, error: "UPLOAD_FAILED" }, { status: 500 });
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ cloud: true, url: data.publicUrl, path });
}