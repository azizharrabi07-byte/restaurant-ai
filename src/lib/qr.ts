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

export function downloadQrPng(value: string, filename: string) {
  toQrDataUrl(value).then((dataUrl) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

export async function downloadAllQrPngs(
  items: { value: string; filename: string }[],
) {
  for (const item of items) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    downloadQrPng(item.value, item.filename);
  }
}