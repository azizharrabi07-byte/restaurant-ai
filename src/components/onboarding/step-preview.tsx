"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Palette,
  FolderTree,
  Utensils,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  CloudUpload,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneMockup } from "@/components/phone-mockup";
import { useOnboarding } from "@/lib/onboarding-store";
import { toast } from "sonner";

interface StepPreviewProps {
  onBack: () => void;
  onJumpToStep: (step: number) => void;
}

export function StepPreview({ onBack, onJumpToStep }: StepPreviewProps) {
  const { restaurantName, logo, brandColor, categories, products, cover, theme } =
    useOnboarding();
  const [finished, setFinished] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleFinish = () => {
    setFinished(true);
    toast.success("Setup complete!", {
      description: "Your demo menu is ready. Open the owner dashboard when you’re ready.",
      duration: 5000,
    });
  };

  const handleCopy = () => {
    const url = `${restaurantName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-") || "my-cafe"}.menuos.app`;
    navigator.clipboard.writeText(`https://${url}`);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const checklist = [
    {
      step: 1,
      icon: Building2,
      primary: restaurantName || "Unnamed",
      secondary: "Business Identity",
    },
    {
      step: 2,
      icon: Palette,
      primary: (
        <span className="flex items-center gap-2">
          <span
            className="w-3.5 h-3.5 rounded-full border border-white/20"
            style={{ backgroundColor: brandColor.value }}
          />
          <span>Brand Accent</span>
        </span>
      ),
      secondary: "Branding & Ambience",
    },
    {
      step: 3,
      icon: FolderTree,
      primary: `${categories.length} Categories`,
      secondary: categories.map((c) => c.name).slice(0, 2).join(", "),
    },
    {
      step: 4,
      icon: Utensils,
      primary: `${products.length} Menu Items`,
      secondary: "Active dishes & beverages",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300 pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2 font-medium">
              Step 05 · Live Preview
            </p>
            <h2 className="text-3xl sm:text-4xl font-serif italic text-white mb-2">
              Ready for the spotlight
            </h2>
            <p className="text-white/40 max-w-xl text-sm sm:text-base leading-relaxed">
              This is exactly what your customers will see when they scan a QR code at the table.
            </p>
          </div>

          <span className="text-[10px] uppercase font-mono tracking-wider px-2.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 border self-start sm:self-center bg-white/5 text-white/70 border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
            Draft Preview Ready
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Setup Overview */}
        <div className="lg:col-span-5 space-y-5 order-2 lg:order-1">
          {/* Live Status Banner */}
          <div className="p-5 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-widest text-white/40">
                Menu Status
              </span>
              <span className="text-[10px] uppercase font-mono tracking-wider px-2.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Ready to Publish
              </span>
            </div>

            <div>
              <p className="text-xs text-white/40">Scan Link</p>
              <div className="mt-1.5 flex items-center justify-between p-2.5 rounded-lg bg-[#111111] border border-white/10 text-xs font-mono">
                <span className="text-white/90 truncate pr-2">
                  {restaurantName
                    ? `https://${restaurantName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")}.menuos.app`
                    : "https://my-cafe.menuos.app"}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-white/40 hover:text-white p-1 hover:bg-white/5 rounded-full transition-colors cursor-pointer shrink-0"
                  title="Copy menu URL"
                >
                  {copiedUrl ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Onboarding Checklist */}
          <div className="p-5 rounded-xl bg-[#0D0D0D] border border-white/10 space-y-4">
            <h3 className="text-xs uppercase tracking-widest font-mono text-white/60">
              Onboarding Checklist
            </h3>

            <div className="divide-y divide-white/5 text-xs">
              {checklist.map((item) => (
                <div key={item.step} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-[#111111] border border-white/10 flex items-center justify-center text-white/60 shrink-0">
                      <item.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-white block truncate">{item.primary}</span>
                      <span className="text-[11px] text-white/40 block truncate">{item.secondary}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJumpToStep(item.step)}
                    className="text-white/40 hover:text-white text-xs font-mono uppercase tracking-wider cursor-pointer shrink-0"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Guide */}
          <div className="p-4 rounded-xl bg-[#0D0D0D] border border-white/10 text-xs space-y-2">
            <p className="font-medium text-white">Interactive Mobile Simulator</p>
            <ul className="text-white/40 space-y-1.5 list-disc list-inside">
              <li>Try the search bar and filter categories with the pill tags</li>
              <li>Your brand accent colors every call-to-action</li>
              <li>Prices format as Tunisian Dinars (DT) automatically</li>
            </ul>
          </div>

          {/* Actions / Finish */}
          <div className="pt-2 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
              Back to Products
            </Button>

            {finished ? (
              <Link href="/dashboard">
                <Button type="button" className="font-bold text-xs">
                  Go to Dashboard
                  <ArrowRight className="w-3.5 h-3.5 text-black" />
                </Button>
              </Link>
            ) : (
              <Button type="button" onClick={handleFinish} className="font-bold text-xs">
                <CloudUpload className="w-3.5 h-3.5 text-black" />
                Finish Setup
              </Button>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-4">
            <Info className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />
            <div className="text-xs text-white/40 leading-relaxed">
              <p className="font-medium text-white/80 mb-1">What happens next?</p>
              <p>
                From the Owner Dashboard you can generate a unique QR code for every table,
                print them, invite workers, and watch orders arrive in real time. Your menu
                is synced to the cloud as you edit — scan the menu link above on any phone.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Phone Preview */}
        <div className="lg:col-span-7 flex justify-center order-1 lg:order-2">
          <PhoneMockup
            restaurantName={restaurantName}
            logo={logo}
            brandColor={brandColor.value}
            categories={categories}
            products={products}
            cover={cover}
            theme={theme}
          />
        </div>
      </div>
    </div>
  );
}