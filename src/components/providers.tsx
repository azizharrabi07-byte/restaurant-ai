"use client";

import { OnboardingProvider } from "@/lib/onboarding-store";
import { I18nProvider, type AppCurrency, type AppLang } from "@/lib/i18n";

export function Providers({
  children,
  initialLang,
  initialCur,
}: {
  children: React.ReactNode;
  initialLang?: AppLang;
  initialCur?: AppCurrency;
}) {
  return (
    <I18nProvider initialLang={initialLang} initialCur={initialCur}>
      <OnboardingProvider>{children}</OnboardingProvider>
    </I18nProvider>
  );
}
