const MAX_DIM = 800;
const JPEG_QUALITY = 0.82;

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