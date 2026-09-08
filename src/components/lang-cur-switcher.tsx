"use client";

import { cn } from "@/lib/utils";
import { APP_LANGS, APP_CURRENCIES, useI18n } from "@/lib/i18n";

export function LangCurSwitcher({ className }: { className?: string }) {
  const { lang, setLang, cur, setCur } = useI18n();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1",
        className,
      )}
    >
      {APP_LANGS.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => setLang(l.key)}
          className={cn(
            "px-2 py-1 rounded-full text-[10px] font-mono font-semibold transition-all cursor-pointer",
            lang === l.key ? "bg-white text-black" : "text-white/50 hover:text-white",
          )}
        >
          {l.label}
        </button>
      ))}
      <span className="h-4 w-px bg-white/10" />
      {APP_CURRENCIES.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => setCur(c.key)}
          className={cn(
            "px-2 py-1 rounded-full text-[10px] font-mono font-semibold transition-all cursor-pointer",
            cur === c.key ? "bg-white text-black" : "text-white/50 hover:text-white",
          )}
        >
          {c.symbol}
        </button>
      ))}
    </div>
  );
}