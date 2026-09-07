"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { type Category, type Product } from "@/lib/constants";
import { formatDT } from "@/lib/format";
import { Wifi, Battery, Search, Plus, UtensilsCrossed } from "lucide-react";

interface PhoneMockupProps {
  restaurantName: string;
  logo: string | null;
  brandColor: string;
  categories: Category[];
  products: Product[];
  cover: string | null;
  className?: string;
}

export function PhoneMockup({
  restaurantName,
  logo,
  brandColor,
  categories,
  products,
  cover,
  className,
}: PhoneMockupProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const displayName = restaurantName || "Your Café";

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
            <div className="relative h-40 w-full bg-[#111111] overflow-hidden">
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
              <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/40 to-transparent" />

              {/* Live / Dine-in tag */}
              <div className="absolute top-2.5 right-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-[10px] font-mono font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Table 04 · Dine-In</span>
              </div>
            </div>

            {/* Restaurant Profile Header */}
            <div className="px-4 -mt-12 relative z-10">
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
                    Open Now
                  </span>
                </div>
              </div>

              {/* Title & Meta */}
              <div className="mt-2.5">
                <h1 className="text-xl font-serif italic text-white tracking-tight leading-snug">
                  {displayName}
                </h1>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-white/40">
                  <span className="capitalize text-white/70">Café &amp; Kitchen</span>
                  <span>•</span>
                  <span className="font-mono text-white/40">
                    Scan to order
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="mt-3.5 relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder="Search dishes, coffees, drinks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#111111] text-xs text-white placeholder:text-white/30 rounded-xl pl-8 pr-3 py-2 border border-white/10 focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Category Filter Pills */}
              <div className="mt-3 overflow-x-auto no-scrollbar -mx-4 px-4 flex items-center gap-1.5 pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId("all")}
                  className={cn(
                    "text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                    selectedCategoryId === "all"
                      ? "text-white shadow-xs"
                      : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
                  )}
                  style={
                    selectedCategoryId === "all"
                      ? { backgroundColor: brandColor }
                      : undefined
                  }
                >
                  All Items ({products.length})
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
                        isSelected
                          ? "text-white shadow-xs"
                          : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
                      )}
                      style={
                        isSelected ? { backgroundColor: brandColor } : undefined
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
                    <p className="text-xs font-medium text-white/40">No menu items found</p>
                    <p className="text-[11px] text-white/30 mt-1">
                      {searchQuery
                        ? "Try adjusting your search terms"
                        : "Add products in Step 4 to populate your menu"}
                    </p>
                  </div>
                ) : (
                  filteredProducts.map((prod) => (
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
                            {formatDT(prod.price)}
                          </span>
                          <span
                            className="text-[11px] px-2.5 py-1 rounded-full font-medium text-white flex items-center gap-1 shadow-xs"
                            style={{ backgroundColor: brandColor }}
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
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
                  ))
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
        Customer Mobile Viewport (375 × 667)
      </p>
    </div>
  );
}