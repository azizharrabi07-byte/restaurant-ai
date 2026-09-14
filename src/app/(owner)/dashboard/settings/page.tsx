"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  Store,
  Palette,
  FolderTree,
  Utensils,
  PenLine,
  RefreshCw,
  Eraser,
  Info,
  Link2,
  Lock,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { slugify } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    restaurantSlug,
    setRestaurantSlug,
    saveNow,
    hydrationState,
    loadDemo,
    resetAll,
  } = useOnboarding();
  const { t } = useI18n();
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState(false);

  const displayName = restaurantName || t("ob_yourCafe");

  // The server keeps a stored slug authoritative on update, so the field is
  // editable only while no restaurant row exists — that is exactly the case
  // where the first save can still fail with 409 SLUG_TAKEN, and therefore the
  // only case where changing the address can rescue it (FE-02).
  const slugEditable = hydrationState === "local";
  const currentSlug = restaurantSlug ?? slugify(displayName);
  const slugValue = slugDraft ?? currentSlug;

  const commitSlug = async () => {
    const typed = slugValue.trim();
    if (typed.length > 63) return;
    setSavingSlug(true);
    // Blank hands the choice back to the server, which derives a free slug
    // from the name (and disambiguates it if that one is taken).
    setRestaurantSlug(typed);
    const failure = await saveNow();
    setSavingSlug(false);
    if (!failure) {
      setSlugDraft(null);
      toast.success(t("st_slugSaved"));
      return;
    }
    toast.error(t("st_slugRefused"), { description: failure.message });
  };

  return (
    <>
      <PageHeader
        eyebrow={t("st_eyebrow")}
        title={t("st_title")}
        description={t("st_desc")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Branding */}
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-3.5 h-3.5 text-white/50" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">{t("st_branding")}</h3>
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
                /menu/{currentSlug}/&lt;table&gt;
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Palette className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">{t("st_accent")}</p>
              <p className="text-xs text-white font-mono mt-0.5">{brandColor.value}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <FolderTree className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">{t("st_sections")}</p>
              <p className="text-xs text-white font-mono mt-0.5">{categories.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Utensils className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">{t("st_products")}</p>
              <p className="text-xs text-white font-mono mt-0.5">{products.length}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
              <Store className="w-3.5 h-3.5 text-white/50 mb-1.5" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">{t("st_ops")}</p>
              <p className="text-xs text-white font-mono mt-0.5">
                {t("st_opsValue", { tables: tables.length, workers: workers.length })}
              </p>
            </div>
          </div>

          {/* Menu address — the slug the guest links and printed QR codes use */}
          <div className="mt-5 rounded-lg border border-white/10 bg-[#111111] p-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-white/50" />
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                {t("st_slug")}
              </p>
            </div>

            {slugEditable ? (
              <>
                <div className="mt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Input
                    value={slugValue}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={t("st_slug")}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={savingSlug || slugify(slugValue) === currentSlug}
                    onClick={() => void commitSlug()}
                    className="shrink-0"
                  >
                    {savingSlug ? t("save_saving") : t("st_slugSave")}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
                  {t("st_slugDesc")}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-mono text-white/90 break-all">
                  <Lock className="w-3 h-3 shrink-0 text-white/40" />
                  {currentSlug}
                </p>
                <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
                  {hydrationState === "failed" ? t("st_slugBlocked") : t("st_slugLocked")}
                </p>
              </>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/menu">
              <Button type="button" variant="secondary" size="sm">
                <PenLine className="w-3.5 h-3.5" />
                {t("st_editAll")}
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
                <p className="font-medium text-white/80 mb-1">{t("st_cloudSync")}</p>
                <p>{t("st_cloudSyncDesc")}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 space-y-2">
            <p className="text-xs font-mono uppercase tracking-widest text-white/60 mb-3">{t("st_data")}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                loadDemo();
                toast.success(t("st_loadSampleToast"), {
                  description: t("st_loadSampleToastDesc"),
                });
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("st_loadSample")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                resetAll();
                toast.info(t("st_resetToast"));
              }}
            >
              <Eraser className="w-3.5 h-3.5" />
              {t("st_reset")}
            </Button>
          </div>
        </div>
      </div>

      {/* Cover preview */}
      {cover && (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">
            {t("st_cover")}
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