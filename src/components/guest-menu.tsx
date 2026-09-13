"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Minus,
  UtensilsCrossed,
  ShoppingBag,
  ArrowLeft,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { LangCurSwitcher } from "@/components/lang-cur-switcher";
import type { Category, MenuTheme, Product } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface GuestMenuProps {
  restaurant?: {
    name: string;
    tagline: string;
    logo: string | null;
    cover: string | null;
    brandColor: { value: string };
    slug: string;
  };
  theme?: MenuTheme;
  categories?: Category[];
  products?: Product[];
  tableNumber?: number;
  unavailable?: boolean;
}

interface ConfirmState {
  number: number;
  total: number;
}

export function GuestMenu({
  restaurant,
  theme = "classic",
  categories,
  products,
  tableNumber,
  unavailable,
}: GuestMenuProps) {
  const [catId, setCatId] = useState("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const { t, plural, formatPrice } = useI18n();

  const accent = restaurant?.brandColor.value ?? "#D97706";
  const variant =
    theme === "minimal" || theme === "vibrant" || theme === "gallery"
      ? theme
      : "classic";
  const cats = useMemo(() => categories ?? [], [categories]);
  const prods = useMemo(() => products ?? [], [products]);
  const tableNo = tableNumber ?? 0;
  const r = restaurant ?? {
    name: "",
    tagline: "",
    logo: null,
    cover: null,
    brandColor: { value: "#D97706" },
    slug: "",
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prods.filter(
      (p) =>
        (catId === "all" || p.categoryId === catId) &&
        (!q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)),
    );
  }, [prods, catId, query]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => {
          const p = prods.find((pr) => pr.id === id);
          return p ? { product: p, qty } : null;
        })
        .filter((x): x is { product: Product; qty: number } => x !== null),
    [cart, prods],
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

  const submitOrder = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: r.slug,
          tableToken: window.location.pathname.split("/").pop() ?? "",
          clientRef: crypto.randomUUID(),
          items: cartItems.map((i) => ({
            productId: i.product.id,
            qty: i.qty,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.cloud) {
        setConfirm({ number: data.order.number, total: data.order.total });
        setCart({});
        setCartOpen(false);
      } else {
        toast.error(
          typeof data.message === "string" && data.message
            ? data.message
            : t("g_counterError"),
        );
      }
    } catch {
      toast.error(t("g_networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (unavailable) {
    return (
      <div className="min-h-dvh bg-[#050505] text-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <UtensilsCrossed className="w-10 h-10 text-white/20 mx-auto mb-4" />
          <h1 className="font-serif italic text-2xl">{t("g_notliveTitle")}</h1>
          <p className="text-sm text-white/40 mt-2 leading-relaxed">
            {t("g_notliveDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#050505] text-white pb-28">
      {/* Cover banner */}
      <div
        className={cn(
          "relative overflow-hidden bg-[#111]",
          variant === "minimal" ? "h-24" : "h-44",
          variant === "vibrant" && "h-52",
        )}
      >
        {r.cover ? (
          <img
            src={r.cover}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-full h-full opacity-70"
            style={{ background: `linear-gradient(135deg, ${accent} 0%, #050505 100%)` }}
          />
        )}
        <div
          className={cn(
            "absolute inset-0",
            variant === "minimal"
              ? "bg-[#050505]/55"
              : "bg-gradient-to-t from-[#050505] via-[#050505]/40 to-transparent",
          )}
        />
        <div className="absolute top-3 left-0 right-0 flex items-center justify-between px-4">
          <span className="bg-black/70 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 text-[11px] font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("g_dinein", { t: String(tableNo).padStart(2, "0") })}
          </span>
          <LangCurSwitcher />
        </div>
      </div>

      {/* Header */}
      {variant === "minimal" ? (
        <div className="px-4 -mt-6 relative z-10 text-center">
          <div className="flex flex-col items-center">
            <div
              className="w-16 h-16 rounded-2xl bg-[#050505] p-1 shadow-xl border-2 overflow-hidden flex items-center justify-center shrink-0"
              style={{ borderColor: accent }}
            >
              {r.logo ? (
                <img
                  src={r.logo}
                  alt={r.name}
                  className="w-full h-full object-cover rounded-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="w-full h-full rounded-xl flex items-center justify-center text-white font-serif italic text-2xl font-bold"
                  style={{ backgroundColor: accent }}
                >
                  {r.name.charAt(0)}
                </div>
              )}
            </div>
            <h1 className="text-2xl font-medium tracking-tight mt-3">{r.name}</h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 mt-1">
              {t("g_open")}
            </span>
          </div>
          {r.tagline && (
            <p className="text-sm text-white/40 mt-2 leading-relaxed">{r.tagline}</p>
          )}
        </div>
      ) : (
        <div className="px-4 -mt-12 relative z-10">
          <div className="flex items-end gap-4">
            <div
              className="w-20 h-20 rounded-2xl bg-[#050505] p-1 shadow-xl border-2 overflow-hidden flex items-center justify-center shrink-0"
              style={{ borderColor: accent }}
            >
              {r.logo ? (
                <img
                  src={r.logo}
                  alt={r.name}
                  className="w-full h-full object-cover rounded-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="w-full h-full rounded-xl flex items-center justify-center text-white font-serif italic text-3xl font-bold"
                  style={{ backgroundColor: accent }}
                >
                  {r.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="pb-1 min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                {t("g_open")}
              </span>
              <h1
                className={cn(
                  variant === "vibrant"
                    ? "text-3xl font-serif italic leading-tight mt-0.5"
                    : "text-2xl font-serif italic leading-tight mt-0.5",
                )}
              >
                {r.name}
              </h1>
              {variant === "vibrant" && (
                <div
                  className="w-10 h-[3px] rounded-full mt-1.5"
                  style={{ backgroundColor: accent }}
                />
              )}
            </div>
          </div>
          {r.tagline && (
            <p className="text-sm text-white/40 mt-2 leading-relaxed">{r.tagline}</p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-4 mt-5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder={t("g_search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(
              "w-full bg-[#0D0D0D] text-sm text-white placeholder:text-white/30 pl-10 pr-4 py-2.5",
              variant === "minimal"
                ? "rounded-t-none border-b border-white/15 focus:border-b-white/40 outline-none"
                : "rounded-xl border border-white/10 focus:outline-none focus:border-white/30",
            )}
          />
        </div>
      </div>

      {/* Category pills */}
      <div className={cn("mt-4 flex gap-1.5 overflow-x-auto no-scrollbar px-4", variant === "minimal" && "gap-0")}>
        <button
          type="button"
          onClick={() => setCatId("all")}
          className={cn(
            "text-xs px-3.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
            variant === "minimal"
              ? catId === "all"
                ? "rounded-none border-b-2 px-2 text-white"
                : "rounded-none px-2 text-white/40"
              : catId === "all"
                ? "text-white shadow"
                : "bg-[#0D0D0D] border border-white/10 text-white/50",
            variant === "vibrant" && catId === "all" && "shadow-lg",
          )}
          style={
            catId === "all"
              ? variant === "minimal"
                ? { borderColor: accent }
                : { backgroundColor: accent }
              : undefined
          }
        >
          {t("g_all", { n: prods.length })}
        </button>
        {cats.map((c) => {
          const count = prods.filter((p) => p.categoryId === c.id).length;
          const active = catId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatId(c.id)}
              className={cn(
                "text-xs px-3.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                variant === "minimal"
                  ? active
                    ? "rounded-none border-b-2 px-2 text-white"
                    : "rounded-none px-2 text-white/40"
                  : active
                    ? "text-white shadow"
                    : "bg-[#0D0D0D] border border-white/10 text-white/50",
                variant === "vibrant" && active && "shadow-lg",
              )}
              style={
                active
                  ? variant === "minimal"
                    ? { borderColor: accent }
                    : { backgroundColor: accent }
                  : undefined
              }
            >
              {c.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Products */}
      <div className="px-4 mt-4 space-y-2.5">
        {cats
          .filter((c) => catId === "all" || c.id === catId)
          .map((c) => {
            const items = filtered.filter((p) => p.categoryId === c.id);
            if (items.length === 0) return null;
            return (
              <div key={c.id}>
                {catId === "all" && (
                  <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40 px-1 pt-3 pb-2">
                    {c.name}
                  </h2>
                )}
                <div className="space-y-2.5">
                  {items.map((p) => {
                    const qty = cart[p.id] ?? 0;
                    const stacked = variant === "vibrant" || variant === "gallery";
                    const minimal = variant === "minimal";

                    const addBtn = minimal ? (
                      <button
                        type="button"
                        onClick={() => bump(p.id, 1)}
                        className="text-xs font-semibold flex items-center gap-0.5 cursor-pointer transition-colors hover:opacity-80"
                        style={{ color: accent }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t("g_add")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => bump(p.id, 1)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-semibold text-white shadow cursor-pointer"
                        style={{ backgroundColor: accent }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t("g_add")}
                      </button>
                    );

                    const stepper = (
                      <div
                        className="flex items-center gap-2.5 px-2 py-1 rounded-full shadow"
                        style={{ backgroundColor: accent }}
                      >
                        <button
                          type="button"
                          onClick={() => bump(p.id, -1)}
                          className="p-0.5 text-white/70 hover:text-white cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-mono font-bold w-3 text-center">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => bump(p.id, 1)}
                          className="p-0.5 text-white/70 hover:text-white cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );

                    const qtyControl = qty === 0 ? addBtn : stepper;

                    if (minimal) {
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 px-1 py-3 border-b border-white/10"
                        >
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium leading-snug">{p.name}</h3>
                            {p.description && (
                              <p className="text-xs text-white/35 mt-0.5 line-clamp-1 leading-relaxed">
                                {p.description}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className="text-sm font-mono font-bold text-white/80">
                              {formatPrice(p.price)}
                            </span>
                            {qtyControl}
                          </div>
                        </div>
                      );
                    }

                    if (stacked) {
                      return (
                        <div
                          key={p.id}
                          className="rounded-xl bg-[#0D0D0D] overflow-hidden"
                          style={
                            variant === "vibrant"
                              ? {
                                  border: `3px solid ${accent}`,
                                  borderTopColor: accent,
                                }
                              : { border: "1px solid rgba(255,255,255,0.1)" }
                          }
                        >
                          <div
                            className={cn(
                              "w-full bg-[#161616]",
                              variant === "gallery" ? "aspect-[4/3]" : "h-28",
                            )}
                          >
                            {p.image ? (
                              <img
                                src={p.image}
                                alt={p.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <UtensilsCrossed className="w-6 h-6 text-white/20" />
                              </div>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-[15px] font-semibold leading-snug">
                                {p.name}
                              </h3>
                              <span className="text-sm font-mono font-bold shrink-0">
                                {formatPrice(p.price)}
                              </span>
                            </div>
                            {p.description && (
                              <p className="text-xs text-white/40 mt-1 line-clamp-2 leading-relaxed">
                                {p.description}
                              </p>
                            )}
                            <div className="flex items-center justify-end mt-2.5">
                              {qtyControl}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={p.id}
                        className="p-3 rounded-xl bg-[#0D0D0D] border border-white/10 flex gap-3"
                      >
                        {p.image ? (
                          <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border border-white/10">
                            <img
                              src={p.image}
                              alt={p.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#161616] shrink-0 border border-white/10 flex items-center justify-center">
                            <UtensilsCrossed className="w-5 h-5 text-white/20" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <h3 className="text-sm font-medium leading-snug">{p.name}</h3>
                            {p.description && (
                              <p className="text-xs text-white/40 mt-0.5 line-clamp-2 leading-relaxed">
                                {p.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-sm font-mono font-bold">
                              {formatPrice(p.price)}
                            </span>
                            {qtyControl}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        {filtered.length === 0 && (
          <div className="py-12 text-center bg-[#0D0D0D] rounded-xl border border-dashed border-white/10">
            <UtensilsCrossed className="w-6 h-6 text-white/20 mx-auto mb-2" />
            <p className="text-xs font-medium text-white/40">{t("g_noItems")}</p>
          </div>
        )}
      </div>

      {/* Confirmation screen */}
      {confirm ? (
        <div className="fixed inset-0 z-50 bg-[#050505]/95 backdrop-blur flex items-center justify-center px-6">
          <div className="text-center max-w-sm w-full">
            <div
              className="w-16 h-16 rounded-full mx-auto flex items-center justify-center shadow-lg"
              style={{ backgroundColor: accent }}
            >
              <Check className="w-8 h-8 text-white" />
            </div>
            <h2 className="font-serif italic text-3xl mt-6">{t("g_confirmTitle", { n: confirm.number })}</h2>
            <p className="text-sm text-white/50 mt-3 leading-relaxed">
              {t("g_confirmBody", { total: formatPrice(confirm.total) })}
            </p>
            <Button
              type="button"
              className="mt-8 w-full font-bold"
              onClick={() => setConfirm(null)}
            >
              <ArrowLeft className="w-4 h-4 text-black" />
              {t("g_backMenu")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-4 inset-x-0 px-4 z-40">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-between bg-white text-black rounded-2xl px-5 py-3.5 shadow-2xl cursor-pointer"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingBag className="w-4 h-4" />
              {plural(cartCount, "common_items_one", "common_items_other")}
            </span>
            <span className="font-mono font-bold text-sm">{formatPrice(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Cart sheet */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("g_cartTitle")}</DialogTitle>
            <DialogDescription>
              {t("g_cartDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="divide-y divide-white/5">
            {cartItems.map(({ product, qty }) => (
              <div key={product.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{product.name}</p>
                  <p className="text-xs text-white/40 font-mono mt-0.5">
                    {formatPrice(product.price)} × {qty}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => bump(product.id, -1)}
                    className="w-7 h-7 rounded-full border border-white/10 text-white/60 hover:text-white flex items-center justify-center cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-4 text-center font-mono text-sm">{qty}</span>
                  <button
                    type="button"
                    onClick={() => bump(product.id, 1)}
                    className="w-7 h-7 rounded-full border border-white/10 text-white/60 hover:text-white flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 pb-1">
            <span className="text-sm text-white/50">{t("g_cartTotal")}</span>
            <span className="font-mono font-bold text-base">{formatPrice(cartTotal)}</span>
          </div>

          <Button
            type="button"
            className="w-full mt-3 font-bold"
            onClick={submitOrder}
            disabled={submitting || cartCount === 0}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 text-black animate-spin" />
            ) : (
              <Check className="w-4 h-4 text-black" />
            )}
            {t("g_cartSend")}
          </Button>
          <p className="text-[11px] text-white/40 text-center mt-2 leading-relaxed">
            {t("g_cartPaynote")}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}