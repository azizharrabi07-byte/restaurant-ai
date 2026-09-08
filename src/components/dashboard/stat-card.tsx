import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  accent?: string;
  className?: string;
}

export function StatCard({ label, value, sub, icon: Icon, accent, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-[#0D0D0D] p-4 sm:p-5 relative overflow-hidden",
        className,
      )}
    >
      {accent && (
        <span
          className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-40"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
      )}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-mono font-medium">
            {label}
          </p>
          <p className="mt-2 text-2xl sm:text-[26px] leading-none font-serif italic text-white tracking-tight">
            {value}
          </p>
          {sub && <p className="mt-2 text-xs text-white/40">{sub}</p>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-lg border border-white/10 bg-[#111111] flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-white/70" />
          </div>
        )}
      </div>
    </div>
  );
}