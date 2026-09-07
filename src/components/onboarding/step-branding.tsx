"use client";

import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { ImageDropzone } from "@/components/image-dropzone";
import { hexToRgba } from "@/lib/utils";
import { useOnboarding } from "@/lib/onboarding-store";
import {
  BRAND_PALETTE,
  COVER_PRESETS,
  type BrandColor,
} from "@/lib/constants";
import { StepHeading } from "@/components/onboarding/step-heading";

export function StepBranding() {
  const { brandColor, setBrandColor, cover, setCover } = useOnboarding();
  const [customHex, setCustomHex] = useState(brandColor.value || "#D97706");
  const [showCustomHexInput, setShowCustomHexInput] = useState(false);

  const handleSelectColor = (color: BrandColor) => {
    setCustomHex(color.value);
    setBrandColor({ ...color, accentBg: hexToRgba(color.value, 0.15) });
  };

  const handleCustomHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomHex(val);
    if (/^#[0-9A-Fa-f]{6}$/i.test(val)) {
      setBrandColor({
        id: "custom",
        name: "Custom",
        value: val.toLowerCase(),
        accentBg: hexToRgba(val, 0.15),
        category: "Custom",
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow="Step 02 · Aesthetics"
        title="Define your look and feel"
        description="Select your signature accent color and hero banner to craft a tailored digital dining atmosphere."
      />

      <div className="space-y-6">
        {/* Primary Color Section */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Primary Brand Accent</h3>
              <p className="text-xs text-white/40 mt-0.5">
                Applied to category pills, call-to-action highlights, and customer order badges.
              </p>
            </div>
            {/* Active Color Sample Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#111111] border border-white/10 shrink-0">
              <span
                className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs"
                style={{ backgroundColor: brandColor.value }}
              />
              <span className="text-xs font-mono text-white/80 uppercase">{brandColor.value}</span>
            </div>
          </div>

          {/* Preset Swatches */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {BRAND_PALETTE.map((p) => {
              const isSelected = brandColor.value.toLowerCase() === p.value.toLowerCase();
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectColor(p)}
                  className={`p-3 rounded-lg border flex items-center gap-3 transition-all cursor-pointer text-left ${
                    isSelected
                      ? "bg-[#1A1A1A] border-white/40 ring-1 ring-white/20 shadow-sm"
                      : "bg-[#111111] border-white/10 hover:border-white/20"
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 shadow-xs border border-white/10"
                    style={{ backgroundColor: p.value }}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{p.name}</p>
                    <p className="text-[10px] text-white/40 font-mono uppercase">{p.value}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom Color Toggle */}
          <div className="pt-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowCustomHexInput(!showCustomHexInput)}
              className="text-xs text-white/50 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{showCustomHexInput ? "Hide custom HEX picker" : "Use custom HEX color code"}</span>
            </button>

            {showCustomHexInput && (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customHex.startsWith("#") ? customHex : "#D97706"}
                  onChange={(e) => handleCustomHexChange(e)}
                  className="w-8 h-8 rounded-lg border border-white/20 bg-transparent cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={handleCustomHexChange}
                  placeholder="#D97706"
                  maxLength={7}
                  className="w-28 bg-[#111111] border border-white/10 text-xs font-mono text-white px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-white/30"
                />
              </div>
            )}
          </div>
        </div>

        {/* Cover Image Section */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Hero Backdrop Banner</h3>
            <p className="text-xs text-white/40 mt-0.5">
              Displays as a cinematic backdrop banner at the top of your mobile QR menu.
            </p>
          </div>

          <ImageDropzone
            value={cover}
            onChange={setCover}
            shape="cover"
            presets={COVER_PRESETS}
            hint="Landscape photography recommended (1200×500px). Select from curated sample presets or upload your own."
          />
        </div>
      </div>
    </div>
  );
}