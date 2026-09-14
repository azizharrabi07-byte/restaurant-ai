"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ReceiptText,
  QrCode,
  Users,
  Settings,
  PenLine,
  UtensilsCrossed,
  LogOut,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { hexToRgba } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { SaveStatus } from "@/components/dashboard/save-status";
import { LangCurSwitcher } from "@/components/lang-cur-switcher";

const NAV = [
  { href: "/dashboard", labelKey: "nav_overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/orders", labelKey: "nav_orders", icon: ReceiptText, exact: false },
  { href: "/dashboard/tables", labelKey: "nav_tables", icon: QrCode, exact: true },
  { href: "/dashboard/workers", labelKey: "nav_workers", icon: Users, exact: true },
  { href: "/dashboard/menu", labelKey: "nav_menu", icon: UtensilsCrossed, exact: true },
  { href: "/dashboard/settings", labelKey: "nav_settings", icon: Settings, exact: true },
];

export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { restaurantName, logo, brandColor } = useOnboarding();
  const { t } = useI18n();
  const displayName = restaurantName || t("ob_yourCafe");

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const navLink = (item: (typeof NAV)[number]) => {
    const active = isActive(item);
    return (
      <a
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 mx-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer",
          active ? "text-white font-medium" : "text-white/50 hover:text-white hover:bg-white/5",
        )}
        style={active ? { backgroundColor: hexToRgba(brandColor.value, 0.12) } : undefined}
      >
        <item.icon
          className="w-4 h-4 shrink-0"
          style={active ? { color: brandColor.value } : undefined}
        />
        <span className="truncate">{t(item.labelKey)}</span>
        {active && (
          <span
            className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: brandColor.value }}
          />
        )}
      </a>
    );
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/auth/login");
      router.refresh();
    }
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-white/10 bg-[#080808]">
        <Link href="/dashboard" className="flex items-center gap-3 h-16 px-5 border-b border-white/10 group">
          <RestaurantLogo logo={logo} name={displayName} brandColor={brandColor.value} size={38} />
          <div className="min-w-0">
            <p className="font-serif italic text-white text-[15px] leading-tight truncate">
              {displayName}
            </p>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-mono mt-0.5">
              {t("owner_dashboard")}
            </p>
          </div>
        </Link>

        <nav className="flex-1 py-5 space-y-0.5">{NAV.map(navLink)}</nav>

        <div className="border-t border-white/10 p-3 space-y-2">
          <Link
            href="/dashboard/menu"
            className="flex items-center gap-3 mx-0 px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <PenLine className="w-4 h-4" />
            <span>{t("owner_editMenu")}</span>
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-3 mx-0 px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
          <div className="flex justify-center py-2 px-1 rounded-lg bg-white/[0.03] border border-white/5">
            <LangCurSwitcher className="scale-[0.95] origin-center" />
          </div>
          <div className="flex justify-center py-1 rounded-lg bg-white/[0.03] border border-white/5">
            <SaveStatus />
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-60">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 border-b border-white/10 bg-[#080808]/95 backdrop-blur">
          <div className="flex items-center justify-between h-14 px-4">
            <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
              <RestaurantLogo logo={logo} name={displayName} brandColor={brandColor.value} size={32} />
              <p className="font-serif italic text-white text-sm truncate">{displayName}</p>
            </Link>
            <Link
              href="/dashboard/menu"
              className="text-[10px] font-mono uppercase tracking-wider text-white/50 hover:text-white px-3 py-1.5 rounded-full border border-white/10"
            >
              {t("owner_editMenu")}
            </Link>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar px-3 pb-2.5">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors",
                  isActive(item)
                    ? "bg-white text-black font-bold"
                    : "text-white/50 hover:text-white hover:bg-white/5 border border-white/10",
                )}
              >
                <item.icon className="w-3.5 h-3.5" />
                {t(item.labelKey)}
              </a>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-[1180px] px-4 sm:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}