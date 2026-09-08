"use client";

import { Cloud, CloudOff, Loader2, Check, TriangleAlert } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";

export function SaveStatus() {
  const { savingState, isCloud } = useOnboarding();

  if (!isCloud) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
        <CloudOff className="w-3 h-3" />
        Saved locally
      </span>
    );
  }

  switch (savingState) {
    case "saving":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/50 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
          <Loader2 className="w-3 h-3 animate-spin" />
          Saving…
        </span>
      );
    case "saved":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 border border-emerald-500/20 rounded-full px-3 py-1.5 bg-emerald-500/5">
          <Check className="w-3 h-3" />
          All changes saved
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-red-400 border border-red-500/20 rounded-full px-3 py-1.5 bg-red-500/5">
          <TriangleAlert className="w-3 h-3" />
          Sync failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/50 border border-white/10 rounded-full px-3 py-1.5 bg-[#0D0D0D]">
          <Cloud className="w-3 h-3 text-emerald-400" />
          Cloud sync on
        </span>
      );
  }
}