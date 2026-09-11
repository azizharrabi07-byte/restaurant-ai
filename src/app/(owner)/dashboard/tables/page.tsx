"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer, Download, Wand2, RefreshCw } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { downloadAllQrPngs } from "@/lib/qr";
import { appBaseUrl, slugify } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { TableCard } from "@/components/dashboard/table-card";
import { QrImage } from "@/components/qr-image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function TablesPage() {
  const {
    restaurantName,
    restaurantSlug,
    brandColor,
    tables,
    generateTables,
    regenerateAllTables,
  } = useOnboarding();
  const { t, plural } = useI18n();
  const [count, setCount] = useState(tables.length || 6);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Sync the number input with the actual number of tables once loaded
  // (so it doesn't stay at the default "6" after hydration).
  useEffect(() => {
    if (tables.length > 0) setCount(tables.length);
  }, [tables.length]);

  const displayName = restaurantName || "Velvet & Stone Coffee";
  // Use the persisted slug when available so QR URLs don't flicker between
  // hydration and initial state.
  const slug = restaurantSlug || slugify(displayName);
  const base = appBaseUrl();
  const urlFor = (token: string) => `${base}/menu/${slug}/${token}`;

  const handleGenerate = () => {
    const n = Math.max(1, Math.min(40, Number(count) || 6));
    // Preserve existing QR tokens (only add/remove tables).
    generateTables(n);
    toast.success(plural(n, "tb_generated_one", "tb_generated_other"), {
      description: t("tb_generatedDesc"),
    });
  };

  const handleRegenerateAll = () => {
    const n = Math.max(1, Math.min(40, Number(count) || 6));
    setIsRegenerating(true);
    try {
      regenerateAllTables(n);
      toast.success(t("tb_regeneratedToast"), {
        description: t("tb_regeneratedDesc"),
      });
    } finally {
      setTimeout(() => setIsRegenerating(false), 300);
    }
  };

  const handleDownloadAll = async () => {
    if (tables.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadAllQrPngs(
        tables.map((tb) => ({
          value: urlFor(tb.token),
          filename: `table-${tb.number}.png`,
        })),
      );
      toast.success(
        plural(tables.length, "tb_downloading_one", "tb_downloading_other"),
        {
          description: t("tb_downloadingDesc"),
        },
      );
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
        <div className="flex items-center gap-3 flex-1 flex-wrap">
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
          {tables.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRegenerateAll}
              disabled={isRegenerating}
              title={t("tb_regenerateHint")}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("tb_regenerate")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDownloadAll}
            disabled={tables.length === 0 || isDownloading}
          >
            <Download className="w-3.5 h-3.5" />
            {t("tb_downloadAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={tables.length === 0}
          >
            <Printer className="w-3.5 h-3.5" />
            {t("tb_print")}
          </Button>
        </div>
      </div>

      {/* Print-only sheet */}
      <div className="hidden print:grid print:grid-cols-3 print:gap-6">
        {tables.map((tb) => (
          <div
            key={tb.id}
            className="flex flex-col items-center border border-black/20 rounded-lg p-4"
          >
            <span className="text-[10px] font-mono uppercase tracking-widest mb-3">
              {t("tb_printHeader", {
                name: displayName,
                t: String(tb.number).padStart(2, "0"),
              })}
            </span>
            <QrImage value={urlFor(tb.token)} size={140} />
            <span className="text-[9px] font-mono text-black/50 mt-3 break-all text-center">
              {urlFor(tb.token)}
            </span>
          </div>
        ))}
      </div>

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
            />
          ))}
        </div>
      )}
    </>
  );
}
