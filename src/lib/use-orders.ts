"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { getSupabaseClient } from "@/lib/supabase-browser";
import type { Order } from "@/lib/constants";

interface OrdersResponse {
  cloud: boolean;
  orders: Order[];
}

interface CreateOrderInput {
  tableId: string;
  items: { productId: string; name: string; price: number; qty: number }[];
}

function normalize(o: Order): Order {
  return o.isPaid || o.status === "paid" ? { ...o, status: "paid" as const } : o;
}

/**
 * Live orders hook.
 * - Cloud mode: does an initial fetch, then opens a Supabase Realtime
 *   subscription on the `orders` table. Orders are updated instantly via
 *   INSERT/UPDATE/DELETE broadcasts — no more polling delay → race conditions
 *   (two workers grabbing the same order) surface in <100ms.
 * - Local/demo mode: reads from the onboarding store.
 *
 * Accepting an order is atomic on the server (only the first PATCH wins;
 * losers get a 409 with the claimant name), so the UI can safely remove
 * orders claimed by co-workers immediately.
 */
export function useOrders() {
  const { isCloud, orders: localOrders, createWorkerOrder, restaurantId } =
    useOnboarding();
  const live = isCloud;
  const [orders, setOrders] = useState<Order[]>(localOrders);
  const subRef = useRef<{ channel: unknown; client: unknown }>({ channel: null, client: null });

  // Local mode: mirror onboarding store
  useEffect(() => {
    if (!live) {
      setOrders(localOrders);
    }
  }, [live, localOrders]);

  // Cloud: initial fetch + Realtime subscription
  useEffect(() => {
    if (!live || !restaurantId) return;
    let stopped = false;

    const load = async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) return;
        const data = (await res.json()) as OrdersResponse;
        if (!stopped && data.cloud) setOrders(data.orders.map(normalize));
      } catch {
        /* keep last known state */
      }
    };
    void load();

    // Try Supabase Realtime; fall back to fast polling if unavailable.
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const channel = (sb as unknown as {
          channel: (name: string, opts: unknown) => {
            on: (event: string, filter: unknown, cb: () => void) => unknown;
            subscribe: () => unknown;
          };
        })
          .channel(`orders:${restaurantId}`, {
            config: { broadcast: { self: true } },
          })
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "orders",
              filter: `restaurant_id=eq.${restaurantId}`,
            },
            () => {
              // Refetch on any change — keeps ordering/items/accepted_by consistent.
              void load();
            },
          );
        (channel as { subscribe: () => void }).subscribe();
        subRef.current = { channel, client: sb };
      } catch {
        /* Realtime disabled on Supabase project — fall back to poll */
      }
    }

    // Short-interval poll as a safety net even when Realtime is up (covers
    // reconnects / edge cases). 2.5s is tight enough that two workers can't
    // stare at the same pending order for long.
    const t = setInterval(load, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
      try {
        if (subRef.current.channel && subRef.current.client) {
          const client = subRef.current.client as { removeChannel: (c: unknown) => Promise<unknown> };
          void client.removeChannel(subRef.current.channel);
        }
      } catch {
        /* ignore */
      }
      subRef.current = { channel: null, client: null };
    };
  }, [live, restaurantId]);

  const patch = useCallback(
    async (
      id: string,
      body: {
        status?: string;
        isPaid?: boolean;
        workerId?: string;
        workerName?: string;
      },
    ): Promise<{ ok: boolean; conflict?: boolean; acceptedBy?: string | null }> => {
      if (!live) return { ok: false };
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as {
          cloud: boolean;
          conflict?: boolean;
          acceptedBy?: string | null;
        };
        if (res.status === 409) {
          return { ok: false, conflict: true, acceptedBy: data.acceptedBy ?? null };
        }
        return { ok: res.ok };
      } catch {
        return { ok: false };
      }
    },
    [live],
  );

  const acceptOrder = useCallback(
    async (id: string, workerId: string, workerName: string) => {
      // Optimistic: flip this order to "accepted" attributed to us immediately
      // so the UI feels instant.
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id && o.status === "pending"
            ? {
                ...o,
                status: "accepted" as const,
                acceptedBy: workerId,
                acceptedByName: workerName,
                acceptedAt: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }
            : o,
        ),
      );
      const result = await patch(id, {
        status: "accepted",
        workerId,
        workerName,
      });
      if (result.conflict) {
        // Another worker beat us — roll back our optimistic update and the
        // server/refetch will immediately reflect the real claimant.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id
              ? { ...o, status: "pending" as const, acceptedBy: null, acceptedByName: null, acceptedAt: null }
              : o,
          ),
        );
        return { claimed: false, acceptedBy: result.acceptedBy ?? null };
      }
      return { claimed: true, acceptedBy: workerName };
    },
    [patch],
  );

  const markOrderPaid = useCallback(
    async (id: string) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id && o.status !== "paid"
            ? { ...o, status: "paid" as const, isPaid: true }
            : o,
        ),
      );
      await patch(id, { isPaid: true });
    },
    [patch],
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput) => {
      createWorkerOrder(input.tableId, input.items);
      if (!live) return { ok: true };
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: input.tableId, items: input.items }),
        });
        const data = await res.json();
        return { ok: res.ok && data.cloud, order: data.order };
      } catch {
        return { ok: false };
      }
    },
    [live, createWorkerOrder],
  );

  return {
    orders,
    acceptOrder,
    markOrderPaid,
    createOrder,
    live,
  };
}
