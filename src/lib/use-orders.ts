"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import type { Order } from "@/lib/constants";

interface OrdersResponse {
  cloud: boolean;
  orders: Order[];
}

/**
 * Reason to show for a mutation that failed: the route's `message` (e.g. the
 * 403 role explanation) or `error` code, falling back to the HTTP status.
 * `null` means the request never reached the server.
 */
export async function orderSaveError(res: Response | null): Promise<string | null> {
  if (!res) return null;
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    return data.message ?? data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Cloud board refresh interval. */
const POLL_INTERVAL_MS = 3000;

/**
 * Live orders hook. In cloud mode (a restaurant row exists in Supabase) it
 * polls GET /api/orders and mutates via PATCH. Otherwise it tracks the local
 * demo store so the dashboards keep working offline.
 *
 * Accepted orders carry `acceptedBy` so accepted orders accepted on another
 * device disappear from this worker's "accepted" column on the next poll.
 *
 * Polling contract: one request in flight at a time, one AbortController per
 * tick, responses applied in sequence only (a slow earlier poll can never
 * overwrite a newer list), no polling while the tab is hidden, an immediate
 * refresh when it becomes visible again, and a `stale` flag while requests are
 * failing so a frozen board is visible instead of silent.
 *
 * Mutations are optimistic: `acceptOrder` / `markOrderPaid` return the PATCH
 * `Response` (`null` when the request never reached the server) so the caller
 * can surface the server's message and call `revert` to drop the optimistic
 * state. `revert` restores the last server-confirmed snapshot.
 */
export function useOrders() {
  const { isCloud, orders: localOrders } = useOnboarding();
  const live = isCloud;
  const [orders, setOrders] = useState<Order[]>(localOrders);
  const [stale, setStale] = useState(false);
  const ordersRef = useRef<Order[]>(localOrders);
  /** Last server-confirmed list — the rollback source for a failed PATCH. */
  const snapshotRef = useRef<Order[]>(localOrders);

  const applyOrders = useCallback((next: Order[]) => {
    ordersRef.current = next;
    setOrders(next);
  }, []);

  // Local (demo) mode — mirror the store.
  useEffect(() => {
    if (!live) {
      snapshotRef.current = localOrders;
      applyOrders(localOrders);
    }
  }, [live, localOrders, applyOrders]);

  // Cloud mode — poll for new/changed orders.
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let inFlight = false;
    let seq = 0; // monotonic request id
    let applied = 0; // newest id whose response has been applied
    let ac: AbortController | null = null;

    const load = async () => {
      if (inFlight) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight = true;
      const controller = new AbortController();
      ac = controller;
      const mine = ++seq;
      try {
        const res = await fetch("/api/orders", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (stopped || mine < applied) return;
        if (!res.ok) {
          applied = mine;
          setStale(true);
          return;
        }
        const data = (await res.json()) as OrdersResponse;
        if (stopped || !data.cloud || mine < applied) return;
        applied = mine;
        setStale(false);
        const next = data.orders.map((o) =>
          o.isPaid ? { ...o, status: "paid" as const } : o,
        );
        snapshotRef.current = next;
        applyOrders(next);
      } catch {
        // Aborted (unmount/teardown) or the network is down. Keep the last
        // known list rather than blanking the board; flag it so the operator
        // can tell "no orders" from "no connection".
        if (!stopped && !controller.signal.aborted) setStale(true);
      } finally {
        inFlight = false;
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      ac?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, applyOrders]);

  /** Drop the optimistic state, restoring the last server-confirmed list. */
  const revert = useCallback(() => {
    applyOrders(snapshotRef.current);
  }, [applyOrders]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<Response | null> => {
      if (!live) return null;
      try {
        return await fetch(`/api/orders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Transport failure — the caller reverts the optimistic state and
        // reports it, instead of claiming a success that never happened.
        return null;
      }
    },
    [live],
  );

  const acceptOrder = useCallback(
    async (id: string, opts?: { acceptedBy?: string; acceptedByName?: string }) => {
      // The optimistic update and the PATCH must agree on the precondition:
      // accepting an order that is already accepted would rewrite
      // `accepted_by` to this clicker while the UI keeps showing the original
      // accepter.
      if (ordersRef.current.find((o) => o.id === id)?.status !== "pending") {
        return null;
      }
      applyOrders(
        ordersRef.current.map((o) =>
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
      return patch(id, {
        status: "accepted",
        ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
        ...(opts?.acceptedByName ? { acceptedByName: opts.acceptedByName } : {}),
      });
    },
    [patch, applyOrders],
  );

  const markOrderPaid = useCallback(
    async (id: string) => {
      if (ordersRef.current.find((o) => o.id === id)?.status !== "accepted") {
        return null;
      }
      applyOrders(
        ordersRef.current.map((o) =>
          o.id === id && o.status === "accepted"
            ? { ...o, status: "paid" as const, isPaid: true }
            : o,
        ),
      );
      return patch(id, { isPaid: true });
    },
    [patch, applyOrders],
  );

  return { orders, acceptOrder, markOrderPaid, live, stale, revert };
}
