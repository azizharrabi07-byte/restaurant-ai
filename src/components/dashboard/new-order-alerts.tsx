"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Order } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";

function playChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const notes = [880, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch {
    /* audio not available — the toast still fires */
  }
}

interface NewOrderAlertsProps {
  orders: Order[];
  venue?: string;
}

/**
 * Fires a toast + chime + browser notification the moment a new pending
 * order arrives. Existing pending orders on first mount are ignored so
 * opening the page doesn't replay old orders.
 *
 * Shows acceptance events too so every worker sees when a co-worker has
 * claimed an order (reduces double-clicks / collisions).
 */
export function NewOrderAlerts({ orders, venue }: NewOrderAlertsProps) {
  const seen = useRef<Map<string, { status: string; acceptedBy: string | null }> | null>(null);
  const { t } = useI18n();

  // Proactively request notification permission once on mount.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // Delay so it happens after a user gesture (page render) — browsers
      // are more lenient after the first interaction.
      const id = setTimeout(() => {
        void Notification.requestPermission().catch(() => {});
      }, 2500);
      return () => clearTimeout(id);
    }
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Map(
        orders.map((o) => [o.id, { status: o.status, acceptedBy: o.acceptedBy }]),
      );
      return;
    }

    const prev = seen.current;
    const notifyBrowser = (title: string, body: string) => {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(title, { body });
        } catch {
          /* ignore */
        }
      }
    };

    for (const o of orders) {
      const p = prev.get(o.id);

      if (!p) {
        // Brand-new order (INSERT).
        if (o.status === "pending") {
          playChime();
          const items = o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
          toast(t("na_newOrder", { n: o.number }), {
            description: t("na_desc", {
              t: String(o.table).padStart(2, "0"),
              items,
            }),
          });
          notifyBrowser(
            venue ? t("na_venue", { venue }) : t("na_new"),
            t("na_body", {
              n: o.number,
              t: String(o.table).padStart(2, "0"),
            }),
          );
        }
      } else {
        // State change on an existing order.
        if (p.status === "pending" && o.status === "accepted") {
          // Someone (us or a co-worker) just claimed it.
          const by = o.acceptedByName ?? t("na_coworker");
          toast.info(t("na_claimed", { n: o.number }), {
            description: t("na_claimedDesc", {
              by,
              t: String(o.table).padStart(2, "0"),
            }),
          });
          notifyBrowser(
            t("na_claimed", { n: o.number }),
            t("na_claimedBrowser", { by, t: String(o.table).padStart(2, "0") }),
          );
        }
        if (p.status !== "paid" && o.status === "paid") {
          toast.success(t("na_paid", { n: o.number }), {
            description: t("na_paidDesc", { t: String(o.table).padStart(2, "0") }),
          });
        }
      }

      prev.set(o.id, { status: o.status, acceptedBy: o.acceptedBy });
    }
  }, [orders, venue, t]);

  return null;
}
