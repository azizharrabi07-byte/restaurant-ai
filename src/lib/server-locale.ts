import { cookies, headers } from "next/headers";
import {
  CUR_COOKIE,
  LANG_COOKIE,
  isAppCurrency,
  isAppLang,
  languageFromTag,
  type AppCurrency,
  type AppLang,
} from "./locale";

/**
 * Request-scoped locale resolution for SERVER code.
 *
 * The locale has to be known before the first byte of HTML, so it lives in a
 * cookie (`sufra.lang` / `sufra.cur`, written by `I18nProvider`) rather than in
 * `localStorage`. On a first visit there is no cookie yet: `Accept-Language`
 * carries the same preference as `navigator.languages`, which is what lets an
 * `ar-TN` phone get `lang="ar" dir="rtl"` in the server HTML instead of the
 * English LTR shell it would otherwise hydrate out of.
 *
 * This is the ONE resolver for that question. `src/app/layout.tsx` (for
 * `<html lang dir>`) and every page's `generateMetadata` (for the title) must
 * both go through it, otherwise the document language and the page title can
 * disagree for the same visitor.
 *
 * Server-only by construction: it imports `next/headers`. Never import it from
 * a `"use client"` module.
 */

const FALLBACK: { lang: AppLang; cur: AppCurrency } = { lang: "en", cur: "tnd" };

/** `Accept-Language: "ar-TN,ar;q=0.9,fr;q=0.8"` → the first tag we ship. */
function fromAcceptLanguage(header: string | null): AppLang | null {
  for (const entry of (header ?? "").split(",")) {
    const [tag] = entry.split(";");
    const hit = languageFromTag(tag);
    if (hit) return hit;
  }
  return null;
}

/** Stored cookie first, then the browser's own preference, then English. */
export async function localeForRequest(): Promise<{ lang: AppLang; cur: AppCurrency }> {
  const jar = await cookies();
  const storedLang = jar.get(LANG_COOKIE)?.value;
  const storedCur = jar.get(CUR_COOKIE)?.value;
  const fromCookie = isAppLang(storedLang) ? storedLang : null;
  const lang =
    fromCookie ?? fromAcceptLanguage((await headers()).get("accept-language")) ?? FALLBACK.lang;
  const cur = isAppCurrency(storedCur) ? storedCur : FALLBACK.cur;
  return { lang, cur };
}

/** Just the language — what `generateMetadata` needs. */
export async function currentLang(): Promise<AppLang> {
  return (await localeForRequest()).lang;
}
