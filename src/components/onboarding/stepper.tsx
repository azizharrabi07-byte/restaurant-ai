"use client";

import { Building2, Palette, FolderTree, Utensils, Smartphone, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface StepDefinition {
  step: number;
  titleKey: string;
  shortKey: string;
  descriptionKey: string;
}

export const STEPS: StepDefinition[] = [
  {
    step: 1,
    titleKey: "ob_stp1t",
    shortKey: "ob_stp1",
    descriptionKey: "ob_stp1d",
  },
  {
    step: 2,
    titleKey: "ob_stp2t",
    shortKey: "ob_stp2",
    descriptionKey: "ob_stp2d",
  },
  {
    step: 3,
    titleKey: "ob_stp3t",
    shortKey: "ob_stp3",
    descriptionKey: "ob_stp3d",
  },
  {
    step: 4,
    titleKey: "ob_stp4t",
    shortKey: "ob_stp4",
    descriptionKey: "ob_stp4d",
  },
  {
    step: 5,
    titleKey: "ob_stp5t",
    shortKey: "ob_stp5",
    descriptionKey: "ob_stp5d",
  },
];

interface StepperProps {
  currentStep: number;
  onSelectStep: (step: number) => void;
}

export function Stepper({ currentStep, onSelectStep }: StepperProps) {
  const { t } = useI18n();
  const getStepIcon = (step: number, isCompleted: boolean) => {
    if (isCompleted) {
      return <Check className="w-4 h-4 text-white stroke-[2.5]" />;
    }
    switch (step) {
      case 1:
        return <Building2 className="w-4 h-4" />;
      case 2:
        return <Palette className="w-4 h-4" />;
      case 3:
        return <FolderTree className="w-4 h-4" />;
      case 4:
        return <Utensils className="w-4 h-4" />;
      case 5:
        return <Smartphone className="w-4 h-4" />;
      default:
        return <Building2 className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-full border-b border-white/10 bg-[#080808]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <nav aria-label={t("ob_progress")} className="overflow-x-auto no-scrollbar py-4">
          <ol className="flex items-center min-w-max md:min-w-0 md:grid md:grid-cols-5 gap-2 sm:gap-4">
            {STEPS.map((s, idx) => {
              const isActive = currentStep === s.step;
              const isCompleted = currentStep > s.step;

              return (
                <li key={s.step} className="relative">
                  <button
                    type="button"
                    onClick={() => onSelectStep(s.step)}
                    className={cn(
                      "w-full text-start py-2 px-3 rounded-lg transition-colors flex items-center gap-3.5 group cursor-pointer",
                      isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.02]",
                    )}
                  >
                    {/* Numbered Step Circle */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0 transition-colors",
                        isActive
                          ? "bg-white text-black font-bold shadow-xs"
                          : isCompleted
                            ? "border border-white/40 bg-white/10 text-white font-medium"
                            : "border border-white/20 text-white/40 font-mono group-hover:border-white/40 group-hover:text-white/70",
                      )}
                    >
                      {isCompleted ? (
                        <Check className="w-3 h-3 stroke-[2.5]" />
                      ) : isActive ? (
                        getStepIcon(s.step, false)
                      ) : (
                        `0${s.step}`
                      )}
                    </div>

                    {/* Step Title */}
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "text-xs uppercase tracking-widest block truncate transition-colors",
                          isActive
                            ? "text-white font-bold"
                            : isCompleted
                              ? "text-white/70 font-medium"
                              : "text-white/40 font-medium group-hover:text-white/60",
                        )}
                      >
                        {t(s.shortKey)}
                      </span>
                    </div>

                    {/* Connecting line for next item on desktop */}
                    {idx < STEPS.length - 1 && (
                      <div className="hidden lg:block w-3 h-px bg-white/10 shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}