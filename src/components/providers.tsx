"use client";

import { OnboardingProvider } from "@/lib/onboarding-store";
import { I18nProvider } from "@/lib/i18n";
import { WorkerIdentityProvider } from "@/lib/worker-identity";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <WorkerIdentityProvider>
        <OnboardingProvider>{children}</OnboardingProvider>
      </WorkerIdentityProvider>
    </I18nProvider>
  );
}
