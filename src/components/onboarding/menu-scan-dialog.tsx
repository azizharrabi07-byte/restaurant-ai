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
import { ImagePrepareError, prepareUploadFile } from "@/lib/image-utils";
import {
  normalizeKey,
  previewMenuImport,
  type ImportCollision,
  type MenuImportResult,
} from "@/lib/menu-import";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
const MAX_FILES = 6;

// Every code the route can answer with, plus the two client-side prepare
// failures. A missing entry used to fall back to the generic message even for
// "your session expired", which no amount of retrying can fix (I18N-11).
const ERROR_MSG_KEY: Record<string, string> = {
  NO_KEY: "ms_error_NO_KEY",
  PROVIDER_AUTH: "ms_error_PROVIDER_AUTH",
  OCR_FAILED: "ms_error_OCR_FAILED",
  UPLOAD_FAILED: "ms_error_OCR_FAILED",
  NETWORK: "ms_error_NETWORK",
  RATE_LIMITED: "ms_error_RATE_LIMITED",
  FILE_TOO_LARGE: "ms_error_FILE_TOO_LARGE",
  TOO_MANY_FILES: "ms_error_TOO_MANY_FILES",
  BAD_TYPE: "ms_error_BAD_TYPE",
  BAD_IMAGE: "ms_error_BAD_IMAGE",
  HEIC: "ms_error_HEIC",
  EMPTY: "ms_error_EMPTY",
  UNAUTHORIZED: "ms_error_UNAUTHORIZED",
  NO_BACKEND: "ms_error_NO_BACKEND",
  BAD_BODY: "ms_error_BAD_BODY",
};

type Phase = "pick" | "extract" | "review";

export function MenuScanButton({ label }: { label?: string }) {
  const { t } = useI18n();
  const { restaurantName, importMenuFromScan } = useOnboarding();

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  // The last failure to show in the pick step (a localized message key), and
  // the finished scan awaiting "Apply". Both are cleared when the dialog closes.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [result, setResult] = useState<MenuImportResult | null>(null);

  // The in-flight scan, so closing the dialog can stop it: the provider call is
  // paid for, and letting it run to completion after the owner walked away
  // commits spend they never saw the result of (OCR-06).
  const scanAbort = useRef<AbortController | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      scanAbort.current?.abort();
      scanAbort.current = null;
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
    const ac = new AbortController();
    scanAbort.current = ac;

    try {
      const form = new FormData();
      let renamed = 0;
      for (const f of files) {
        const blob = await prepareUploadFile(f);
        const passthrough = blob === f;
        // A unique name per re-encoded file: two photos prepared in the same
        // millisecond used to collide on `menu-<ts>.jpg`.
        if (!passthrough) renamed++;
        form.append(
          "files",
          blob,
          passthrough ? f.name : `menu-${Date.now()}-${renamed}.jpg`,
        );
      }
      form.append("venue", restaurantName);

      const res = await fetch("/api/menu/scan", {
        method: "POST",
        body: form,
        signal: ac.signal,
      });
      // A platform timeout/proxy error answers with HTML or an empty body, which
      // used to make `res.json()` throw and hide the real status (OCR-13/14).
      const data = (await res.json().catch(() => null)) as
        | { ok: true; result: MenuImportResult }
        | { ok: false; error: string }
        | null;

      if (!data) {
        setPhase("pick");
        setErrorKey(res.status === 504 || res.status === 502 ? "ms_error_NETWORK" : "ms_error_generic");
        return;
      }
      if (!data.ok) {
        setPhase("pick");
        setErrorKey(ERROR_MSG_KEY[data.error] ?? "ms_error_generic");
        return;
      }
      setResult(data.result);
      setPhase("review");
    } catch (err) {
      // The dialog was closed while the scan was running: nothing to report.
      if (ac.signal.aborted) return;
      // A prepare failure carries its own code, so HEIC and unreadable images
      // say what is actually wrong instead of "something went wrong" (LIB-11).
      setPhase("pick");
      setErrorKey(
        err instanceof ImagePrepareError
          ? (ERROR_MSG_KEY[err.code] ?? "ms_error_generic")
          : "ms_error_generic",
      );
    } finally {
      if (scanAbort.current === ac) scanAbort.current = null;
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

          {phase === "review" && result && <ScanReview result={result} />}

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
  const { t, formatPrice } = useI18n();
  const { categories: existingCategories, products: existingProducts } = useOnboarding();

  const { listed, keptBySlot } = useMemo(() => {
    // Every category and EVERY scanned row is listed: the review step used to
    // show at most 8 rows per category while Apply imported all of them, so the
    // owner approved names and prices they never saw (OCR-10).
    const byCat = new Map<string, MenuImportResult["products"]>();
    for (const p of result.products) {
      const bucket = byCat.get(p.categoryName) ?? [];
      bucket.push(p);
      byCat.set(p.categoryName, bucket);
    }
    // Rows this import would keep as the product already on the menu, computed
    // without touching state so the skip is VISIBLE before Apply — the merge
    // used to drop them silently and still close as if everything imported
    // (OCR-09).
    const report = previewMenuImport(
      { categories: existingCategories, products: existingProducts },
      result,
    );
    const clashes = new Map<string, ImportCollision>();
    for (const k of report.kept) {
      clashes.set(`${normalizeKey(k.categoryName)}\u0000${normalizeKey(k.name)}`, k);
    }
    return {
      listed: result.categories
        .map((c) => ({ name: c.name, items: byCat.get(c.name) ?? [] }))
        .filter((c) => c.items.length > 0),
      keptBySlot: clashes,
    };
  }, [result, existingCategories, existingProducts]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        {t("ms_reviewCount", { c: result.categories.length, i: result.products.length })}
      </p>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
        {listed.map((cat) => (
          <div key={cat.name} className="px-3 py-2">
            <p className="text-xs font-medium text-white">
              {cat.name}
              <span className="ms-2 text-[10px] font-normal text-white/40">
                {cat.items.length}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {cat.items.map((it) => {
                const clash = keptBySlot.get(
                  `${normalizeKey(it.categoryName)}\u0000${normalizeKey(it.name)}`,
                );
                return (
                  <li
                    key={`${it.categoryName}-${it.name}`}
                    className={`text-[11px] flex justify-between gap-2 rounded-sm ${
                      clash ? "-mx-1 bg-amber-500/5 px-1 text-amber-100/70" : "text-white/50"
                    }`}
                  >
                    <span className="truncate">{it.name}</span>
                    {clash ? (
                      // The scan read a DIFFERENT price for a dish already on the
                      // menu: show both, so "kept your version" is never silent.
                      <span className="shrink-0 tabular-nums">
                        <span className="text-amber-300">{formatPrice(clash.existingPrice)}</span>
                        {clash.scannedPrice !== clash.existingPrice && (
                          <span className="ms-1 text-white/30 line-through">
                            {formatPrice(clash.scannedPrice)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="shrink-0 tabular-nums">
                        {it.price > 0 ? formatPrice(it.price) : "—"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}