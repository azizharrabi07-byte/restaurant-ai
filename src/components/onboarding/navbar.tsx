"use client";

import { RefreshCw, Smartphone, CloudUpload } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark, BrandWordmark } from "@/components/brand-logo";
import { useI18n } from "@/lib/i18n";

interface NavbarProps {
  restaurantName: string;
  currentStep: number;
  showLivePreview: boolean;
  onTogglePreview: () => void;
  onResetDemo: () => void;
  onGoToFinalStep: () => void;
}

export function Navbar({
  restaurantName,
  currentStep,
  showLivePreview,
  onTogglePreview,
  onResetDemo,
  onGoToFinalStep,
}: NavbarProps) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 w-full h-16 border-b border-white/10 flex items-center justify-between px-4 sm:px-8 bg-[#080808]">
      {/* Left: Brand Identity */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3 group cursor-pointer">
          <div className="w-8 h-8 bg-white text-black flex items-center justify-center rounded-sm shrink-0 transition-transform group-hover:rotate-45 overflow-hidden">
            <BrandMark className="scale-90" />
          </div>
          <BrandWordmark />
          <span className="text-xs uppercase tracking-widest text-white/40 ml-4 border-l border-white/20 pl-4 hidden sm:inline-block">
            {t("ob_partner")}
          </span>
        </Link>
      </div>

      {/* Right: Establishment & Actions */}
      <div className="flex items-center gap-3 sm:gap-5">
        <div className="text-right hidden md:block">
          <p className="text-xs text-white/40 uppercase tracking-tighter">{t("ob_restaurant")}</p>
          <p className="text-sm font-medium text-white truncate max-w-[140px] lg:max-w-[200px]">
            {restaurantName || t("ob_yourCafe")}
          </p>
        </div>

        <div className="h-6 w-px bg-white/10 hidden sm:block"></div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResetDemo}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white px-2.5 py-1.5 rounded-full hover:bg-white/5 transition-colors cursor-pointer"
            title={t("ob_resetTitle")}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="text-[11px] uppercase tracking-wider">{t("ob_demoData")}</span>
          </button>

          <Button
            type="button"
            variant={showLivePreview ? "secondary" : "outline"}
            size="sm"
            onClick={onTogglePreview}
            className="hidden lg:inline-flex"
          >
            <Smartphone className="w-3.5 h-3.5" />
            {showLivePreview ? t("ob_hidePreview") : t("ob_sidePreview")}
          </Button>

          {currentStep !== 5 && (
            <Button type="button" size="sm" onClick={onGoToFinalStep} className="font-bold text-xs">
              <CloudUpload className="w-3.5 h-3.5 text-black" />
              {t("ob_publish")}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}