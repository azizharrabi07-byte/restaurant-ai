"use client";

import { Cloud, CloudOff, Loader2, Check, TriangleAlert } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";

export function SaveStatus() {
  const { savingState, isCloud } = useOnboarding();
  const { t } = useI18n();

  if (!isCloud) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
        <CloudOff className="w-3 h-3" />
        {t("save_local")}
      </span>
    );
  }

  switch (savingState) {
    case "saving":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/50 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("save_saving")}
        </span>
      );
    case "saved":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 border border-emerald-500/20 rounded-full px-3 py-1.5 bg-emerald-500/5">
          <Check className="w-3 h-3" />
          {t("save_saved")}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-red-400 border border-red-500/20 rounded-full px-3 py-1.5 bg-red-500/5">
          <TriangleAlert className="w-3 h-3" />
          {t("save_failed")}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/50 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
          <Cloud className="w-3 h-3 text-emerald-400" />
          {t("save_sync")}
        </span>
      );
  }
}