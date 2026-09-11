"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Minus, UtensilsCrossed, ChefHat } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useOrders } from "@/lib/use-orders";
import { useI18n } from "@/lib/i18n";
import { QrImage } from "@/components/qr-image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewOrderDialog({ open, onOpenChange }: NewOrderDialogProps) {
  const { tables, products, categories, brandColor } = useOnboarding();
  const { createOrder } = useOrders();
  const { t, formatPrice, plural } = useI18n();

  const [tableId, setTableId] = useState<string>("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [categoryId, setCategoryId] = useState<string>("all");

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const visibleProducts = useMemo(() => {
    if (!products) return [];
    return products.filter(
      (p) =>
        p.isAvailable &&
        (categoryId === "all" || p.categoryId === categoryId),
    );
  }, [products, categoryId]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => {
          const p = products.find((pr) => pr.id === id);
          return p ? { product: p, qty } : null;
        })
        .filter((x): x is { product: (typeof products)[number]; qty: number } => x !== null),
    [cart, products],
  );

  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);

  const bump = (id: string, delta: number) => {
    setCart((c) => {
      const next = { ...c };
      const qty = (next[id] ?? 0) + delta;
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };

  const reset = () => {
    setTableId("");
    setCart({});
    setCategoryId("all");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    if (!tableId || cartItems.length === 0) return;
    setSubmitting(true);
    try {
      const res = await createOrder({
        tableId,
        items: cartItems.map((i) => ({
          productId: i.product.id,
          name: i.product.name,
          price: i.product.price,
          qty: i.qty,
        })),
      });
      if (res.ok) {
        const table = tables.find((t) => t.id === tableId);
        const itemsLabel = cartItems
          .map((i) => `${i.qty}× ${i.product.name}`)
          .join(", ");
        onOpenChange(false);
        reset();
        if (table) {
          toast.success(t("wo_sentToast"), {
            description: t("wo_sentToastDesc", {
              t: String(table.number).padStart(2, "0"),
              items: itemsLabel,
            }),
          });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = tableId && cartCount > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif italic text-white flex items-center gap-2">
            <ChefHat
              className="w-5 h-5"
              style={{ color: brandColor.value }}
            />
            {t("wo_newOrder")}
          </DialogTitle>
          <DialogDescription>{t("wo_tableHint")}</DialogDescription>
        </DialogHeader>

        {/* Table selector */}
        <div className="rounded-lg border border-white/10 bg-[#111111] p-3">
          <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1.5">
            {t("wo_selectTable")}
          </label>
          {tables.length === 0 ? (
            <p className="text-xs text-white/40 py-2">{t("wo_noTables")}</p>
          ) : (
            <Select value={tableId} onValueChange={setTableId}>
              <SelectTrigger>
                <SelectValue placeholder={t("wo_selectTablePh")} />
              </SelectTrigger>
              <SelectContent>
                {tables
                  .slice()
                  .sort((a, b) => a.number - b.number)
                  .map((tb) => (
                    <SelectItem key={tb.id} value={tb.id}>
                      {t("oc_table")} {String(tb.number).padStart(2, "0")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Category filter */}
        {products.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
            <button
              type="button"
              onClick={() => setCategoryId("all")}
              className={`text-xs px-3 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                categoryId === "all"
                  ? "bg-white text-black font-bold"
                  : "border border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {t("common_all")}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`text-xs px-3 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                  categoryId === c.id
                    ? "bg-white text-black font-bold"
                    : "border border-white/10 text-white/50 hover:text-white"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Products list */}
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {products.length === 0 ? (
            <div className="py-10 text-center">
              <UtensilsCrossed className="w-6 h-6 text-white/20 mx-auto mb-2" />
              <p className="text-xs text-white/40">{t("wo_noProducts")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleProducts.map((p) => {
                const qty = cart[p.id] ?? 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0D0D0D] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-white/40 font-mono mt-0.5">
                        {catMap.get(p.categoryId)} · {formatPrice(p.price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {qty > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => bump(p.id, -1)}
                            className="w-7 h-7 rounded-full border border-white/10 text-white/60 hover:text-white flex items-center justify-center cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-4 text-center font-mono text-sm text-white">
                            {qty}
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => bump(p.id, 1)}
                        className="w-7 h-7 rounded-full text-white flex items-center justify-center cursor-pointer"
                        style={{ backgroundColor: brandColor.value }}
                      >
                        <Plus className="w-3.5 h-3.5 text-black" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with total + send */}
        <div className="border-t border-white/10 pt-3 -mx-1 px-1">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
              {plural(cartCount, "common_items_one", "common_items_other")}
            </span>
            <span className="font-serif italic text-base text-white tracking-tight">
              {formatPrice(cartTotal)}
            </span>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
            >
              {t("wo_cancel")}
            </Button>
            <Button
              type="button"
              className="font-bold"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              <ChefHat className="w-3.5 h-3.5 text-black" />
              {t("wo_send")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
