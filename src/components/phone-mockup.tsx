"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { type Category, type MenuTheme, type Product } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import { Wifi, Battery, Search, Plus, UtensilsCrossed } from "lucide-react";

type PhoneLabelKey =
  | "search"
  | "all"
  | "add"
  | "open_now"
  | "dine_in"
  | "type"
  | "scan"
  | "viewport"
  | "no_items"
  | "add_prompt";

interface PhoneMockupProps {
  restaurantName: string;
  logo: string | null;
  brandColor: string;
  categories: Category[];
  products: Product[];
  cover: string | null;
  theme?: MenuTheme;
  className?: string;
  formatPrice?: (price: number) => string;
  labels?: Partial<Record<PhoneLabelKey, string>>;
}

export function PhoneMockup({
  restaurantName,
  logo,
  brandColor,
  categories,
  products,
  cover,
  theme = "classic",
  className,
  formatPrice,
  labels: labelsProp,
}: PhoneMockupProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { t, formatPrice: formatPriceI18n } = useI18n();
  const fmt = formatPrice ?? formatPriceI18n;
  const labels = {
    search: t("g_search"),
    all: t("common_all"),
    add: t("g_add"),
    open_now: t("g_open"),
    dine_in: t("g_dineDemo"),
    type: t("g_type"),
    scan: t("g_scan"),
    viewport: t("g_viewport"),
    no_items: t("g_noItems"),
    add_prompt: t("g_addPrompt"),
    ...labelsProp,
  };

  const displayName = restaurantName || "Your Café";

  const variant =
    theme === "minimal" || theme === "vibrant" || theme === "gallery"
      ? theme
      : "classic";

  const filteredProducts = products.filter((p) => {
    const matchesCategory =
      selectedCategoryId === "all" || p.categoryId === selectedCategoryId;
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className={cn("flex flex-col items-center select-none", className)}>
      {/* Phone Hardware Shell */}
      <div className="relative w-[340px] sm:w-[375px] h-[680px] sm:h-[720px] bg-[#0A0A0A] rounded-[48px] p-3 shadow-2xl border-[6px] border-[#1C1C1C] ring-1 ring-white/10 flex flex-col overflow-hidden">
        {/* Hardware side buttons */}
        <div className="absolute -left-[8px] top-24 w-[3px] h-10 bg-[#252525] rounded-l-sm" />
        <div className="absolute -left-[8px] top-36 w-[3px] h-12 bg-[#252525] rounded-l-sm" />
        <div className="absolute -right-[8px] top-28 w-[3px] h-16 bg-[#252525] rounded-r-sm" />

        {/* Screen Area */}
        <div className="relative w-full h-full bg-[#080808] rounded-[38px] overflow-hidden flex flex-col text-neutral-100 border border-white/5">
          {/* Status Bar */}
          <div className="w-full bg-black/60 backdrop-blur-md px-6 pt-3 pb-2 flex items-center justify-between z-30 text-[11px] font-medium text-white/60">
            <span className="font-mono">9:41</span>
            {/* Dynamic Island */}
            <div className="w-20 h-4 bg-black rounded-full flex items-center justify-center gap-1.5 px-2 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
              <div className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse" />
            </div>
            <div className="flex items-center gap-1.5 text-white/60">
              <Wifi className="w-3 h-3" />
              <Battery className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Scrollable Screen Content */}
          <div className="flex-1 overflow-y-auto no-scrollbar pb-24 relative">
            {/* Cover Banner with Brand Tint */}
            <div
              className={cn(
                "relative w-full bg-[#111111] overflow-hidden",
                variant === "minimal" ? "h-24" : "h-40",
              )}
            >
              {cover ? (
                <img
                  src={cover}
                  alt="Cover banner"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="w-full h-full opacity-60"
                  style={{
                    background: `linear-gradient(135deg, ${brandColor} 0%, #050505 100%)`,
                  }}
                />
              )}
              <div
                className={cn(
                  "absolute inset-0",
                  variant === "minimal"
                    ? "bg-[#080808]/55"
                    : "bg-gradient-to-t from-[#080808] via-[#080808]/40 to-transparent",
                )}
              />

              {/* Live / Dine-in tag */}
              <div className="absolute top-2.5 right-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-[10px] font-mono font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{labels.dine_in}</span>
              </div>
            </div>

            {/* Restaurant Profile Header */}
            <div className={cn("px-4 relative z-10", variant === "minimal" ? "-mt-8" : "-mt-12")}>
              {variant === "minimal" ? (
                <div className="flex flex-col items-center text-center">
                  <div
                    className="w-14 h-14 rounded-2xl bg-[#050505] p-1 shadow-xl border-2 overflow-hidden flex items-center justify-center shrink-0"
                    style={{ borderColor: brandColor }}
                  >
                    {logo ? (
                      <img
                        src={logo}
                        alt={displayName}
                        className="w-full h-full object-cover rounded-xl"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div
                        className="w-full h-full rounded-xl flex items-center justify-center text-white font-serif italic text-xl font-bold"
                        style={{ backgroundColor: brandColor }}
                      >
                        {displayName.charAt(0)}
                      </div>
                    )}
                  </div>
                  <h1 className="text-xl font-medium text-white tracking-tight leading-snug mt-2">
                    {displayName}
                  </h1>
                  <span
                        className="text-[10px] uppercase font-mono tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium mt-1"
                      >
                        <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse align-middle" />
                        {labels.open_now}
                      </span>
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between">
                    {/* Logo Avatar */}
                    <div
                      className="w-20 h-20 rounded-2xl bg-[#050505] p-1 shadow-xl border-2 overflow-hidden flex items-center justify-center shrink-0"
                      style={{ borderColor: brandColor }}
                    >
                      {logo ? (
                        <img
                          src={logo}
                          alt={displayName}
                          className="w-full h-full object-cover rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div
                          className="w-full h-full rounded-xl flex items-center justify-center text-white font-serif italic text-2xl font-bold"
                          style={{ backgroundColor: brandColor }}
                        >
                          {displayName.charAt(0)}
                        </div>
                      )}
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-1.5 pb-1">
                      <span className="text-[10px] uppercase font-mono tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                        <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse align-middle" />
                        {labels.open_now}
                      </span>
                    </div>
                  </div>

                  {/* Title & Meta */}
                  <div className="mt-2.5">
                    <h1
                      className={cn(
                        "text-white tracking-tight leading-snug",
                        variant === "vibrant"
                          ? "text-2xl font-serif italic"
                          : "text-xl font-serif italic",
                      )}
                    >
                      {displayName}
                    </h1>
                    {variant === "vibrant" && (
                      <div
                        className="w-8 h-[3px] rounded-full mt-1"
                        style={{ backgroundColor: brandColor }}
                      />
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-white/40">
                      <span className="capitalize text-white/70">{labels.type}</span>
                      <span>•</span>
                      <span className="font-mono text-white/40">{labels.scan}</span>
                    </div>
                  </div>
                </>
              )}

              {/* Search Bar */}
              <div className="mt-3.5 relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder={labels.search}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    "w-full bg-[#111111] text-xs text-white placeholder:text-white/30 pl-8 pr-3 py-2",
                    variant === "minimal"
                      ? "rounded-t-none border-b border-white/15 focus:border-b-white/40 outline-none"
                      : "rounded-xl border border-white/10 focus:outline-none focus:border-white/30",
                  )}
                />
              </div>

              {/* Category Filter Pills */}
              <div className={cn("mt-3 overflow-x-auto no-scrollbar -mx-4 px-4 flex items-center gap-1.5 pb-1", variant === "minimal" && "gap-0")}>
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId("all")}
                  className={cn(
                    "text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                    variant === "minimal"
                      ? selectedCategoryId === "all"
                        ? "rounded-none border-b-2 px-1.5 text-white"
                        : "rounded-none px-1.5 text-white/40"
                      : selectedCategoryId === "all"
                        ? "text-white shadow-xs"
                        : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
                  )}
                  style={
                    selectedCategoryId === "all"
                      ? variant === "minimal"
                        ? { borderColor: brandColor }
                        : { backgroundColor: brandColor }
                      : undefined
                  }
                >
                  {labels.all} ({products.length})
                </button>

                {categories.map((cat) => {
                  const count = products.filter((p) => p.categoryId === cat.id).length;
                  const isSelected = selectedCategoryId === cat.id;

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={cn(
                        "text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                        variant === "minimal"
                          ? isSelected
                            ? "rounded-none border-b-2 px-1.5 text-white"
                            : "rounded-none px-1.5 text-white/40"
                          : isSelected
                            ? "text-white shadow-xs"
                            : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
                      )}
                      style={
                        isSelected
                          ? variant === "minimal"
                            ? { borderColor: brandColor }
                            : { backgroundColor: brandColor }
                          : undefined
                      }
                    >
                      {cat.name} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Product Listing */}
              <div className="mt-3 space-y-2.5">
                {filteredProducts.length === 0 ? (
                  <div className="py-8 text-center bg-[#0C0C0C] rounded-xl border border-dashed border-white/10 p-4">
                    <UtensilsCrossed className="w-6 h-6 text-white/20 mx-auto mb-2" />
                    <p className="text-xs font-medium text-white/40">{labels.no_items}</p>
                    <p className="text-[11px] text-white/30 mt-1">
                      {searchQuery
                        ? labels.add_prompt
                        : t("g_addStep4")}
                    </p>
                  </div>
                ) : (
                  filteredProducts.map((prod) => {
                    const stacked = variant === "vibrant" || variant === "gallery";
                    const minimal = variant === "minimal";

                    if (minimal) {
                      return (
                        <div
                          key={prod.id}
                          className="px-1 py-2.5 border-b border-white/10 flex items-center justify-between gap-3 group"
                        >
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs font-medium text-white leading-snug">
                              {prod.name}
                            </h3>
                            {products.length > 0 && (
                              <span className="text-[9px] uppercase tracking-wider font-mono text-white/40 inline-block mt-1">
                                {categories.find((c) => c.id === prod.categoryId)?.name ?? "Menu"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-xs font-mono text-white font-bold">
                              {fmt(prod.price)}
                            </span>
                            <span
                              className="text-[11px] font-semibold text-white flex items-center gap-0.5"
                              style={{ color: brandColor }}
                            >
                              <Plus className="w-3 h-3" />
                              {labels.add}
                            </span>
                          </div>
                        </div>
                      );
                    }

                    if (stacked) {
                      return (
                        <div
                          key={prod.id}
                          className="rounded-xl bg-[#0E0E0E] overflow-hidden group"
                          style={
                            variant === "vibrant"
                              ? { border: `3px solid ${brandColor}` }
                              : { border: "1px solid rgba(255,255,255,0.1)" }
                          }
                        >
                          <div
                            className={cn(
                              "w-full bg-[#161616]",
                              variant === "gallery" ? "aspect-[4/3]" : "h-20",
                            )}
                          >
                            {prod.image ? (
                              <img
                                src={prod.image}
                                alt={prod.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <UtensilsCrossed className="w-5 h-5 text-white/20" />
                              </div>
                            )}
                          </div>
                          <div className="p-2.5 flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-xs font-semibold text-white leading-snug">
                                {prod.name}
                              </h3>
                              {products.length > 0 && (
                                <span className="text-[9px] uppercase tracking-wider font-mono text-white/40 inline-block mt-1">
                                  {categories.find((c) => c.id === prod.categoryId)?.name ?? "Menu"}
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-mono text-white font-bold shrink-0">
                            {fmt(prod.price)}
                          </span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={prod.id}
                        className="p-2.5 rounded-xl bg-[#0E0E0E] border border-white/10 hover:border-white/20 transition-all flex gap-3 group"
                      >
                        {/* Text Details */}
                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex items-start justify-between gap-1">
                              <h3 className="text-xs font-medium text-white leading-snug">
                                {prod.name}
                              </h3>
                            </div>
                            {products.length > 0 && (
                              <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/10 inline-block mt-1.5">
                                {categories.find((c) => c.id === prod.categoryId)?.name ?? "Menu"}
                              </span>
                            )}
                          </div>

                          {/* Price & Add button */}
                          <div className="flex items-center justify-between mt-2 pt-1">
                            <span className="text-xs font-mono text-white font-bold">
                              {fmt(prod.price)}
                            </span>
                            <span
                              className="text-[11px] px-2.5 py-1 rounded-full font-medium text-white flex items-center gap-1 shadow-xs"
                              style={{ backgroundColor: brandColor }}
                            >
                              <Plus className="w-3 h-3" />
                              <span>{labels.add}</span>
                            </span>
                          </div>
                        </div>

                        {/* Image Thumbnail */}
                        {prod.image ? (
                          <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#161616] shrink-0 border border-white/10">
                            <img
                              src={prod.image}
                              alt={prod.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#161616] shrink-0 border border-white/10 flex items-center justify-center">
                            <UtensilsCrossed className="w-5 h-5 text-white/20" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Home indicator bar */}
          <div className="absolute bottom-1 inset-x-0 flex justify-center py-1 pointer-events-none z-30">
            <div className="w-28 h-1 bg-white/20 rounded-full" />
          </div>
        </div>
      </div>
      <p className="text-[10px] text-white/40 mt-3 font-mono tracking-widest uppercase">
        {labels.viewport}
      </p>
    </div>
  );
}