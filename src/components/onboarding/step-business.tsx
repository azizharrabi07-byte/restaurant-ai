"use client";

import { Input } from "@/components/ui/input";
import { ImageDropzone } from "@/components/image-dropzone";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useOnboarding } from "@/lib/onboarding-store";
import { LOGO_PRESETS } from "@/lib/constants";
import { BUSINESS_TYPES } from "@/lib/constants";
import { StepHeading } from "@/components/onboarding/step-heading";

export function StepBusiness({ headingEyebrow }: { headingEyebrow?: string }) {
  const {
    restaurantName,
    setRestaurantName,
    tagline,
    setTagline,
    businessType,
    setBusinessType,
    logo,
    setLogo,
  } = useOnboarding();

  return (
    <div className="max-w-2xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow={headingEyebrow ?? "Step 01 · Identity"}
        title="Name your establishment"
        description="Configure the core identity for your restaurant or café. Guests will see this when scanning your QR menu."
      />

      <div className="space-y-6">
        {/* Business Name Input */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <label
              htmlFor="restaurant-name"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              Establishment Name *
            </label>
            <Input
              id="restaurant-name"
              placeholder="e.g., Le Bon Bistro, Café Noor"
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-white/40 mt-1.5">
              This appears prominently at the top of your digital QR menu.
            </p>
          </div>

          <div>
            <label
              htmlFor="restaurant-tagline"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              Tagline
            </label>
            <Input
              id="restaurant-tagline"
              placeholder="e.g., Single-origin coffee, slow mornings."
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
            />
            <p className="text-xs text-white/40 mt-1.5">
              A short line under your name on the customer menu. Optional.
            </p>
          </div>

          <div>
            <label
              htmlFor="restaurant-type"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              Business Type
            </label>
            <Select value={businessType} onValueChange={setBusinessType}>
              <SelectTrigger id="restaurant-type">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map((bt) => (
                  <SelectItem key={bt.value} value={bt.value}>
                    {bt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Logo Upload Section */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Brand Emblem / Monogram</h3>
            <p className="text-xs text-white/40 mt-0.5">
              Upload your establishment badge or monogram. Displays on the phone preview and QR stands.
            </p>
          </div>

          <ImageDropzone
            value={logo}
            onChange={setLogo}
            shape="logo"
            presets={LOGO_PRESETS}
            hint="Square asset recommended. PNG with transparency or clean JPG."
          />
        </div>
      </div>
    </div>
  );
}