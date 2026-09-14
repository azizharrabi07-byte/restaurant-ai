"use client";

import { useState } from "react";
import { toast } from "sonner";
import { orderSaveError, useOrders } from "@/lib/use-orders";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderCard } from "@/components/dashboard/order-card";
import { OrderStatusPill } from "@/components/dashboard/orders-status-pill";

type Filter = "all" | OrderStatus;

const FILTERS: { key: Filter; labelKey: string }[] = [
  { key: "all", labelKey: "common_all" },
  { key: "pending", labelKey: "status_pending" },
  { key: "accepted", labelKey: "status_accepted" },
  { key: "paid", labelKey: "status_paid" },
];

export default function OrdersPage() {
  const { orders, acceptOrder, markOrderPaid, live, stale, revert } = useOrders();
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...orders].sort((a, b) => b.number - a.number);
  const filtered =
    filter === "all" ? sorted : sorted.filter((o) => o.status === filter);

  const counts: Record<Filter, number> = {
    all: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    accepted: orders.filter((o) => o.status === "accepted").length,
    paid: orders.filter((o) => o.status === "paid").length,
  };

  const handleAccept = async (id: string) => {
    if (busyId === id) return;
    setBusyId(id);
    try {
      const res = await acceptOrder(id);
      // Demo mode has no server to answer, so only a cloud mutation can fail.
      if (live && (!res || !res.ok)) {
        revert();
        const detail = await orderSaveError(res);
        toast.error(detail ? t("ord_saveFailed", { msg: detail }) : t("ord_offline"));
        return;
      }
      toast.success(t("ord_acceptToast"), { description: t("ord_acceptToastDesc") });
    } finally {
      setBusyId(null);
    }
  };

  const handlePaid = async (id: string) => {
    if (busyId === id) return;
    setBusyId(id);
    try {
      const res = await markOrderPaid(id);
      if (live && (!res || !res.ok)) {
        revert();
        const detail = await orderSaveError(res);
        toast.error(detail ? t("ord_saveFailed", { msg: detail }) : t("ord_offline"));
        return;
      }
      toast.success(t("ord_paidToast"), { description: t("ord_paidToastDesc") });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t("ord_eyebrow")}
        title={t("ord_title")}
        description={t("ord_desc")}
      />

      {stale && (
        <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300 leading-relaxed">
          {t("off_staleData")}
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3.5 h-8 rounded-full text-xs font-medium transition-colors cursor-pointer",
              filter === f.key
                ? "bg-white text-black font-bold"
                : "text-white/50 border border-white/10 hover:text-white hover:bg-white/5",
            )}
          >
            {t(f.labelKey)}
            <span className={cn("ms-1.5 font-mono", filter === f.key ? "text-black/60" : "text-white/40")}>
              {counts[f.key]}
            </span>
          </button>
        ))}
        <OrderStatusPill className="ms-auto" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] py-20 text-center">
          <p className="text-sm text-white/60 font-medium">{t("ord_emptyTitle")}</p>
          <p className="text-xs text-white/40 mt-1">
            {live ? t("ord_emptyLive") : t("ord_emptyDemo")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onAccept={handleAccept}
              onPaid={handlePaid}
              disabled={busyId === order.id}
            />
          ))}
        </div>
      )}
    </>
  );
}