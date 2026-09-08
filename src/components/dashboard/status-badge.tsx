import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";

const STATUS_META: Record<OrderStatus, { labelKey: string; className: string; dot: string }> = {
  pending: {
    labelKey: "status_pending",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-400",
  },
  accepted: {
    labelKey: "status_accepted",
    className: "bg-white/5 text-white/70 border-white/10",
    dot: "bg-white/60",
  },
  paid: {
    labelKey: "status_paid",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-400",
  },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
        meta.className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot, status === "pending" && "animate-pulse")} />
      {t(meta.labelKey)}
    </span>
  );
}