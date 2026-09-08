"use client";

import { OnboardingProvider } from "@/lib/onboarding-store";

export function Providers({ children }: { children: React.ReactNode }) {
  return <OnboardingProvider>{children}</OnboardingProvider>;
}