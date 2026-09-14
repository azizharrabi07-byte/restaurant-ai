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
import { useI18n } from "@/lib/i18n";
import { LOGO_PRESETS } from "@/lib/constants";
import { BUSINESS_TYPES } from "@/lib/constants";
import { StepHeading } from "@/components/onboarding/step-heading";

export function StepBusiness({ headingEyebrow }: { headingEyebrow?: string }) {
  const { t } = useI18n();
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
    <div className="max-w-2xl mx-auto text-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow={headingEyebrow ?? t("ob_eyebrow1")}
        title={t("sb_title")}
        description={t("sb_desc")}
      />

      <div className="space-y-6">
        {/* Business Name Input */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <label
              htmlFor="restaurant-name"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              {t("sb_nameLabel")}
            </label>
            <Input
              id="restaurant-name"
              placeholder={t("sb_namePh")}
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-white/40 mt-1.5">
              {t("sb_nameHint")}
            </p>
          </div>

          <div>
            <label
              htmlFor="restaurant-tagline"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              {t("sb_taglineLabel")}
            </label>
            <Input
              id="restaurant-tagline"
              placeholder={t("sb_taglinePh")}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
            />
            <p className="text-xs text-white/40 mt-1.5">
              {t("sb_taglineHint")}
            </p>
          </div>

          <div>
            <label
              htmlFor="restaurant-type"
              className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5"
            >
              {t("sb_typeLabel")}
            </label>
            <Select value={businessType} onValueChange={setBusinessType}>
              <SelectTrigger id="restaurant-type">
                <SelectValue placeholder={t("sb_typePh")} />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map((bt) => (
                  <SelectItem key={bt.value} value={bt.value}>
                    {bt.labelKey ? t(bt.labelKey) : bt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Logo Upload Section */}
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("sb_emblemTitle")}</h3>
            <p className="text-xs text-white/40 mt-0.5">
              {t("sb_emblemDesc")}
            </p>
          </div>

          <ImageDropzone
            value={logo}
            onChange={setLogo}
            shape="logo"
            presets={LOGO_PRESETS}
            hint={t("sb_logoHint")}
          />
        </div>
      </div>
    </div>
  );
}