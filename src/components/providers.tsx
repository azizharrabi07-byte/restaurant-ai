"use client";

import { OnboardingProvider } from "@/lib/onboarding-store";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <OnboardingProvider>{children}</OnboardingProvider>
    </I18nProvider>
  );
}