"use client";

import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { RestaurantLogo } from "@/components/restaurant-logo";

export function WorkerShell({ children }: { children: React.ReactNode }) {
  const { restaurantName, logo, brandColor, orders } = useOnboarding();
  const displayName = restaurantName || "Velvet & Stone Coffee";
  const pendingCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 h-16 border-b border-white/10 bg-[#080808]/95 backdrop-blur flex items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3 min-w-0 group">
          <div className="w-8 h-8 bg-white flex items-center justify-center rounded-sm shrink-0 transition-transform group-hover:rotate-45">
            <div className="w-4 h-4 border-2 border-black rotate-45"></div>
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="font-serif italic text-white text-base leading-tight truncate">{displayName}</p>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-mono">Worker Terminal</p>
          </div>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-4">
          <span className="hidden md:inline-flex items-center gap-2 text-xs text-white/40 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {pendingCount} new order{pendingCount === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-3 py-1">
            <div className="flex items-center justify-center rounded-full bg-[#1A1A1A] border border-white/10 h-6 w-6">
              <MessageSquareText className="w-3 h-3 text-white/70" />
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/70">Cashier</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-8 py-8">{children}</main>
    </div>
  );
}