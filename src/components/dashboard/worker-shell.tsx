"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { useWorkerIdentity } from "@/lib/worker-identity";
import { useI18n } from "@/lib/i18n";
import { RestaurantLogo } from "@/components/restaurant-logo";

export function WorkerShell({ children }: { children: React.ReactNode }) {
  const { restaurantName, logo, brandColor } = useOnboarding();
  const { orders } = useOrders();
  const { worker, clear } = useWorkerIdentity();
  const { t, plural } = useI18n();
  const displayName = restaurantName || "Velvet & Stone Coffee";
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const myCount = orders.filter(
    (o) => o.status === "accepted" && worker && o.acceptedBy === worker.id,
  ).length;

  const initials = worker?.name
    ? worker.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 h-16 border-b border-white/10 bg-[#080808]/95 backdrop-blur flex items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3 min-w-0 group">
          <div className="w-8 h-8 bg-white flex items-center justify-center rounded-sm shrink-0 transition-transform group-hover:rotate-45">
            <div className="w-4 h-4 border-2 border-black rotate-45"></div>
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="font-serif italic text-white text-base leading-tight truncate">{displayName}</p>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-mono">{t("wk_terminal")}</p>
          </div>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-4">
          <span className="hidden md:inline-flex items-center gap-2 text-xs text-white/40 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {plural(pendingCount, "w_orders_one", "w_orders_other")}
          </span>
          {myCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-white/70">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: brandColor.value }}
              />
              {t("w_myOrders", { n: myCount })}
            </span>
          )}
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-1 py-1">
            <div className="flex items-center gap-2 pl-2 pr-1">
              <div
                className="flex items-center justify-center rounded-full h-6 w-6 text-black text-[10px] font-bold"
                style={{ backgroundColor: brandColor.value }}
              >
                {initials}
              </div>
              <span className="text-[11px] font-mono text-white/80 hidden sm:inline max-w-[110px] truncate">
                {worker?.name ?? "—"}
              </span>
            </div>
            <button
              type="button"
              onClick={clear}
              title={t("w_switchWorker")}
              className="h-6 w-6 rounded-full text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-8 py-8">{children}</main>
    </div>
  );
}
