"use client";

import Link from "next/link";
import {
  Cloud,
  CloudOff,
  Loader2,
  Check,
  TriangleAlert,
  RotateCw,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";

const PILL =
  "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider border rounded-full px-3 py-1.5";

export function SaveStatus() {
  const { savingState, lastSaveError, isCloud, hydrationFailed, saveNow } =
    useOnboarding();
  const { t } = useI18n();

  // A rejection is always visible, whatever `isCloud` says: the first save is
  // exactly the one that can fail (409 SLUG_TAKEN, 500 INSERT_RESTAURANT) and
  // at that moment no restaurant row exists yet, so cloud mode is still off
  // (FE-02).
  if (savingState === "error") {
    const reason =
      lastSaveError?.code === "SLUG_TAKEN"
        ? t("save_errorSlugTaken")
        : lastSaveError?.code === "NETWORK"
          ? t("save_errorNetwork")
          : lastSaveError?.message || t("save_errorNetwork");

    return (
      <div className="flex min-w-0 items-center justify-end gap-2">
        <span
          className={`${PILL} text-red-400 border-red-500/20 bg-red-500/5`}
          title={reason}
        >
          <TriangleAlert className="w-3 h-3" />
          {t("save_failed")}
          {lastSaveError?.code ? <span>{lastSaveError.code}</span> : null}
        </span>
        <span
          className="hidden max-w-[240px] truncate text-[10px] text-red-300/80 md:block"
          title={reason}
        >
          {reason}
        </span>
        <button
          type="button"
          onClick={() => void saveNow()}
          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white/70 hover:text-white border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/5 transition-colors cursor-pointer"
        >
          <RotateCw className="w-3 h-3" />
          {t("save_retry")}
        </button>
      </div>
    );
  }

  // The menu could not be read from the server, so nothing here may be
  // autosaved over it (FE-13c) — say so instead of showing a healthy state.
  if (hydrationFailed) {
    return (
      <span
        className={`${PILL} text-amber-300 border-amber-500/20 bg-amber-500/5`}
        title={t("save_hydrationFailed")}
      >
        <TriangleAlert className="w-3 h-3" />
        {t("save_hydrationFailed")}
      </span>
    );
  }

  if (!isCloud) {
    if (savingState === "local") {
      // The server refused for lack of a session: signing in is the fix.
      return (
        <Link
          href="/auth/login?next=/dashboard"
          className={`${PILL} text-amber-300 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors`}
        >
          <CloudOff className="w-3 h-3" />
          {t("save_signIn")}
        </Link>
      );
    }
    return (
      <span className={`${PILL} text-white/40 border-white/10 bg-[#0D0D0D]`}>
        <CloudOff className="w-3 h-3" />
        {t("save_local")}
      </span>
    );
  }

  switch (savingState) {
    case "saving":
      return (
        <span className={`${PILL} text-white/50 border-white/10 bg-[#0D0D0D]`}>
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("save_saving")}
        </span>
      );
    case "saved":
      return (
        <span
          className={`${PILL} text-emerald-400 border-emerald-500/20 bg-emerald-500/5`}
        >
          <Check className="w-3 h-3" />
          {t("save_saved")}
        </span>
      );
    case "empty":
      return (
        <span className={`${PILL} text-white/50 border-white/10 bg-[#0D0D0D]`}>
          <Cloud className="w-3 h-3 text-white/40" />
          {t("save_nothingToSave")}
        </span>
      );
    default:
      return (
        <span className={`${PILL} text-white/50 border-white/10 bg-[#0D0D0D]`}>
          <Cloud className="w-3 h-3 text-emerald-400" />
          {t("save_sync")}
        </span>
      );
  }
}
