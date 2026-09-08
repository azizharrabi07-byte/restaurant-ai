"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Printer, Download, Wand2 } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { downloadAllQrPngs } from "@/lib/qr";
import { appBaseUrl, slugify } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { TableCard } from "@/components/dashboard/table-card";
import { QrImage } from "@/components/qr-image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function TablesPage() {
  const { restaurantName, brandColor, tables, generateTables } = useOnboarding();
  const [count, setCount] = useState(tables.length || 6);
  const [isDownloading, setIsDownloading] = useState(false);

  const displayName = restaurantName || "Velvet & Stone Coffee";
  const slug = slugify(displayName);
  const base = appBaseUrl();
  const urlFor = (token: string) => `${base}/menu/${slug}/${token}`;

  const handleGenerate = () => {
    const n = Math.max(1, Math.min(40, Number(count) || 6));
    generateTables(n);
    toast.success(`${n} table${n === 1 ? "" : "s"} created`, {
      description: "Each table now has its own unique QR code.",
    });
  };

  const handleDownloadAll = async () => {
    if (tables.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadAllQrPngs(
        tables.map((t) => ({ value: urlFor(t.token), filename: `table-${t.number}.png` })),
      );
      toast.success(`Downloading ${tables.length} QR code${tables.length === 1 ? "" : "s"}`, {
        description: "Check your downloads folder.",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Owner · Tables & QR"
        title="Tables & QR codes"
        description="Generate a unique menu QR code for every table. Guests scan, browse, and order from their phone."
      />

      {/* Controls */}
      <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor="table-count"
              className="text-[10px] font-mono uppercase tracking-widest text-white/40"
            >
              Tables
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
            Generate Tables
          </Button>
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
            Download All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={tables.length === 0}
          >
            <Printer className="w-3.5 h-3.5" />
            Print QR Codes
          </Button>
        </div>
      </div>

      {/* Print-only sheet */}
      <div className="hidden print:grid print:grid-cols-3 print:gap-6">
        {tables.map((t) => (
          <div key={t.id} className="flex flex-col items-center border border-black/20 rounded-lg p-4">
            <span className="text-[10px] font-mono uppercase tracking-widest mb-3">
              {displayName} · Table {String(t.number).padStart(2, "0")}
            </span>
            <QrImage value={urlFor(t.token)} size={140} />
            <span className="text-[9px] font-mono text-black/50 mt-3 break-all text-center">
              {urlFor(t.token)}
            </span>
          </div>
        ))}
      </div>

      {/* Live grid */}
      {tables.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] py-24 text-center">
          <p className="text-sm text-white/60 font-medium">No tables yet</p>
          <p className="text-xs text-white/40 mt-1.5 max-w-sm mx-auto">
            Pick a number above and hit{" "}
            <span className="text-white/70 font-mono">Generate Tables</span> to create your
            printable QR codes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 print:hidden">
          {tables.map((t) => (
            <TableCard
              key={t.id}
              table={t}
              menuUrl={urlFor(t.token)}
              restaurantName={displayName}
              brandColor={brandColor.value}
            />
          ))}
        </div>
      )}
    </>
  );
}