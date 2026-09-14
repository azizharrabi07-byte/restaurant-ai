import QRCode from "qrcode";

const QR_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  errorCorrectionLevel: "M",
  margin: 1,
  width: 480,
  color: { dark: "#050505", light: "#ffffff" },
};

export function toQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, QR_OPTIONS);
}

/** Fires one file download for an already-encoded data URL. */
function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Encodes and downloads one PNG. Rejects when the encode fails so the caller
 * can tell the user — previously the click silently did nothing.
 */
export async function downloadQrPng(value: string, filename: string): Promise<void> {
  triggerDownload(await toQrDataUrl(value), filename);
}

/**
 * Downloads every item in order. Each iteration awaits its own encode, so the
 * loop is paced by real work instead of a fixed sleep and never reports success
 * for a QR that was never produced. An encode failure rejects the returned
 * promise (after the earlier downloads have already fired).
 *
 * Note: the browser may still ask for permission to save multiple files; if the
 * user declines, further saves are dropped by the browser, not by this loop.
 */
export async function downloadAllQrPngs(
  items: { value: string; filename: string }[],
): Promise<void> {
  for (const item of items) {
    triggerDownload(await toQrDataUrl(item.value), item.filename);
  }
}