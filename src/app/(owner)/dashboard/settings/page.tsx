"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Store, Palette, FolderTree, Utensils, PenLine, RefreshCw, Eraser, Info } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { slugify } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const {
    restaurantName,
    logo,
    cover,
    brandColor,
    categories,
    products,
    tables,
    workers,
    loadDemo,
    resetAll,
  } = useOnboarding();

  const displayName = restaurantName || "Velvet & Stone Coffee";

  return (
    <>
      <PageHeader
        eyebrow="Owner · Settings"
        title="Restaurant settings"
        description="Your branding, menu, and data — everything the operations side of the house knows about you."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Branding */}
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-3.5 h-3.5 text-white/50" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">Branding</h3>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <RestaurantLogo
              logo={logo}
              name={displayName}
              brandColor={brandColor.value}
              size={56}
            />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-serif italic text-white leading-tight">{displayName}</p>
              <p className="text-[11px] font-mono text-white/40 mt-0.5">
                {slugify(displayName)}.menuos.app
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Palette className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">Accent</p>
              <p className="text-xs text-white font-mono mt-0.5">{brandColor.value}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <FolderTree className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">Sections</p>
              <p className="text-xs text-white font-mono mt-0.5">{categories.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Utensils className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">Products</p>
              <p className="text-xs text-white font-mono mt-0.5">{products.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Store className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">Ops</p>
              <p className="text-xs text-white font-mono mt-0.5">
                {tables.length} tables · {workers.length} staff
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/menu">
              <Button type="button" variant="secondary" size="sm">
                <PenLine className="w-3.5 h-3.5" />
                Edit Menu & Branding
              </Button>
            </Link>
          </div>
        </div>

        {/* Data + demo info */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />
              <div className="text-xs text-white/40 leading-relaxed">
                <p className="font-medium text-white/80 mb-1">Cloud sync</p>
                <p>
                  Your menu autosaves to Supabase the moment you start editing — scan a table
                  QR on any phone to see it live. Orders placed by guests arrive here in
                  real time.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 space-y-2">
            <p className="text-xs font-mono uppercase tracking-widest text-white/60 mb-3">Data</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                loadDemo();
                toast.success("Sample café data loaded", {
                  description: "Menu and operations reset to the demo café.",
                });
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Load Sample Data
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                resetAll();
                toast.info("State reset");
              }}
            >
              <Eraser className="w-3.5 h-3.5" />
              Reset Everything
            </Button>
          </div>
        </div>
      </div>

      {/* Cover preview */}
      {cover && (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">
            Menu hero cover
          </p>
          <div
            className="h-36 rounded-xl bg-cover bg-center opacity-80"
            style={{ backgroundImage: `url(${cover})` }}
          />
        </div>
      )}
    </>
  );
}