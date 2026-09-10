const MAX_DIM = 2048;
const JPEG_QUALITY = 0.9;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const PASSTHROUGH_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Prepare a scanned menu image for upload.
 *
 * Images whose longest side already fits within MAX_DIM are returned UNCHANGED
 * (original bytes, original format). Re-encoding menu text to a tiny JPEG
 * destroys legibility: Mistral's OCR then returns full markdown but an EMPTY
 * annotation, so the whole extract collapses. Only genuinely large photos are
 * downscaled (still at high quality) to keep uploads within the file-size cap.
 */
export async function prepareUploadFile(file: File): Promise<Blob> {
  if (file.type === "application/pdf") return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const w = img.width;
    const h = img.height;
    const longest = Math.max(w, h);
    if (longest <= MAX_DIM && PASSTHROUGH_MIME.has(file.type)) {
      return file;
    }
    const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("image encoding failed"))),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}