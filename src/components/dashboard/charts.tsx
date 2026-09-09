"use client";

import { hexToRgba } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface ChartPoint {
  hour: string;
  value: number;
}

interface ChartProps {
  data: ChartPoint[];
  label: (value: number) => string;
  color: string;
}

function BarChart({ data, label, color }: ChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5">
        {data.map((point, i) => (
          <div key={`${point.hour}-${i}`} className="flex-1 h-full flex items-end group">
            <div
              className="w-full rounded-t-md transition-all duration-300 ease-out group-hover:opacity-80"
              style={{
                height: `${Math.max((point.value / max) * 100, 4)}%`,
                background: `linear-gradient(to top, ${hexToRgba(color, 0.25)}, ${color})`,
              }}
              title={`${point.hour}:00 — ${label(point.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-1.5 border-t border-white/5 pt-2">
        {data.map((point, i) => (
          <div key={`${point.hour}-label`} className="flex-1 text-center">
            <span className="text-[9px] font-mono text-white/35">
              {data.length > 9 && i % 2 === 1 ? "" : point.hour}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevenueChart({
  data,
  brandColor,
}: {
  data: ChartPoint[];
  brandColor: string;
}) {
  const { formatPrice } = useI18n();
  return (
    <BarChart
      data={data}
      color={brandColor}
      label={(v) => formatPrice(v)}
    />
  );
}

export function OrdersByHourChart({ data }: { data: ChartPoint[] }) {
  const { t } = useI18n();
  return <BarChart data={data} color="#9CA3AF" label={(v) => `${v} ${v === 1 ? t("ov_orderOne") : t("ov_orders")}`} />;
}