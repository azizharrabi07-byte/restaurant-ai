const MAX_DIM = 2048;
const JPEG_QUALITY = 0.9;
/** The route's per-file cap — preparing must never produce something it rejects. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Formats the scan pipeline passes through untouched: the provider reads JPEG,
 * PNG and WebP, so re-encoding them would only destroy legibility.
 */
const PASSTHROUGH_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * HEIC/HEIF. The picker advertises them (iPhone library photos) but no browser
 * except Safari can decode them into an `<img>`, and the provider does not
 * accept them either — so they get their own actionable error instead of the
 * generic "something went wrong" the decode failure used to produce (LIB-11).
 */
const HEIC_MIME = /^image\/hei[cf]$/i;

/** Client-side prepare failures, mapped to localized copy by the scan dialog. */
export type ImagePrepareErrorCode = "HEIC" | "BAD_IMAGE" | "FILE_TOO_LARGE";

export class ImagePrepareError extends Error {
  code: ImagePrepareErrorCode;
  /**
   * @param code which localized message the dialog should show
   * @param message developer-facing detail (never shown to the owner)
   */
  constructor(code: ImagePrepareErrorCode, message: string) {
    super(message);
    this.name = "ImagePrepareError";
    this.code = code;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const img = new Image();
  img.onload = () => resolve(img);
  // `img.onerror` hands over an Event, which carries no message and makes every
  // caller's catch generic; a real Error with a cause-shaped name is what the
  // caller can branch on (LIB-11).
  img.onerror = () => reject(new Error("image decode failed"));
  img.src = src;
  return promise;
}

/** A 2-D context, or a domain error instead of a `TypeError` from `!`. */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePrepareError("BAD_IMAGE", "this browser cannot process images");
  return ctx;
}

export async function downscaleImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    let w = img.width;
    let h = img.height;
    if (w > h) {
      if (w > MAX_DIM) {
        h = Math.round((h * MAX_DIM) / w);
        w = MAX_DIM;
      }
    } else {
      if (h > MAX_DIM) {
        w = Math.round((w * MAX_DIM) / h);
        h = MAX_DIM;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    context2d(canvas).drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Prepare a scanned menu image for upload.
 *
 * Images whose longest side already fits within MAX_DIM AND whose bytes already
 * fit the upload cap are returned UNCHANGED (original bytes, original format).
 * Re-encoding menu text to a tiny JPEG destroys legibility: Mistral's OCR then
 * returns full markdown but an EMPTY annotation, so the whole extract collapses.
 * Only genuinely large photos are downscaled (still at high quality) to keep
 * uploads within the file-size cap — a pixel test alone used to let a
 * 2048×2048 8 MB PNG through byte-for-byte (LIB-11).
 *
 * @throws ImagePrepareError with a code the dialog localizes (`HEIC`,
 * `BAD_IMAGE`, `FILE_TOO_LARGE`).
 */
export async function prepareUploadFile(file: File): Promise<Blob> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ImagePrepareError(
        "FILE_TOO_LARGE",
        `${file.name} is ${file.size} bytes (max ${MAX_UPLOAD_BYTES})`,
      );
    }
    return file;
  }

  const isHeic = HEIC_MIME.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  const objectUrl = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(objectUrl);
    } catch {
      // The bytes are not a decodable image in THIS browser. A HEIC photo has a
      // specific, actionable cause (only Safari decodes it) and its own message;
      // everything else — a text file renamed ".jpg", a truncated download, an
      // unsupported format — is a plain bad image. Before this branch both ended
      // as the generic "something went wrong" (LIB-11 / OCR-11).
      throw isHeic
        ? new ImagePrepareError("HEIC", `${file.name} (${file.type || "HEIC"}) needs Safari`)
        : new ImagePrepareError("BAD_IMAGE", `${file.name} could not be decoded`);
    }
    const w = img.width;
    const h = img.height;
    const longest = Math.max(w, h);
    // Both halves of the cap matter: the pixel test alone let an 8 MB 2048px PNG
    // through byte-for-byte and defeated the route's per-file limit (LIB-11).
    if (longest <= MAX_DIM && PASSTHROUGH_MIME.has(file.type) && file.size <= MAX_UPLOAD_BYTES) {
      return file;
    }
    const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    context2d(canvas).drawImage(img, 0, 0, canvas.width, canvas.height);
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    const blob = await promise;
    if (!blob) throw new ImagePrepareError("BAD_IMAGE", `${file.name} could not be re-encoded`);
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new ImagePrepareError(
        "FILE_TOO_LARGE",
        `${file.name} is still ${blob.size} bytes after downscaling`,
      );
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
