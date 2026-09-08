import type { Order } from "@/lib/constants";
import { formatDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";

interface OrderCardProps {
  order: Order;
  onAccept?: (id: string) => void;
  onPaid?: (id: string) => void;
  className?: string;
}

export function OrderCard({ order, onAccept, onPaid, className }: OrderCardProps) {
  const totalQty = order.items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-[#0D0D0D] p-4 sm:p-5 space-y-4 animate-fade-up",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-[#111111] min-w-[46px] px-2 py-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">Table</span>
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

      <div className="space-y-1.5">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-white/70 truncate">
              <span className="font-mono text-white/40 mr-2">{item.qty}×</span>
              {item.name}
            </span>
            <span className="text-white/50 font-mono shrink-0">
              {formatDT(item.qty * item.price)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
          {totalQty} {totalQty === 1 ? "item" : "items"}
        </span>
        <span className="font-serif italic text-base text-white tracking-tight">
          {formatDT(order.total)}
        </span>
      </div>

      {(onAccept || onPaid) && (
        <div className="flex items-center gap-2">
          {order.status === "pending" && onAccept && (
            <Button
              type="button"
              size="sm"
              className="flex-1 font-bold"
              onClick={() => onAccept(order.id)}
            >
              <Sparkles className="w-3.5 h-3.5 text-black" />
              Accept Order
            </Button>
          )}
          {order.status === "accepted" && onPaid && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => onPaid(order.id)}
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              Mark as Paid
            </Button>
          )}
          {order.status === "paid" && (
            <span className="flex-1 text-center text-[11px] font-mono text-emerald-400/80 uppercase tracking-wider">
              Completed
            </span>
          )}
        </div>
      )}
    </div>
  );
}