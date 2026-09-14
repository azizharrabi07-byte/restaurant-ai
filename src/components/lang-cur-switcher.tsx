"use client";

import { cn } from "@/lib/utils";
import { APP_LANGS, APP_CURRENCIES, useI18n } from "@/lib/i18n";

interface LangCurSwitcherProps {
  className?: string;
  /**
   * The guest menu is priced in dinars only (README: "all prices are shown in
   * dinars on the guest menu") and the kitchen receives the unconverted TND
   * amount, so the guest path renders language-only. Every other surface keeps
   * the currency row.
   */
  showCurrency?: boolean;
}

export function LangCurSwitcher({
  className,
  showCurrency = true,
}: LangCurSwitcherProps) {
  const { lang, setLang, cur, setCur, t } = useI18n();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1",
        className,
      )}
    >
      <div role="group" aria-label={t("lang_group")} className="flex items-center gap-1">
        {APP_LANGS.map((l) => (
          <button
            key={l.key}
            type="button"
            lang={l.key}
            onClick={() => setLang(l.key)}
            aria-label={l.label}
            aria-pressed={lang === l.key}
            className={cn(
              "px-2 py-1 rounded-full text-[10px] font-semibold transition-all cursor-pointer",
              lang === l.key ? "bg-white text-black" : "text-white/50 hover:text-white",
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      {showCurrency && (
        <>
          <span className="h-4 w-px bg-white/10" aria-hidden="true" />
          <div role="group" aria-label={t("cur_group")} className="flex items-center gap-1">
            {APP_CURRENCIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCur(c.key)}
                aria-label={c.label}
                aria-pressed={cur === c.key}
                className={cn(
                  "px-2 py-1 rounded-full text-[10px] font-mono font-semibold transition-all cursor-pointer",
                  cur === c.key ? "bg-white text-black" : "text-white/50 hover:text-white",
                )}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
