"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  ReceiptText,
  Hourglass,
  CheckCircle2,
  CircleCheck,
  TrendingUp,
  Star,
  ArrowRight,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { useI18n } from "@/lib/i18n";
import { hexToRgba } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueChart, OrdersByHourChart } from "@/components/dashboard/charts";
import { OrderCard } from "@/components/dashboard/order-card";

export default function OverviewPage() {
  const { brandColor } = useOnboarding();
  const { orders } = useOrders();
  const { t, plural, formatPrice, lang } = useI18n();
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    const locale = lang === "fr" ? "fr-FR" : lang === "ar" ? "ar-TN" : "en-GB";
    setTodayLabel(
      new Date().toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    );
  }, [lang]);

  // "Today" must mean today: the API returns the last 60 orders across days,
// so scope every KPI/chart to the local calendar day. Orders without a
// timestamp (local demo mode) can't be dated and stay included.
  const isTodayOrder = (o: (typeof orders)[number]): boolean => {
    if (!o.createdAt) return true;
    const d = new Date(o.createdAt);
    if (Number.isNaN(d.getTime())) return true;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };
  const todayOrders = orders.filter(isTodayOrder);

  const paid = todayOrders.filter((o) => o.status === "paid");
  const accepted = todayOrders.filter((o) => o.status === "accepted");
  const pending = todayOrders.filter((o) => o.status === "pending");
  const revenue = paid.reduce((sum, o) => sum + o.total, 0);
  const avgOrder = paid.length ? revenue / paid.length : 0;

  const recent = [...orders].sort((a, b) => b.number - a.number).slice(0, 5);

  // Localize wall-clock hours from the order timestamps when available
  // (the server frequently runs in UTC; the dashboard renders in local tz).
  const hourOf = (o: (typeof orders)[number]): number => {
    if (o.createdAt) {
      const d = new Date(o.createdAt);
      if (!Number.isNaN(d.getTime())) return d.getHours();
    }
    return o.hour;
  };

  const hours = Array.from({ length: 16 }, (_, i) => 8 + i);
  const revenueByHour = hours.map((h) => ({
    hour: String(h).padStart(2, "0"),
    value: paid.reduce((sum, o) => (hourOf(o) === h ? sum + o.total : sum), 0),
  }));
  const ordersByHour = hours.map((h) => ({
    hour: String(h).padStart(2, "0"),
    value: todayOrders.filter((o) => hourOf(o) === h).length,
  }));
  const peak = todayOrders.length
    ? ordersByHour.reduce((a, b) => (b.value > a.value ? b : a))
    : null;
  const bestSellers = (() => {
    const counts = new Map<string, { qty: number; revenue: number }>();
    for (const o of todayOrders) {
      for (const it of o.items) {
        const cur = counts.get(it.name) ?? { qty: 0, revenue: 0 };
        cur.qty += it.qty;
        cur.revenue += it.qty * it.price;
        counts.set(it.name, cur);
      }
    }
    return [...counts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  })();

  return (
    <>
      <PageHeader
        eyebrow={`${t("ov_eyebrow")} · ${todayLabel || t("ov_today")}`}
        title={t("ov_title")}
        description={t("ov_desc")}
        actions={
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
          >
            {t("ov_viewAll")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard
          label={t("ov_revenue")}
          value={formatPrice(revenue)}
          sub={plural(paid.length, "ov_paidSub_one", "ov_paidSub_other")}
          icon={Wallet}
          accent={brandColor.value}
        />
        <StatCard label={t("ov_totalOrders")} value={todayOrders.length} sub={t("ov_today")} icon={ReceiptText} />
        <StatCard
          label={t("status_pending")}
          value={pending.length}
          sub={t("ov_awaiting")}
          icon={Hourglass}
          accent={hexToRgba("#D97706", 0.25)}
        />
        <StatCard label={t("status_accepted")} value={accepted.length} sub={t("ov_inKitchen")} icon={CheckCircle2} />
        <StatCard label={t("status_paid")} value={paid.length} sub={t("ov_completed")} icon={CircleCheck} />
        <StatCard
          label={t("ov_avgOrder")}
          value={formatPrice(avgOrder)}
          sub={t("ov_perPaid")}
          icon={TrendingUp}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
                {t("ov_revByHour")}
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">{t("ov_revByHourSub")}</p>
            </div>
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: brandColor.value }}
            />
          </div>
          <RevenueChart
            data={revenueByHour}
            brandColor={brandColor.value}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
                {t("ov_ordersByHour")}
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">
                {peak
                  ? t("ov_peak", { hour: `${peak.hour}:00`, count: peak.value })
                  : t("ov_noOrdersToday")}
              </p>
            </div>
          </div>
          <OrdersByHourChart data={ordersByHour} />
        </div>
      </div>

      {/* Best sellers + recent orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-3.5 h-3.5" style={{ color: brandColor.value }} />
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
              {t("ov_bestSellers")}
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {bestSellers.length === 0 ? (
              <p className="py-8 text-center text-xs text-white/30 font-mono uppercase tracking-wider">
                {t("ov_noSales")}
              </p>
            ) : (
              bestSellers.map((item, i) => (
              <div key={item.name} className="flex items-center gap-3 py-3">
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-mono shrink-0 border"
                  style={
                    i === 0
                      ? { backgroundColor: hexToRgba(brandColor.value, 0.18), color: brandColor.value, borderColor: hexToRgba(brandColor.value, 0.35) }
                      : undefined
                  }
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium truncate">{item.name}</p>
                  <p className="text-[11px] text-white/40 font-mono">{plural(item.qty, "ov_sold_one", "ov_sold_other")}</p>
                </div>
                <span className="text-sm font-mono text-white/70 shrink-0">{formatPrice(item.revenue)}</span>
              </div>
            ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
              {t("ov_recentOrders")}
            </h3>
            <Link
              href="/dashboard/orders"
              className="text-[11px] font-mono uppercase tracking-wider text-white/40 hover:text-white transition-colors"
            >
              {t("ov_seeAll")}
            </Link>
          </div>
          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="py-8 text-center text-xs text-white/30 font-mono uppercase tracking-wider">
                {t("ov_noOrdersYet")}
              </p>
            ) : (
              recent.map((order) => (
                <OrderCard key={order.id} order={order} className="!p-4" />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}