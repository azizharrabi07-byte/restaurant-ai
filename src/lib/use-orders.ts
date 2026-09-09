"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import type { Order } from "@/lib/constants";

interface OrdersResponse {
  cloud: boolean;
  orders: Order[];
}

/**
 * Live orders hook. In cloud mode (a restaurant row exists in Supabase) it
 * polls GET /api/orders and mutates via PATCH. Otherwise it tracks the local
 * demo store so the dashboards keep working offline.
 *
 * Accepted orders carry `acceptedBy` so accepted orders accepted on another
 * device disappear from this worker's "accepted" column on the next poll.
 */
export function useOrders() {
  const { isCloud, orders: localOrders } = useOnboarding();
  const live = isCloud;
  const [orders, setOrders] = useState<Order[]>(localOrders);

  // Local (demo) mode — mirror the store.
  useEffect(() => {
    if (!live) setOrders(localOrders);
  }, [live, localOrders]);

  // Cloud mode — poll for new/changed orders.
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) return;
        const data = (await res.json()) as OrdersResponse;
        if (!stopped && data.cloud)
          setOrders(
            data.orders.map((o) =>
              o.isPaid ? { ...o, status: "paid" as const } : o,
            ),
          );
      } catch {
        /* keep last known state */
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [live]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      if (!live) return;
      try {
        await fetch(`/api/orders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* optimistic update already applied — next poll reconciles */
      }
    },
    [live],
  );

  const acceptOrder = useCallback(
    (id: string, opts?: { acceptedBy?: string; acceptedByName?: string }) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id && o.status === "pending"
            ? {
                ...o,
                status: "accepted" as const,
                acceptedBy: opts?.acceptedBy ?? o.acceptedBy,
                acceptedByName: opts?.acceptedByName ?? o.acceptedByName,
              }
            : o,
        ),
      );
      void patch(id, {
        status: "accepted",
        ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
        ...(opts?.acceptedByName ? { acceptedByName: opts.acceptedByName } : {}),
      });
    },
    [patch],
  );

  const markOrderPaid = useCallback(
    (id: string) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id && o.status === "accepted"
            ? { ...o, status: "paid" as const, isPaid: true }
            : o,
        ),
      );
      void patch(id, { isPaid: true });
    },
    [patch],
  );

  return { orders, acceptOrder, markOrderPaid, live };
}