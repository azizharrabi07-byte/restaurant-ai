"use client";

import { useState } from "react";
import { Store, Palette, FolderTree, UtensilsCrossed, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { SaveStatus } from "@/components/dashboard/save-status";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepBranding } from "@/components/onboarding/step-branding";
import { StepCategories } from "@/components/onboarding/step-categories";
import { StepProducts } from "@/components/onboarding/step-products";
import { PhoneMockup } from "@/components/phone-mockup";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "business", labelKey: "me_tabIdentity", icon: Store },
  { id: "branding", labelKey: "me_tabFF", icon: Palette },
  { id: "categories", labelKey: "me_tabCategories", icon: FolderTree },
  { id: "products", labelKey: "me_tabProducts", icon: UtensilsCrossed },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MenuEditorPage() {
  const [active, setActive] = useState<TabId>("business");
  const [previewOpen, setPreviewOpen] = useState(false);
  const { restaurantName, logo, brandColor, categories, products, cover, theme } =
    useOnboarding();
  const { t } = useI18n();

  const preview = (
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
  );

  return (
    <>
      <PageHeader
        eyebrow={t("me_eyebrow")}
        title={t("me_title")}
        description={t("me_desc")}
        actions={<SaveStatus />}
      />

      {/* Mobile / tablet: toggleable live preview */}
      <div className="lg:hidden mb-5">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-xs font-medium border transition-all cursor-pointer",
            previewOpen
              ? "bg-white text-black font-bold border-white"
              : "bg-[#111111] text-white/70 hover:text-white border-white/10",
          )}
        >
          <Smartphone className="w-3.5 h-3.5" />
          {previewOpen ? t("me_hidePreview") : t("me_showPreview")}
        </button>
        {previewOpen && (
          <div className="mt-5 flex flex-col items-center gap-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              {t("me_livePreview")}
            </p>
            {preview}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-7 min-w-0">
          <div className="mb-8 flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActive(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                    isActive
                      ? "bg-white text-black font-bold border-white"
                      : "bg-[#111111] text-white/50 hover:text-white border-white/10",
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>

          {active === "business" && <StepBusiness headingEyebrow={t("me_eyebrowId")} />}
          {active === "branding" && <StepBranding headingEyebrow={t("me_eyebrowFF")} />}
          {active === "categories" && <StepCategories headingEyebrow={t("me_eyebrowCats")} />}
          {active === "products" && <StepProducts headingEyebrow={t("me_eyebrowProds")} />}
        </div>

        {/* Desktop: sticky live preview */}
        <aside className="hidden lg:block lg:col-span-5">
          <div className="sticky top-24 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                {t("me_livePreviewDesktop")}
              </p>
            </div>
            {preview}
          </div>
        </aside>
      </div>
    </>
  );
}