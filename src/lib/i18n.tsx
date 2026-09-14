"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  LANG_COOKIE,
  LANG_DIR,
  LANG_KEY,
  CUR_COOKIE,
  CUR_KEY,
  RATES,
  isAppCurrency,
  isAppLang,
  languageFromTag,
  lookup,
  type AppCurrency,
  type AppLang,
} from "./locale";

/*
 * The locale data and every helper that the SERVER also needs lives in
 * `src/lib/locale.ts`, which is free of `"use client"`. This module is the
 * React half: the context, the provider and the `useI18n` hook. The block at
 * the bottom re-exports the locale surface so existing imports of
 * `@/lib/i18n` (components, and older call sites) keep resolving.
 */

interface I18nContextValue {
  lang: AppLang;
  setLang: (l: AppLang) => void;
  cur: AppCurrency;
  setCur: (c: AppCurrency) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  plural: (n: number, oneKey: string, otherKey: string) => string;
  formatPrice: (amount: number) => string;
  isAr: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** A year, so a stored preference never expires mid-service. */
const PREF_MAX_AGE = 60 * 60 * 24 * 365;

function fromDeviceLanguages(tags: readonly string[]): AppLang {
  for (const tag of tags) {
    const hit = languageFromTag(tag);
    if (hit) return hit;
  }
  return "en";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      const raw = entry.slice(prefix.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function readStored(name: string): string | null {
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writePrefCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${name}=${value}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookies blocked */
  }
}

function persistPref(name: string, value: string) {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    /* private mode */
  }
  writePrefCookie(name, value);
}

interface I18nProviderProps {
  children: ReactNode;
  /**
   * Locale the root layout resolved from the cookie. Supplying it keeps the
   * server render and the first client render in agreement — no hydration
   * mismatch, and no flash of the wrong language.
   */
  initialLang?: AppLang;
  /** Currency the root layout resolved from the cookie. */
  initialCur?: AppCurrency;
}

const warnedKeys = new Set<string>();

/** In development a missing key must be loud — it renders as the raw key. */
function warnMissingKey(key: string, lang: AppLang) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  const en = lookup("en", key);
  console.warn(
    `[i18n] "${key}" is not translated in ${lang.toUpperCase()}` +
      (en === undefined
        ? " — the key exists in no locale. Add it to en, fr and ar in src/lib/locale.ts."
        : ` — rendering the raw key instead. EN reads: "${en}"`),
  );
}

export function I18nProvider({
  children,
  initialLang,
  initialCur,
}: I18nProviderProps) {
  const [lang, setLangState] = useState<AppLang>(() => {
    if (typeof window === "undefined") return initialLang ?? "en";
    const fromCookie = readCookie(LANG_COOKIE);
    if (isAppLang(fromCookie)) return fromCookie;
    const stored = readStored(LANG_KEY);
    if (isAppLang(stored)) {
      // Upgrade a preference written by an older build (localStorage only)
      // so the next server render already knows it.
      writePrefCookie(LANG_COOKIE, stored);
      return stored;
    }
    // First visit: `navigator.languages` is the device's own preference. The
    // server resolved the same signal from `Accept-Language`, so the two
    // agree in practice; `initialLang` only breaks a tie (an unknown or
    // stripped device list), which keeps the hydrated markup identical.
    const detected = fromDeviceLanguages([
      ...window.navigator.languages,
      window.navigator.language,
    ]);
    const chosen = detected === "en" ? (initialLang ?? "en") : detected;
    if (chosen !== "en") writePrefCookie(LANG_COOKIE, chosen);
    return chosen;
  });
  const [cur, setCurState] = useState<AppCurrency>(() => {
    if (typeof window === "undefined") return initialCur ?? "tnd";
    const fromCookie = readCookie(CUR_COOKIE);
    if (isAppCurrency(fromCookie)) return fromCookie;
    const stored = readStored(CUR_KEY);
    return isAppCurrency(stored) ? stored : "tnd";
  });

  useEffect(() => {
    persistPref(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = LANG_DIR[lang];
  }, [lang]);

  useEffect(() => {
    persistPref(CUR_KEY, cur);
  }, [cur]);

  const t = (key: string, vars?: Record<string, string | number>) => {
    const val = lookup(lang, key);
    if (val === undefined) {
      if (process.env.NODE_ENV !== "production") warnMissingKey(key, lang);
      return key;
    }
    let out = val;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.split(`{${k}}`).join(String(v));
      }
    } else {
      out = out.split("{year}").join(String(new Date().getFullYear()));
    }
    return out;
  };

  const plural = (n: number, oneKey: string, otherKey: string) =>
    t(n === 1 ? oneKey : otherKey, { n });

  const formatPrice = (amount: number) => {
    const v = amount * RATES[cur];
    if (cur === "tnd") return `${v.toFixed(3)} DT`;
    return `${cur === "eur" ? "€" : "$"}${v.toFixed(2)}`;
  };

  return (
    <I18nContext.Provider
      value={{
        lang,
        setLang: setLangState,
        cur,
        setCur: setCurState,
        t,
        plural,
        formatPrice,
        isAr: lang === "ar",
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export {
  APP_CURRENCIES,
  APP_LANGS,
  CUR_COOKIE,
  LANG_COOKIE,
  LANG_DIR,
  isAppCurrency,
  isAppLang,
  languageFromTag,
  lookup,
  translate,
} from "./locale";
export type { AppCurrency, AppLang } from "./locale";
