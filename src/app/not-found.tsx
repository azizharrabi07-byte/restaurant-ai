"use client";

import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { BrandMark, BrandWordmark } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Branded replacement for Next's default 404. The guest route calls
 * `notFound()` for an unknown slug or a table token that belongs to another
 * restaurant, so a guest scanning an old or reprinted QR code lands here.
 */
export default function NotFound() {
  const { t } = useI18n();

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
          <div className="w-12 h-12 mx-auto rounded-full border border-white/10 bg-white/5 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-[#D97706]" />
          </div>
          <p className="mt-5 text-[10px] font-mono uppercase tracking-widest text-white/40">
            {t("g_type")}
          </p>
          <h1 className="mt-1.5 text-2xl font-serif italic text-white leading-tight">
            {t("nf_title")}
          </h1>
          <p className="mt-3 text-sm text-white/40 leading-relaxed">{t("nf_desc")}</p>
          <p className="mt-4 rounded-xl border border-[#D97706]/25 bg-[#D97706]/10 px-4 py-3 text-xs text-[#f1b057] leading-relaxed">
            {t("nf_hint")}
          </p>
          <Link href="/" className="mt-6 block">
            <Button variant="outline" className="w-full">
              {t("inv_backHome")}
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
