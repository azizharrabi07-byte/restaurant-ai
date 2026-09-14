"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Palette,
  FolderTree,
  Utensils,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  CloudUpload,
  Info,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneMockup } from "@/components/phone-mockup";
import { useOnboarding } from "@/lib/onboarding-store";
import { appBaseUrl, slugify } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

interface StepPreviewProps {
  onBack: () => void;
  onJumpToStep: (step: number) => void;
}

export function StepPreview({ onBack, onJumpToStep }: StepPreviewProps) {
  const {
    restaurantName,
    logo,
    brandColor,
    categories,
    products,
    cover,
    theme,
    saveNow,
    savingState,
    lastSaveError,
    isCloud,
    hydrationFailed,
    restaurantSlug,
    tables,
  } = useOnboarding();
  const { t } = useI18n();
  const [finished, setFinished] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // The badge states a fact about the server, so it may only claim it once the
  // server has confirmed the menu: a local save is not "live" (FE-11).
  const isLive = isCloud && savingState === "saved";

  // The one URL a guest can actually open: this app's own origin plus the
  // real guest route, with a token that exists. There is no `menuos.app`
  // domain anywhere in this product (FE-10).
  const menuSlug = restaurantSlug ?? slugify(restaurantName || "");
  const liveToken = tables[0]?.token ?? null;
  const scanUrl = isCloud && liveToken ? `${appBaseUrl()}/menu/${menuSlug}/${liveToken}` : null;

  const statusTone = hydrationFailed
    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
    : savingState === "error"
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : isLive
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-white/5 text-white/70 border-white/10";
  const statusLabel = hydrationFailed
    ? t("save_hydrationFailed")
    : savingState === "error"
      ? t("save_failed")
      : isLive
        ? t("prv_ready")
        : t("prv_notLive");
  // The wizard has no SaveStatus pill of its own, so the banner carries both
  // the state and the server's reason for refusing.
  const statusReason = hydrationFailed
    ? t("save_hydrationFailed")
    : savingState === "error"
      ? lastSaveError?.message || t("save_errorNetwork")
      : null;

  const handleFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    // The wizard's last step claims the menu is published: ask the server
    // first, and only report success on its answer (FE-11).
    const failure = await saveNow();
    setFinishing(false);
    if (failure) {
      setFinished(false);
      toast.error(t("save_failed"), {
        description: failure.message,
        duration: 6000,
      });
      return;
    }
    setFinished(true);
    toast.success(t("prv_doneToast"), {
      description: t("prv_doneToastDesc"),
      duration: 5000,
    });
  };

  const handleCopy = async () => {
    if (!scanUrl) return;
    try {
      await navigator.clipboard.writeText(scanUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error(t("prv_copyFailed"));
    }
  };

  const checklist = [
    {
      step: 1,
      icon: Building2,
      primary: restaurantName || t("prv_unnamed"),
      secondary: t("prv_identity"),
    },
    {
      step: 2,
      icon: Palette,
      primary: (
        <span className="flex items-center gap-2">
          <span
            className="w-3.5 h-3.5 rounded-full border border-white/20"
            style={{ backgroundColor: brandColor.value }}
          />
          <span>{t("br_primaryTitle")}</span>
        </span>
      ),
      secondary: t("prv_branding"),
    },
    {
      step: 3,
      icon: FolderTree,
      primary: t("prv_categories", { n: categories.length }),
      secondary: categories.map((c) => c.name).slice(0, 2).join(", "),
    },
    {
      step: 4,
      icon: Utensils,
      primary: t("prv_menuItems", { n: products.length }),
      secondary: t("prv_menuItemsSub"),
    },
  ];

  return (
    <div className="max-w-6xl mx-auto text-start animate-in fade-in slide-in-from-bottom-2 duration-300 pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 font-medium">
              {t("prv_eyebrow")}
            </p>
            <h2 className="text-3xl sm:text-4xl font-serif italic text-white mb-2">
              {t("prv_title")}
            </h2>
            <p className="text-white/40 max-w-xl text-sm sm:text-base leading-relaxed">
              {t("prv_desc")}
            </p>
          </div>

          <span className="text-[10px] uppercase font-mono tracking-wider px-2.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 border self-start sm:self-center bg-white/5 text-white/70 border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
            {t("prv_draftReady")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Setup Overview */}
        <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
          {/* Live Status Banner */}
          <div className="p-5 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-widest text-white/40">
                {t("prv_menuStatus")}
              </span>
              <span
                className={`text-[10px] uppercase font-mono tracking-wider px-2.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 border ${statusTone}`}
                title={statusReason ?? undefined}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isLive ? "bg-emerald-400 animate-pulse" : "bg-current"
                  }`}
                />
                {statusLabel}
              </span>
            </div>

            <div>
              <p className="text-xs text-white/40">{t("prv_scanLink")}</p>
              <div className="mt-1.5 flex items-center justify-between p-2.5 rounded-lg bg-[#111111] border border-white/10 text-xs font-mono">
                <span className="text-white/90 truncate pr-2">
                  {scanUrl ?? t("prv_scanPending")}
                </span>
                {scanUrl && (
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="text-white/40 hover:text-white p-1 hover:bg-white/5 rounded-full transition-colors cursor-pointer shrink-0"
                    title={t("prv_copyUrl")}
                  >
                    {copiedUrl ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Onboarding Checklist */}
          <div className="p-5 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-4">
            <h3 className="text-xs uppercase tracking-widest font-mono text-white/60">
              {t("prv_heading")}
            </h3>

            <div className="divide-y divide-white/5 text-xs">
              {checklist.map((item) => (
                <div key={item.step} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-[#111111] border border-white/10 flex items-center justify-center text-white/60 shrink-0">
                      <item.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-white block truncate">{item.primary}</span>
                      <span className="text-[11px] text-white/40 block truncate">{item.secondary}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJumpToStep(item.step)}
                    className="text-white/40 hover:text-white text-xs font-mono uppercase tracking-wider cursor-pointer shrink-0"
                  >
                    {t("prv_edit")}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Guide */}
          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs space-y-2">
            <p className="font-medium text-white">{t("prv_simTitle")}</p>
            <ul className="text-white/40 space-y-1.5 list-disc list-inside">
              <li>{t("prv_guide1")}</li>
              <li>{t("prv_guide2")}</li>
              <li>{t("prv_guide3")}</li>
            </ul>
          </div>

          {/* Actions / Finish */}
          <div className="pt-2 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
              {t("prv_back")}
            </Button>

            {finished ? (
              <Link href="/dashboard">
                <Button type="button" className="font-bold text-xs">
                  {t("prv_dashboard")}
                  <ArrowRight className="w-3.5 h-3.5 text-black" />
                </Button>
              </Link>
            ) : (
              <Button
                type="button"
                onClick={() => void handleFinish()}
                disabled={finishing}
                className="font-bold text-xs"
              >
                {finishing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5 text-black" />
                )}
                {t("prv_finish")}
              </Button>
            )}
          </div>

          {statusReason && !finished && (
            <p className="text-xs text-amber-300/90 leading-relaxed" role="status">
              {statusReason}
            </p>
          )}

          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-4">
            <Info className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />
            <div className="text-xs text-white/40 leading-relaxed">
              <p className="font-medium text-white/80 mb-1">{t("prv_nextTitle")}</p>
              <p>
                {t("prv_nextDesc")}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Phone Preview */}
        <div className="lg:col-span-7 flex justify-center order-1 lg:order-2">
          <PhoneMockup
            restaurantName={restaurantName}
            logo={logo}
            brandColor={brandColor.value}
            categories={categories}
            products={products}
            cover={cover}
            theme={theme}
          />
        </div>
      </div>
    </div>
  );
}