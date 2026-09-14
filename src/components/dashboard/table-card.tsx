import { Download } from "lucide-react";
import { toast } from "sonner";
import type { MenuTable } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import { downloadQrPng } from "@/lib/qr";
import { QrImage } from "@/components/qr-image";

interface TableCardProps {
  table: MenuTable;
  menuUrl: string;
  restaurantName: string;
  brandColor: string;
  /** A QR code for a restaurant that was never saved points at nothing. */
  disabled?: boolean;
}

export function TableCard({
  table,
  menuUrl,
  restaurantName,
  brandColor,
  disabled = false,
}: TableCardProps) {
  const { t } = useI18n();

  const handleDownload = async () => {
    try {
      await downloadQrPng(menuUrl, `${restaurantName}-table-${table.number}.png`);
    } catch {
      toast.error(t("tb_qrFailed"));
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#0D0D0D] overflow-hidden animate-fade-up">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">{t("tb_tableLabel")}</span>
          <span className="font-mono font-bold text-white text-sm">
            {String(table.number).padStart(2, "0")}
          </span>
        </div>
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: brandColor }}
          title={t("tb_linked")}
        />
      </div>

      <div className="p-4 flex flex-col items-center gap-3">
        <div className="bg-white rounded-lg p-2 shadow-sm">
          <QrImage value={menuUrl} size={132} alt={`${restaurantName} — Table ${table.number} QR`} />
        </div>
        <div className="w-full">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/40 text-center mb-1">
            {t("tb_menuUrl")}
          </p>
          <p className="text-[11px] font-mono text-white/60 truncate text-center" title={menuUrl}>
            {menuUrl}
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={handleDownload}
          disabled={disabled}
          className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full text-xs font-semibold text-white/70 border border-white/10 bg-transparent hover:bg-white/5 hover:text-white hover:border-white/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-white/70"
        >
          <Download className="w-3.5 h-3.5" />
          {t("tb_downloadQr")}
        </button>
      </div>
    </div>
  );
}
