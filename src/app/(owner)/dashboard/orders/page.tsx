"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useOrders } from "@/lib/use-orders";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderCard } from "@/components/dashboard/order-card";
import { OrderStatusPill } from "@/components/dashboard/orders-status-pill";

type Filter = "all" | OrderStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "paid", label: "Paid" },
];

export default function OrdersPage() {
  const { orders, acceptOrder, markOrderPaid, live } = useOrders();
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = [...orders].sort((a, b) => b.number - a.number);
  const filtered =
    filter === "all" ? sorted : sorted.filter((o) => o.status === filter);

  const counts: Record<Filter, number> = {
    all: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    accepted: orders.filter((o) => o.status === "accepted").length,
    paid: orders.filter((o) => o.status === "paid").length,
  };

  const handleAccept = (id: string) => {
    acceptOrder(id);
    toast.success("Order accepted", { description: "The kitchen is on it." });
  };

  const handlePaid = (id: string) => {
    markOrderPaid(id);
    toast.success("Order marked as paid", { description: "Another one settled." });
  };

  return (
    <>
      <PageHeader
        eyebrow="Owner · Orders"
        title="Live orders"
        description="Track every order coming in today — accept and settle them as they move through service."
      />

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
            {f.label}
            <span className={cn("ml-1.5 font-mono", filter === f.key ? "text-black/60" : "text-white/40")}>
              {counts[f.key]}
            </span>
          </button>
        ))}
        <OrderStatusPill className="ml-auto" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] py-20 text-center">
          <p className="text-sm text-white/60 font-medium">No orders here</p>
          <p className="text-xs text-white/40 mt-1">
            {live
              ? "Orders will appear the moment customers scan and place them."
              : "Demo data shown. Save your menu once and live orders from guest scans appear here."}
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
            />
          ))}
        </div>
      )}
    </>
  );
}