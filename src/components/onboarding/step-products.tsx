"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, UtensilsCrossed, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImageDropzone } from "@/components/image-dropzone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { type Product } from "@/lib/constants";
import { StepHeading } from "@/components/onboarding/step-heading";
import { MenuScanButton } from "@/components/onboarding/menu-scan-dialog";

interface ProductFormProps {
  initial?: Product;
  onSubmit: (data: Omit<Product, "id">) => void;
  onCancel: () => void;
}

function ProductForm({ initial, onSubmit, onCancel }: ProductFormProps) {
  const { categories } = useOnboarding();
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial?.price?.toString() ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [available, setAvailable] = useState(initial?.isAvailable ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(price);
    if (!name.trim() || isNaN(parsed) || parsed < 0 || !categoryId) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      price: parsed,
      categoryId,
      image,
      isAvailable: available,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
          {t("spl_nameLabel")}
        </label>
        <Input
          placeholder={t("spl_namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
          {t("spl_descLabel")}
        </label>
        <Textarea
          placeholder={t("spl_descPh")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
          {t("spl_priceLabel")}
        </label>
        <Input
          type="number"
          step="0.001"
          min="0"
          placeholder={t("spl_pricePh")}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      {categories.length > 0 && (
        <div>
          <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
            {t("spl_categoryLabel")}
          </label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder={t("spl_categoryPh")} />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <div>
          <p className="text-xs font-medium text-white">{t("spl_availTitle")}</p>
          <p className="text-[11px] text-white/40">
            {available ? t("spl_availOn") : t("spl_availOff")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAvailable((a) => !a)}
          className={cn(
            "flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono px-3 py-1.5 rounded-full border transition-all cursor-pointer",
            available
              ? "text-white bg-white/10 border-white/20"
              : "text-white/40 bg-transparent border-white/10",
          )}
        >
          {available ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {available ? t("spl_available") : t("spl_hidden")}
        </button>
      </div>

      <ImageDropzone
        value={image}
        onChange={setImage}
        shape="wide"
        label={t("spl_imageLabel")}
      />

      <DialogFooter className="gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("spl_cancel")}
        </Button>
        <Button type="submit" disabled={!name.trim() || !price || !categoryId}>
          {initial ? t("spl_save") : t("spl_add")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function StepProducts({ headingEyebrow }: { headingEyebrow?: string }) {
  const { categories, products, addProduct, updateProduct, removeProduct } = useOnboarding();
  const { t, formatPrice } = useI18n();

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const filtered = activeCategoryId
    ? products.filter((p) => p.categoryId === activeCategoryId)
    : products;

  const getCategoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? t("spl_menuFallback");

  return (
    <div className="max-w-2xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow={headingEyebrow ?? "Step 04 · Products"}
        title={t("sp_title")}
        description={t("sp_desc")}
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <MenuScanButton />
          <Button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={categories.length === 0}
            className="shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t("sp_add")}
          </Button>
        </div>
      </StepHeading>

      {categories.length === 0 ? (
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-8 text-center">
          <UtensilsCrossed className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <h3 className="text-lg font-serif italic text-white">{t("sp_noCatTitle")}</h3>
          <p className="text-xs text-white/40 max-w-sm mx-auto mt-1">
            {t("sp_noCatDesc")}
          </p>
        </div>
      ) : (
        <>
          {/* Category filter tabs */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-4 -mx-4 px-4">
            <button
              type="button"
              onClick={() => setActiveCategoryId(null)}
              className={cn(
                "text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                activeCategoryId === null
                  ? "text-white shadow-xs"
                  : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
              )}
              style={activeCategoryId === null ? { backgroundColor: "rgba(255,255,255,0.9)" } : {}}
            >
              {t("sp_all", { n: products.length })}
            </button>
            {categories.map((c) => {
              const count = products.filter((p) => p.categoryId === c.id).length;
              const isActive = activeCategoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategoryId(c.id)}
                  className={cn(
                    "text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer",
                    isActive
                      ? "text-white shadow-xs"
                      : "bg-[#141414] border border-white/10 text-white/50 hover:text-white",
                  )}
                  style={isActive ? { backgroundColor: "rgba(255,255,255,0.9)" } : {}}
                >
                  {c.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Product grid */}
          {filtered.length === 0 ? (
            <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-8 text-center">
              <UtensilsCrossed className="w-10 h-10 text-white/20 mx-auto mb-3" />
              <h3 className="text-lg font-serif italic text-white">{t("sp_noProductsTitle")}</h3>
              <p className="text-xs text-white/40 max-w-sm mx-auto mt-1 mb-5">
                {t("sp_noProductsDesc")}
              </p>
              <Button type="button" onClick={() => setShowAdd(true)}>
                <Plus className="w-4 h-4" />
                {t("sp_addFirst")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="group p-2.5 rounded-xl bg-[#0E0E0E] border border-white/10 hover:border-white/20 transition-all flex gap-3"
                >
                  {p.image ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#161616] shrink-0 border border-white/10">
                      <img
                        src={p.image}
                        alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#161616] shrink-0 border border-white/10 flex items-center justify-center">
                      <UtensilsCrossed className="w-5 h-5 text-white/20" />
                    </div>
                  )}

                  <div className="flex-1 flex-col flex justify-between min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-xs font-medium text-white truncate">{p.name}</h4>
                        {!p.isAvailable && (
                          <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                            {t("sp_hidden")}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[11px] text-white/40 truncate mt-0.5">{p.description}</p>
                      )}
                      <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/10 inline-block mt-1">
                        {getCategoryName(p.categoryId)}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-white font-bold">{formatPrice(p.price)}</span>
                  </div>

                  <div className="flex flex-col justify-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditId(p.id)}
                      className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-full transition-colors cursor-pointer"
                      title={t("sp_editTitle")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(p.id)}
                      className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors cursor-pointer"
                      title={t("sp_deleteTitle")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Product Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("spp_dlgAdd")}</DialogTitle>
            <DialogDescription>
              {t("spp_dlgAddDesc")}
            </DialogDescription>
          </DialogHeader>
          <ProductForm
            onSubmit={(data) => {
              addProduct(data);
              setShowAdd(false);
            }}
            onCancel={() => setShowAdd(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("spp_dlgEdit")}</DialogTitle>
            <DialogDescription>{t("spp_dlgEditDesc")}</DialogDescription>
          </DialogHeader>
          {editId && (
            <ProductForm
              initial={products.find((p) => p.id === editId)}
              onSubmit={(data) => {
                updateProduct(editId, data);
                setEditId(null);
              }}
              onCancel={() => setEditId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("spp_dlgDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("spp_dlgDeleteDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              {t("spl_cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) removeProduct(deleteId);
                setDeleteId(null);
              }}
            >
              {t("spp_delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}