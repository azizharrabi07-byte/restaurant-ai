"use client";

import { useEffect, useState } from "react";
import { toQrDataUrl } from "@/lib/qr";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface QrImageProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

export function QrImage({ value, size = 128, className, alt }: QrImageProps) {
  const { t } = useI18n();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setFailed(false);
    toQrDataUrl(value).then(
      (url) => {
        if (active) setDataUrl(url);
      },
      () => {
        // Without this the rejection is unhandled and the placeholder pulses
        // forever with no explanation.
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [value]);

  return (
    <div className={cn("inline-block", className)}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={alt ?? "QR code"}
          width={size}
          height={size}
          className="h-auto w-auto bg-white rounded-md"
          style={{ width: size, height: size }}
          aria-label={alt}
        />
      ) : failed ? (
        <div
          className="flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/5 px-2 text-center text-[9px] leading-tight text-red-400/90"
          style={{ width: size, height: size }}
          role="img"
          aria-label={t("tb_qrFailed")}
        >
          {t("tb_qrFailed")}
        </div>
      ) : (
        <div
          className="bg-white/5 animate-pulse rounded-md"
          style={{ width: size, height: size }}
        />
      )}
    </div>
  );
}
