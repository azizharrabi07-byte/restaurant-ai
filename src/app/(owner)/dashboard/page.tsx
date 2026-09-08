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
import { formatDT } from "@/lib/format";
import { hexToRgba } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueChart, OrdersByHourChart } from "@/components/dashboard/charts";
import { OrderCard } from "@/components/dashboard/order-card";

export default function OverviewPage() {
  const { brandColor } = useOnboarding();
  const { orders } = useOrders();
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    );
  }, []);

  const paid = orders.filter((o) => o.status === "paid");
  const accepted = orders.filter((o) => o.status === "accepted");
  const pending = orders.filter((o) => o.status === "pending");
  const revenue = paid.reduce((sum, o) => sum + o.total, 0);
  const avgOrder = paid.length ? revenue / paid.length : 0;

  const recent = [...orders].sort((a, b) => b.number - a.number).slice(0, 5);

  const hours = Array.from({ length: 16 }, (_, i) => 8 + i);
  const revenueByHour = hours.map((h) => ({
    hour: String(h).padStart(2, "0"),
    value: paid.reduce((sum, o) => (o.hour === h ? sum + o.total : sum), 0),
  }));
  const ordersByHour = hours.map((h) => ({
    hour: String(h).padStart(2, "0"),
    value: orders.filter((o) => o.hour === h).length,
  }));
  const peak = orders.length
    ? ordersByHour.reduce((a, b) => (b.value > a.value ? b : a))
    : null;
  const bestSellers = (() => {
    const counts = new Map<string, { qty: number; revenue: number }>();
    for (const o of orders) {
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
        eyebrow={`Overview · ${todayLabel || "Today"}`}
        title="Today at a glance"
        description="A live snapshot of your service — revenue, orders, and what guests are loving right now."
        actions={
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-white/50 hover:text-white transition-colors"
          >
            View all orders
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Today's Revenue"
          value={formatDT(revenue)}
          sub={`${paid.length} paid order${paid.length === 1 ? "" : "s"}`}
          icon={Wallet}
          accent={brandColor.value}
        />
        <StatCard label="Total Orders" value={orders.length} sub="Today" icon={ReceiptText} />
        <StatCard
          label="Pending"
          value={pending.length}
          sub="awaiting action"
          icon={Hourglass}
          accent={hexToRgba("#D97706", 0.25)}
        />
        <StatCard label="Accepted" value={accepted.length} sub="in the kitchen" icon={CheckCircle2} />
        <StatCard label="Paid" value={paid.length} sub="completed" icon={CircleCheck} />
        <StatCard
          label="Avg. Order Value"
          value={formatDT(avgOrder)}
          sub="per paid order"
          icon={TrendingUp}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
                Revenue by hour
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">What each hour generated so far</p>
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
                Orders by hour
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">
                {peak
                  ? `Peak: ${peak.hour}:00 · ${peak.value} order${peak.value === 1 ? "" : "s"}`
                  : "No orders yet today"}
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
              Best-selling products
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {bestSellers.length === 0 ? (
              <p className="py-8 text-center text-xs text-white/30 font-mono uppercase tracking-wider">
                No sales yet — charts fill in as guests order
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
                  <p className="text-[11px] text-white/40 font-mono">{item.qty} sold</p>
                </div>
                <span className="text-sm font-mono text-white/70 shrink-0">{formatDT(item.revenue)}</span>
              </div>
            ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
              Recent orders
            </h3>
            <Link
              href="/dashboard/orders"
              className="text-[11px] font-mono uppercase tracking-wider text-white/40 hover:text-white transition-colors"
            >
              See all
            </Link>
          </div>
          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="py-8 text-center text-xs text-white/30 font-mono uppercase tracking-wider">
                No orders yet — the first guest scan will land here
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