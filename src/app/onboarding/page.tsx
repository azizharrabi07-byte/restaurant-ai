"use client";

import { useState, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/onboarding/navbar";
import { Stepper, STEPS } from "@/components/onboarding/stepper";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepBranding } from "@/components/onboarding/step-branding";
import { StepCategories } from "@/components/onboarding/step-categories";
import { StepProducts } from "@/components/onboarding/step-products";
import { StepPreview } from "@/components/onboarding/step-preview";
import { useOnboarding } from "@/lib/onboarding-store";
import { PhoneMockup } from "@/components/phone-mockup";

function WizardInner() {
  const [step, setStep] = useState(1);
  const [showLivePreview, setShowLivePreview] = useState(true);

  const {
    restaurantName,
    logo,
    brandColor,
    categories,
    products,
    cover,
    theme,
    loadDemo,
  } = useOnboarding();

  const totalSteps = STEPS.length;

  const canContinue =
    step === 1
      ? restaurantName.trim().length > 0
      : step === 3
        ? categories.length > 0
        : true;

  const goNext = useCallback(() => {
    if (!canContinue || step >= totalSteps) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [canContinue, step, totalSteps]);

  const goBack = useCallback(() => {
    if (step <= 1) return;
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const goToStep = useCallback((s: number) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if (e.key === "Enter" && canContinue && step < totalSteps) {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canContinue, goNext, step, totalSteps]);

  const stepContent = (
    <>
      {step === 1 && <StepBusiness />}
      {step === 2 && <StepBranding />}
      {step === 3 && <StepCategories />}
      {step === 4 && <StepProducts />}

      {/* Navigation Footer */}
      <div className="pt-6 flex items-center justify-between border-t border-white/5 mt-8">
        <span className="text-xs text-white/40 uppercase tracking-widest font-mono hidden sm:block">
          Next: {STEPS[step]?.shortTitle ?? ""}
        </span>
        <div className={cn("flex items-center gap-2", step === 1 && "ml-auto")}>
          {step > 1 && (
            <Button type="button" variant="outline" onClick={goBack}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            onClick={goNext}
            disabled={!canContinue}
            className="min-w-[200px]"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-[#050505] text-[#E5E5E5]">
      <Navbar
        restaurantName={restaurantName}
        currentStep={step}
        showLivePreview={showLivePreview}
        onTogglePreview={() => setShowLivePreview((v) => !v)}
        onResetDemo={loadDemo}
        onGoToFinalStep={() => goToStep(5)}
      />
      <Stepper currentStep={step} onSelectStep={goToStep} />

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
        {step === 5 ? (
          <StepPreview onBack={goBack} onJumpToStep={goToStep} />
        ) : showLivePreview ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7 min-w-0">{stepContent}</div>

            {/* Side live preview (desktop) */}
            <aside className="hidden lg:block lg:col-span-5">
              <div className="sticky top-24 flex flex-col items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                    Syncing live
                  </p>
                </div>
                <PhoneMockup
                  restaurantName={restaurantName}
                  logo={logo}
                  brandColor={brandColor.value}
                  categories={categories}
                  products={products}
                  cover={cover}
                  theme={theme}
                  className="scale-[0.85] origin-top -my-10"
                />
                <button
                  type="button"
                  onClick={() => goToStep(5)}
                  className="text-xs text-white/50 hover:text-white font-mono uppercase tracking-wider inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Open full preview
                </button>
              </div>
            </aside>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">{stepContent}</div>
        )}
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return <WizardInner />;
}