"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Printer, Download, Wand2 } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { downloadAllQrPngs } from "@/lib/qr";
import { appBaseUrl, slugify } from "@/lib/utils";
import type { MenuGetResponse } from "@/lib/menu-mapping";
import { PageHeader } from "@/components/dashboard/page-header";
import { TableCard } from "@/components/dashboard/table-card";
import { QrImage } from "@/components/qr-image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function TablesPage() {
  const { restaurantName, brandColor, tables, generateTables, saveNow, isCloud, savingState } =
    useOnboarding();
  const { t, plural } = useI18n();
  const [count, setCount] = useState(tables.length || 6);
  const [isDownloading, setIsDownloading] = useState(false);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  // Set just before an explicit save; the effect below waits for the store's
  // saving state to settle and only then reports the real outcome.
  const pendingSave = useRef<{ waiting: boolean; n: number }>({ waiting: false, n: 0 });

  const displayName = restaurantName || t("ob_yourCafe");
  // The server slug is write-once: a rename no longer rewrites it, so the
  // printed URLs must use the stored slug rather than a slug re-derived from
  // the current name (which would 404 every already-printed QR code).
  const slug = savedSlug ?? slugify(displayName);
  const base = appBaseUrl();
  const urlFor = (token: string) => `${base}/menu/${slug}/${token}`;

  // A restaurant that was never created on the server, whose latest save was
  // rejected, or whose save came back "local" (unauthenticated/no cloud) has no
  // live menu — its QR codes would be dead links.
  const unsaved = !isCloud || savingState === "error" || savingState === "local";

  // The stored slug is the only slug the guest route resolves, so read it back
  // from the server: at mount, and again after every settled save (a first
  // save may have been stored under a collision-suffixed slug).
  const syncSlug = useCallback(async () => {
    try {
      const res = await fetch("/api/menu");
      if (!res.ok) return;
      const data = (await res.json()) as MenuGetResponse;
      if (data.restaurant?.slug) setSavedSlug(data.restaurant.slug);
    } catch {
      /* offline — the locally derived slug is the best we have */
    }
  }, []);

  useEffect(() => {
    void syncSlug();
  }, [isCloud, syncSlug]);

  useEffect(() => {
    if (savingState === "saved") void syncSlug();
  }, [savingState, syncSlug]);

  useEffect(() => {
    if (!pendingSave.current.waiting) return;
    if (savingState === "saving" || savingState === "idle") return;
    pendingSave.current.waiting = false;
    if (savingState === "saved") {
      toast.success(plural(pendingSave.current.n, "tb_generated_one", "tb_generated_other"), {
        description: t("tb_generatedDesc"),
      });
    } else {
      toast.error(t("tb_unsaved"));
    }
  }, [savingState, plural, t]);

  const handleGenerate = async () => {
    const n = Math.max(1, Math.min(40, Number(count) || 6));
    generateTables(n);
    if (!isCloud) {
      // No backend at all: the table list stays local, so the QR codes would
      // point at a restaurant the guest route cannot resolve.
      toast.error(t("tb_unsaved"));
      return;
    }
    // Save explicitly and report what actually happened, so a first save that
    // failed can still be retried from here.
    pendingSave.current = { waiting: true, n };
    await saveNow();
  };

  const handleDownloadAll = async () => {
    if (tables.length === 0 || unsaved) return;
    setIsDownloading(true);
    try {
      await downloadAllQrPngs(
        tables.map((tb) => ({ value: urlFor(tb.token), filename: `table-${tb.number}.png` })),
      );
      toast.success(plural(tables.length, "tb_downloading_one", "tb_downloading_other"), {
        description: t("tb_downloadingDesc"),
      });
    } catch {
      toast.error(t("tb_qrFailed"));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t("tb_eyebrow")}
        title={t("tb_title")}
        description={t("tb_desc")}
      />

      {/* Controls */}
      <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor="table-count"
              className="text-[10px] font-mono uppercase tracking-widest text-white/40"
            >
              {t("tb_tablesLabel")}
            </label>
            <Input
              id="table-count"
              type="number"
              min={1}
              max={40}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-24 !h-9 font-mono text-center"
            />
          </div>
          <Button type="button" className="font-bold" onClick={handleGenerate}>
            <Wand2 className="w-3.5 h-3.5 text-black" />
            {t("tb_generate")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDownloadAll}
            disabled={tables.length === 0 || isDownloading || unsaved}
          >
            <Download className="w-3.5 h-3.5" />
            {t("tb_downloadAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={tables.length === 0 || unsaved}
          >
            <Printer className="w-3.5 h-3.5" />
            {t("tb_print")}
          </Button>
        </div>
      </div>

      {unsaved && (
        <p className="text-xs text-amber-400/90 font-mono -mt-4 mb-6">
          {t("tb_unsaved")}
        </p>
      )}

      {/* Print-only sheet — omitted entirely while unsaved so a stray Ctrl+P
          cannot produce a sheet of dead QR codes. */}
      {!unsaved && (
        <div className="hidden print:grid print:grid-cols-3 print:gap-6">
          {tables.map((tb) => (
            <div key={tb.id} className="flex flex-col items-center border border-black/20 rounded-lg p-4">
              <span className="text-[10px] font-mono uppercase tracking-widest mb-3">
                {t("tb_printHeader", { name: displayName, t: String(tb.number).padStart(2, "0") })}
              </span>
              <QrImage value={urlFor(tb.token)} size={140} />
              <span className="text-[9px] font-mono text-black/50 mt-3 break-all text-center">
                {urlFor(tb.token)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Live grid */}
      {tables.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] py-24 text-center">
          <p className="text-sm text-white/60 font-medium">{t("tb_noTables")}</p>
          <p className="text-xs text-white/40 mt-1.5 max-w-sm mx-auto">
            {t("tb_noTablesDesc")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 print:hidden">
          {tables.map((tb) => (
            <TableCard
              key={tb.id}
              table={tb}
              menuUrl={urlFor(tb.token)}
              restaurantName={displayName}
              brandColor={brandColor.value}
              disabled={unsaved}
            />
          ))}
        </div>
      )}
    </>
  );
}
