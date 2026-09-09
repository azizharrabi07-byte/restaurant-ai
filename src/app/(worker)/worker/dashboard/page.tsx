"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Plus } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderCard } from "@/components/dashboard/order-card";
import { OrderStatusPill } from "@/components/dashboard/orders-status-pill";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";
import { WorkerNewOrderDialog } from "@/components/dashboard/worker-new-order";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const COLUMNS: {
  key: OrderStatus;
  titleKey: string;
  hintKey: string;
  dot: string;
  accentText: string;
}[] = [
  {
    key: "pending",
    titleKey: "wd_newOrders",
    dot: "bg-amber-400",
    accentText: "text-amber-400",
    hintKey: "wd_pendingHint",
  },
  {
    key: "accepted",
    titleKey: "status_accepted",
    dot: "bg-white/60",
    accentText: "text-white/60",
    hintKey: "wd_acceptedHint",
  },
  {
    key: "paid",
    titleKey: "status_paid",
    dot: "bg-emerald-400",
    accentText: "text-emerald-400",
    hintKey: "wd_paidHint",
  },
];

export default function WorkerDashboardPage() {
  const { restaurantName, workerSession } = useOnboarding();
  const { orders, acceptOrder, markOrderPaid } = useOrders();
  const { t } = useI18n();
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(null);

  const venue = restaurantName || "Velvet & Stone Coffee";

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
  }, []);

  const enableNotifications = useCallback(() => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((p) => {
      setNotifPerm(p);
      if (p === "granted")
        toast.success(t("nd_on"), { description: t("nd_onDesc") });
    });
  }, [t]);

  // Orders accepted by another worker disappear from this worker's board.
  const isEngagedByOther = (order: { acceptedBy?: string | null }) =>
    Boolean(order.acceptedBy && workerSession && order.acceptedBy !== workerSession.id);

  const byStatus = (status: OrderStatus) =>
    [...orders]
      .filter((o) => o.status === status)
      .filter((o) => !(status === "accepted" && isEngagedByOther(o)))
      .sort((a, b) => b.number - a.number);

  const handleAccept = (id: string) => {
    acceptOrder(id, {
      acceptedBy: workerSession?.id ?? undefined,
      acceptedByName: workerSession?.name ?? undefined,
    });
    toast.success(t("wd_acceptToast"), { description: t("wd_acceptToastDesc") });
  };

  const handlePaid = (id: string) => {
    markOrderPaid(id);
    toast.success(t("wd_paidToast"), { description: t("wd_paidToastDesc") });
  };

  return (
    <>
      <NewOrderAlerts orders={orders} venue={venue} />
      <PageHeader
        eyebrow={t("wk_terminal")}
        title={t("ord_title")}
        description={t("wd_desc", { venue })}
        actions={
          <>
            {typeof Notification !== "undefined" && notifPerm === "default" && (
              <button
                type="button"
                onClick={enableNotifications}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-white/10 text-white/60 hover:text-white hover:border-white/25 text-xs font-medium transition-colors cursor-pointer"
              >
                <BellRing className="w-3.5 h-3.5" />
                {t("nd_enable")}
              </button>
            )}
            <Button onClick={() => setNewOrderOpen(true)}>
              <Plus className="w-4 h-4" />
              {t("wo_new")}
            </Button>
            <OrderStatusPill />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const items = byStatus(col.key);
          return (
            <section
              key={col.key}
              className={cn(
                "rounded-xl border border-white/10 bg-[#0A0A0A] p-4 sm:p-5 min-h-[200px]",
              )}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-white/60">
                  <span className={cn("w-1.5 h-1.5 rounded-full", col.dot, col.key === "pending" && "animate-pulse")} />
                  {t(col.titleKey)}
                </h3>
                <span
                  className={cn(
                    "text-xs font-mono font-bold",
                    items.length > 0 ? col.accentText : "text-white/30",
                  )}
                >
                  {String(items.length).padStart(2, "0")}
                </span>
              </div>

              {items.length === 0 ? (
                <p className="py-8 text-center text-xs text-white/30 font-mono uppercase tracking-wider">
                  {t("wd_nothing")}
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onAccept={handleAccept}
                      onPaid={handlePaid}
                    />
                  ))}
                </div>
              )}

              {col.key === "pending" && items.length > 0 && (
                <p className="mt-4 text-[10px] text-white/30 hidden lg:block text-center font-mono uppercase tracking-wider">
                  {t(col.hintKey)}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <WorkerNewOrderDialog open={newOrderOpen} onOpenChange={setNewOrderOpen} />
    </>
  );
}