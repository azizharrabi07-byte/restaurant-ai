import type { Order } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, UserRound } from "lucide-react";

interface OrderCardProps {
  order: Order;
  onAccept?: (id: string) => void;
  onPaid?: (id: string) => void;
  className?: string;
  acceptedByMe?: boolean;
  /** When true the card is dimmed (claimed by another worker). */
  muted?: boolean;
}

export function OrderCard({
  order,
  onAccept,
  onPaid,
  className,
  acceptedByMe,
  muted,
}: OrderCardProps) {
  const { t, plural, formatPrice } = useI18n();
  const totalQty = order.items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-[#0D0D0D] p-4 sm:p-5 space-y-4 animate-fade-up transition-opacity duration-300",
        muted && "opacity-55 pointer-events-none",
        acceptedByMe && "ring-1 ring-emerald-400/30",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-[#111111] min-w-[46px] px-2 py-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">{t("oc_table")}</span>
            <span className="text-base font-bold text-white font-mono leading-tight">
              {String(order.table).padStart(2, "0")}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs text-white font-medium">#{order.number}</p>
            <p className="text-[11px] text-white/40 font-mono mt-0.5">{order.placedAt}</p>
          </div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Claim line — who accepted this order */}
      {order.status === "accepted" && order.acceptedByName && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono",
            acceptedByMe
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-white/10 bg-white/[0.03] text-white/60",
          )}
        >
          <UserRound className="w-3 h-3 shrink-0" />
          <span className="truncate">
            {acceptedByMe
              ? t("oc_acceptedByYou")
              : t("oc_acceptedBy", { name: order.acceptedByName })}
          </span>
          {order.acceptedAt && (
            <span className="ml-auto text-white/40 shrink-0">
              {order.acceptedAt}
            </span>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-white/70 truncate">
              <span className="font-mono text-white/40 mr-2">{item.qty}×</span>
              {item.name}
            </span>
            <span className="text-white/50 font-mono shrink-0">
              {formatPrice(item.qty * item.price)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          {plural(totalQty, "common_items_one", "common_items_other")}
        </span>
        <span className="font-serif italic text-base text-white tracking-tight">
          {formatPrice(order.total)}
        </span>
      </div>

      {(onAccept || onPaid) && (
        <div className="flex items-center gap-2">
          {order.status === "pending" && onAccept && !muted && (
            <Button
              type="button"
              size="sm"
              className="flex-1 font-bold"
              onClick={() => onAccept(order.id)}
            >
              <Sparkles className="w-3.5 h-3.5 text-black" />
              {t("oc_accept")}
            </Button>
          )}
          {order.status === "accepted" && onPaid && acceptedByMe && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => onPaid(order.id)}
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              {t("oc_markPaid")}
            </Button>
          )}
          {order.status === "accepted" && onPaid && !acceptedByMe && (
            <span className="flex-1 text-center text-[11px] font-mono text-white/40 uppercase tracking-wider py-2">
              {t("oc_claimedByOther")}
            </span>
          )}
          {order.status === "paid" && (
            <span className="flex-1 text-center text-[11px] font-mono text-emerald-400/80 uppercase tracking-wider">
              {t("status_paid")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
