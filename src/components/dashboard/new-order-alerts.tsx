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
 * order arrives from the cloud. Existing pending orders on first mount are
 * ignored so opening the page doesn't replay old orders.
 */
export function NewOrderAlerts({ orders, venue }: NewOrderAlertsProps) {
  const seen = useRef<Set<string> | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(orders.map((o) => o.id));
      return;
    }

    const fresh = orders.filter(
      (o) => o.status === "pending" && !seen.current!.has(o.id),
    );

    for (const o of orders) seen.current.add(o.id);

    fresh.forEach((o) => {
      playChime();

      const items = o.items
        .map((i) => `${i.qty}× ${i.name}`)
        .join(", ");
      toast(t("na_newOrder", { n: o.number }), {
        description: t("na_desc", { t: String(o.table).padStart(2, "0"), items }),
        action: {
          label: t("na_view"),
          onClick: () => {
            window.location.href = "/worker/dashboard";
          },
        },
      });

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification(
            venue ? t("na_venue", { venue }) : t("na_new"),
            {
              body: t("na_body", {
                n: o.number,
                t: String(o.table).padStart(2, "0"),
              }),
            },
          );
        } catch {
          /* some browsers throw — the toast already covered it */
        }
      }
    });
  }, [orders, venue, t]);

  return null;
}