"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { prepareUploadFile } from "@/lib/image-utils";
import type { MenuImportResult } from "@/lib/menu-import";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
const MAX_FILES = 6;

const ERROR_MSG_KEY: Record<string, string> = {
  NO_KEY: "ms_error_NO_KEY",
  OCR_FAILED: "ms_error_OCR_FAILED",
  UPLOAD_FAILED: "ms_error_OCR_FAILED",
  NETWORK: "ms_error_NETWORK",
  RATE_LIMITED: "ms_error_RATE_LIMITED",
  FILE_TOO_LARGE: "ms_error_FILE_TOO_LARGE",
  TOO_MANY_FILES: "ms_error_TOO_MANY_FILES",
  BAD_TYPE: "ms_error_BAD_TYPE",
  EMPTY: "ms_error_EMPTY",
};

type Phase = "pick" | "extract" | "review";

export function MenuScanButton({ label }: { label?: string }) {
  const { t } = useI18n();
  const { restaurantName, importMenuFromScan } = useOnboarding();

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setPhase("pick");
      setErrorKey(null);
      setResult(null);
    }
  }, [open]);

  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(
    () => () => previews.forEach((p) => p && URL.revokeObjectURL(p)),
    [previews],
  );

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pick = Array.from(list)
      .slice(0, MAX_FILES)
      .filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (pick.length === 0) {
      setErrorKey("ms_error_BAD_TYPE");
      return;
    }
    setErrorKey(null);
    setFiles((prev) => {
      const seen = new Set<string>();
      const merged = [...prev, ...pick].filter((f) => {
        const k = `${f.name}-${f.size}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return merged.slice(0, MAX_FILES);
    });
  };

  const runScan = async () => {
    if (files.length === 0) return;
    setPhase("extract");
    setErrorKey(null);

    try {
      const form = new FormData();
      for (const f of files) {
        const blob = await prepareUploadFile(f);
        const passthrough = blob === f;
        form.append("files", blob, passthrough ? f.name : `menu-${Date.now()}.jpg`);
      }
      form.append("venue", restaurantName);

      const res = await fetch("/api/menu/scan", { method: "POST", body: form });
      const data = (await res.json()) as
        | { ok: true; result: MenuImportResult }
        | { ok: false; error: string };

      if (!data.ok) {
        setPhase("pick");
        setErrorKey(ERROR_MSG_KEY[data.error] ?? "ms_error_generic");
        return;
      }
      setResult(data.result);
      setPhase("review");
    } catch {
      setPhase("pick");
      setErrorKey("ms_error_generic");
    }
  };

  const applyResult = () => {
    if (result) importMenuFromScan(result);
    setOpen(false);
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
        <Camera className="w-4 h-4" />
        {label ?? t("ms_extract")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ms_title")}</DialogTitle>
            <DialogDescription>{t("ms_desc")}</DialogDescription>
          </DialogHeader>

          {phase === "pick" && (
            <div className="space-y-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                className="border border-dashed border-white/20 hover:border-white/40 rounded-xl p-6 text-center cursor-pointer transition-colors"
              >
                <ImagePlus className="w-6 h-6 text-white/40 mx-auto mb-2" />
                <p className="text-sm text-white/80">{t("ms_pick")}</p>
                <p className="text-[11px] text-white/40 mt-1">{t("ms_hint")}</p>
              </div>

              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="relative w-16 h-16 rounded-lg overflow-hidden bg-[#131313] border border-white/10"
                    >
                      {previews[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previews[i]}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ScanLine className="w-4 h-4 text-white/40" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-black/70 rounded-full text-white/80 hover:text-white cursor-pointer"
                        title={t("ms_remove")}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {errorKey && <p className="text-xs text-red-400">{t(errorKey)}</p>}
            </div>
          )}

          {phase === "extract" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-7 h-7 text-amber-500 animate-spin" />
              <p className="text-sm text-white/70">{t("ms_reading")}</p>
            </div>
          )}

          {phase === "review" && result && (
            <ScanReview result={result} />
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("ms_close")}
            </Button>
            {phase === "review" ? (
              <Button type="button" onClick={applyResult}>
                {t("ms_apply")}
              </Button>
            ) : (
              <Button type="button" onClick={runScan} disabled={files.length === 0}>
                {t("ms_extract")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScanReview({ result }: { result: MenuImportResult }) {
  const { t } = useI18n();
  const items = useMemo(() => {
    const byCat = new Map<string, MenuImportResult["products"]>();
    for (const p of result.products) {
      const key = p.categoryName;
      const bucket = byCat.get(key) ?? [];
      if (bucket.length < 8) bucket.push(p);
      byCat.set(key, bucket);
    }
    return result.categories
      .map((c) => ({ name: c.name, items: byCat.get(c.name) ?? [] }))
      .filter((c) => c.items.length > 0);
  }, [result]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        {t("ms_reviewCount", { c: result.categories.length, i: result.products.length })}
      </p>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
        {items.map((cat) => (
          <div key={cat.name} className="px-3 py-2">
            <p className="text-xs font-medium text-white">{cat.name}</p>
            <ul className="mt-1 space-y-0.5">
              {cat.items.map((it) => (
                <li
                  key={it.name}
                  className="text-[11px] text-white/50 flex justify-between gap-2"
                >
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {it.price > 0 ? `${it.price.toFixed(3)} DT` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}