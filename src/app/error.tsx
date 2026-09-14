"use client";

import { useEffect } from "react";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { BrandMark, BrandWordmark } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Route-level error boundary. Renders inside the root layout (so the i18n
 * provider and the design tokens are available) and replaces Next's bare
 * "Application error" screen with a branded retry.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error("[sufra] route error", error);
  }, [error]);

  return (
    <div className="min-h-dvh bg-[#050505] text-white flex flex-col">
      <header className="h-16 border-b border-white/10 flex items-center px-4 sm:px-8 bg-[#080808]">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-white text-black flex items-center justify-center rounded-sm shrink-0 overflow-hidden transition-transform group-hover:rotate-45">
            <BrandMark className="scale-90" />
          </div>
          <BrandWordmark />
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full border border-red-500/20 bg-red-500/10 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-red-400" />
          </div>
          <p className="mt-5 text-[10px] font-mono uppercase tracking-widest text-white/40">
            {t("g_type")}
          </p>
          <h1 className="mt-1.5 text-2xl font-serif italic text-white leading-tight">
            {t("err_title")}
          </h1>
          <p className="mt-3 text-sm text-white/40 leading-relaxed">{t("err_desc")}</p>
          {error.digest && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-white/25">
              {error.digest}
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <Button type="button" className="w-full" onClick={() => reset()}>
              {t("err_retry")}
            </Button>
            <Link href="/" className="block">
              <Button type="button" variant="outline" className="w-full">
                {t("inv_backHome")}
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
