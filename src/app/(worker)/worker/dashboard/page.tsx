"use client";

import { toast } from "sonner";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderCard } from "@/components/dashboard/order-card";
import { OrderStatusPill } from "@/components/dashboard/orders-status-pill";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";

const COLUMNS: {
  key: OrderStatus;
  title: string;
  dot: string;
  accentText: string;
  hint: string;
}[] = [
  {
    key: "pending",
    title: "New Orders",
    dot: "bg-amber-400",
    accentText: "text-amber-400",
    hint: "Accept when the kitchen starts on it",
  },
  {
    key: "accepted",
    title: "Accepted",
    dot: "bg-white/60",
    accentText: "text-white/60",
    hint: "Being prepared — settle when paid",
  },
  {
    key: "paid",
    title: "Paid",
    dot: "bg-emerald-400",
    accentText: "text-emerald-400",
    hint: "Completed and settled",
  },
];

export default function WorkerDashboardPage() {
  const { restaurantName } = useOnboarding();
  const { orders, acceptOrder, markOrderPaid } = useOrders();
  const venue = restaurantName || "Velvet & Stone Coffee";

  const byStatus = (status: OrderStatus) =>
    [...orders]
      .filter((o) => o.status === status)
      .sort((a, b) => b.number - a.number);

  const handleAccept = (id: string) => {
    acceptOrder(id);
    toast.success("Order accepted", { description: "Pushed to the kitchen flow." });
  };

  const handlePaid = (id: string) => {
    markOrderPaid(id);
    toast.success("Marked as paid", { description: "Cheque closed. On to the next." });
  };

  return (
    <>
      <NewOrderAlerts orders={orders} venue={venue} />
      <PageHeader
        eyebrow="Cashier Terminal"
        title="Live orders"
        description={`Every scan from ${venue} lands here. Move them along: accept, then settle.`}
        actions={<OrderStatusPill />}
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
                  {col.title}
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
                  Nothing here yet
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
                  {col.hint}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}