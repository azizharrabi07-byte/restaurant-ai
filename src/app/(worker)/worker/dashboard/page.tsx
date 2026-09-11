"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { useWorkerIdentity } from "@/lib/worker-identity";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderCard } from "@/components/dashboard/order-card";
import { OrderStatusPill } from "@/components/dashboard/orders-status-pill";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";
import { NewOrderDialog } from "@/components/dashboard/new-order-dialog";
import { WorkerGreeting } from "@/components/dashboard/worker-greeting";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

type ColumnKey = "pending" | "mine" | "others" | "paid";

const COLUMNS: {
  key: ColumnKey;
  titleKey: string;
  dot: string;
  accentText: string;
}[] = [
  {
    key: "pending",
    titleKey: "wd_newOrders",
    dot: "bg-amber-400",
    accentText: "text-amber-400",
  },
  {
    key: "mine",
    titleKey: "wd_mine",
    dot: "bg-emerald-400",
    accentText: "text-emerald-400",
  },
  {
    key: "others",
    titleKey: "wd_others",
    dot: "bg-white/60",
    accentText: "text-white/60",
  },
  {
    key: "paid",
    titleKey: "status_paid",
    dot: "bg-white/30",
    accentText: "text-white/40",
  },
];

export default function WorkerDashboardPage() {
  const { restaurantName } = useOnboarding();
  const { orders, acceptOrder, markOrderPaid } = useOrders();
  const { worker } = useWorkerIdentity();
  const { t } = useI18n();
  const venue = restaurantName || "Velvet & Stone Coffee";
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const grouped = useMemo(() => {
    const sorted = [...orders].sort((a, b) => b.number - a.number);
    return {
      pending: sorted.filter((o) => o.status === "pending"),
      mine: sorted.filter(
        (o) => o.status === "accepted" && worker && o.acceptedBy === worker.id,
      ),
      others: sorted.filter(
        (o) =>
          o.status === "accepted" &&
          (!worker || o.acceptedBy !== worker.id) &&
          o.acceptedBy !== null,
      ),
      paid: sorted.filter((o) => o.status === "paid"),
    };
  }, [orders, worker]);

  const handleAccept = async (id: string) => {
    if (!worker) return;
    const result = await acceptOrder(id, worker.id, worker.name);
    if (!result.claimed) {
      toast.error(t("wd_takenTitle"), {
        description: t("wd_takenDesc", { name: result.acceptedBy ?? t("na_coworker") }),
      });
    } else {
      toast.success(t("wd_acceptToast"), { description: t("wd_acceptToastDesc") });
    }
  };

  const handlePaid = (id: string) => {
    markOrderPaid(id);
    toast.success(t("wd_paidToast"), { description: t("wd_paidToastDesc") });
  };

  return (
    <>
      <WorkerGreeting />
      <NewOrderAlerts orders={orders} venue={venue} />
      <PageHeader
        eyebrow={t("wk_terminal")}
        title={t("ord_title")}
        description={t("wd_desc", { venue })}
        actions={
          <div className="flex items-center gap-2">
            <OrderStatusPill />
            <Button
              type="button"
              size="sm"
              className="font-bold"
              onClick={() => setNewOrderOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 text-black" />
              {t("wo_newOrder")}
            </Button>
          </div>
        }
      />

      <NewOrderDialog open={newOrderOpen} onOpenChange={setNewOrderOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const items = grouped[col.key];
          return (
            <section
              key={col.key}
              className={cn(
                "rounded-xl border border-white/10 bg-[#0A0A0A] p-4 sm:p-5 min-h-[200px] transition-all",
              )}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-white/60">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      col.dot,
                      col.key === "pending" && "animate-pulse",
                    )}
                  />
                  {col.key === "mine"
                    ? t(col.titleKey, { name: worker?.name ?? "" })
                    : t(col.titleKey)}
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
                  {col.key === "pending"
                    ? t("wd_nothing")
                    : col.key === "mine"
                      ? t("wd_nothingMine")
                      : t("wd_nothing")}
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((order) => {
                    const isMine =
                      worker !== null && order.acceptedBy === worker.id;
                    const isOtherAccepted =
                      order.status === "accepted" && !isMine;
                    return (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onAccept={
                          col.key === "pending" ? handleAccept : undefined
                        }
                        onPaid={isMine ? handlePaid : undefined}
                        acceptedByMe={isMine}
                        muted={isOtherAccepted && col.key === "others"}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
