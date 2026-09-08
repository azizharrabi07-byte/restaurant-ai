import { StatusBadge } from "@/components/dashboard/status-badge";
import { ArrowRight } from "lucide-react";

export function OrderStatusPill({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="hidden sm:flex items-center gap-1.5">
        <StatusBadge status="pending" />
        <ArrowRight className="w-3 h-3 text-white/30" />
        <StatusBadge status="accepted" />
        <ArrowRight className="w-3 h-3 text-white/30" />
        <StatusBadge status="paid" />
      </div>
    </div>
  );
}