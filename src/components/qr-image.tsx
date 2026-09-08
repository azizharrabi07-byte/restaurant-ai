"use client";

import { useEffect, useState } from "react";
import { toQrDataUrl } from "@/lib/qr";
import { cn } from "@/lib/utils";

interface QrImageProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

export function QrImage({ value, size = 128, className, alt }: QrImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    toQrDataUrl(value).then((url) => {
      if (active) setDataUrl(url);
    });
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
      ) : (
        <div
          className="bg-white/5 animate-pulse rounded-md"
          style={{ width: size, height: size }}
        />
      )}
    </div>
  );
}