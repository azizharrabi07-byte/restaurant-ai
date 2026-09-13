"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { slugify, cn } from "@/lib/utils";
import type { Product } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Line {
  id: string;
  productId?: string;
  name: string;
  price: number;
  qty: number;
}

interface WorkerNewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const lineId = () => Math.random().toString(36).slice(2);

export function WorkerNewOrderDialog({
  open,
  onOpenChange,
}: WorkerNewOrderDialogProps) {
  const { tables, products, restaurantName } = useOnboarding();
  const { t, formatPrice } = useI18n();
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const venueName = restaurantName || "";
  const slug = slugify(venueName);
  const sortedTables = [...tables].sort((a, b) => a.number - b.number);
  const availableProducts = products.filter((p) => p.isAvailable !== false);

  const addProduct = (p: Product) => {
    setLines((prev) => {
      const hit = prev.find((l) => l.productId === p.id);
      if (hit)
        return prev.map((l) =>
          l.id === hit.id ? { ...l, qty: l.qty + 1 } : l,
        );
      return [
        ...prev,
        { id: lineId(), productId: p.id, name: p.name, price: p.price, qty: 1 },
      ];
    });
  };

  const setLineQty = (id: string, qty: number) => {
    if (qty <= 0) {
      setLines((prev) => prev.filter((l) => l.id !== id));
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty } : l)));
  };

  const addCustom = () => {
    const price = parseFloat(customPrice);
    if (!customName.trim() || Number.isNaN(price) || price <= 0) {
      toast.error(t("wo_badCustom"));
      return;
    }
    setLines((prev) => [
      ...prev,
      { id: lineId(), name: customName.trim(), price, qty: 1 },
    ]);
    setCustomName("");
    setCustomPrice("");
  };

  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

  const place = async () => {
    if (tableNumber == null) {
      toast.error(t("wo_selectTable"));
      return;
    }
    if (lines.length === 0) {
      toast.error(t("wo_needItems"));
      return;
    }
    if (!slug) {
      toast.error(t("wo_noVenue"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          tableNumber,
          items: lines.map((l) =>
            l.productId
              ? { productId: l.productId, qty: l.qty }
              : { name: l.name, price: l.price, qty: l.qty },
          ),
        }),
      });
      const data = (await res.json()) as { cloud?: boolean; order?: { number?: number } };
      if (!res.ok || !data.cloud || !data.order) {
        toast.error(t("wo_failed"));
        return;
      }
      toast.success(t("wo_submitted", { n: String(data.order.number) }), {
        description: t("wo_submittedDesc"),
      });
      setLines([]);
      setTableNumber(null);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wo_title")}</DialogTitle>
          <DialogDescription>{t("wo_subtitle")}</DialogDescription>
        </DialogHeader>

        {/* Table */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-mono mb-2">
            {t("wo_table")}
          </p>
          {sortedTables.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-[#111111] px-4 py-6 text-center text-xs text-white/40">
              {t("wo_noTables")}
              <span className="block mt-1 text-white/30">{t("wo_noTablesSub")}</span>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sortedTables.map((tb) => {
                const selected = tableNumber === tb.number;
                return (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setTableNumber(tb.number)}
                    className={cn(
                      "h-11 px-4 rounded-xl border text-sm font-mono font-bold transition-colors cursor-pointer",
                      selected
                        ? "bg-white text-black border-white"
                        : "bg-[#111111] text-white/60 border-white/10 hover:border-white/30 hover:text-white",
                    )}
                  >
                    {String(tb.number).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Products */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-mono mb-2">
            {t("wo_menuItems")}
          </p>
          {availableProducts.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-[#111111] px-4 py-6 text-center text-xs text-white/40">
              {t("wo_noProducts")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className="flex items-center gap-2 h-10 px-3.5 rounded-xl border border-white/10 bg-[#111111] text-left text-xs text-white/80 hover:border-emerald-400/40 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="max-w-[190px] truncate">{p.name}</span>
                  <span className="text-white/40 font-mono shrink-0">{formatPrice(p.price)}</span>
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
              {t("wo_lines")}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("wo_customName")}
                className="h-8 w-40 text-xs"
              />
              <Input
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder={t("wo_customPrice")}
                inputMode="decimal"
                className="h-8 w-20 text-xs"
              />
              <Button type="button" size="sm" variant="secondary" onClick={addCustom}>
                <Plus className="w-3.5 h-3.5" />
                {t("wo_add")}
              </Button>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center text-xs text-white/30">
              {t("wo_emptyLines")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-3 rounded-lg bg-[#111111] border border-white/10 px-3 py-2 text-xs"
                >
                  <span className="flex-1 min-w-0 truncate text-white/80">{l.name}</span>
                  <span className="text-white/40 font-mono">{formatPrice(l.price)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setLineQty(l.id, l.qty - 1)}
                      className="w-6 h-6 rounded-md border border-white/10 text-white/50 hover:text-white hover:border-white/30 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono text-white">{l.qty}</span>
                    <button
                      type="button"
                      onClick={() => setLineQty(l.id, l.qty + 1)}
                      className="w-6 h-6 rounded-md border border-white/10 text-white/50 hover:text-white hover:border-white/30 flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="text-white font-mono font-bold w-16 text-right">
                    {formatPrice(l.price * l.qty)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
                    className="text-red-400/60 hover:text-red-400 cursor-pointer"
                    aria-label={t("wo_removeLine")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 text-sm">
            <UtensilsCrossed className="w-4 h-4 text-white/40" />
            <span className="text-white/40 font-mono text-xs">{t("wo_total")}</span>
            <span className="text-white font-serif italic text-lg">{formatPrice(total)}</span>
          </div>
          <Button
            type="button"
            size="lg"
            disabled={submitting || sortedTables.length === 0}
            onClick={place}
          >
            {submitting ? t("wo_submitting") : t("wo_submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}