"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { type Product } from "@/lib/constants";
import { formatDT } from "@/lib/format";
import { StepHeading } from "@/components/onboarding/step-heading";

interface ProductFormProps {
  initial?: Product;
  onSubmit: (data: Omit<Product, "id">) => void;
  onCancel: () => void;
}

function ProductForm({ initial, onSubmit, onCancel }: ProductFormProps) {
  const { categories } = useOnboarding();
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial?.price?.toString() ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(price);
    if (!name.trim() || isNaN(parsed) || parsed < 0 || !categoryId) return;
    onSubmit({ name: name.trim(), price: parsed, categoryId, image });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
          Product Name *
        </label>
        <Input
          placeholder="e.g. Double Burger, Mint Tea..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
          Price (DT) *
        </label>
        <Input
          type="number"
          step="0.001"
          min="0"
          placeholder="0.000"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      {categories.length > 0 && (
        <div>
          <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
            Category
          </label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a category" />
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

      <ImageDropzone
        value={image}
        onChange={setImage}
        shape="wide"
        label="Product Image (optional)"
      />

      <DialogFooter className="gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || !price || !categoryId}>
          {initial ? "Save Changes" : "Add Product"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function StepProducts() {
  const { categories, products, addProduct, updateProduct, removeProduct } = useOnboarding();

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const filtered = activeCategoryId
    ? products.filter((p) => p.categoryId === activeCategoryId)
    : products;

  const getCategoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Menu";

  return (
    <div className="max-w-2xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow="Step 04 · Products"
        title="Add your signature dishes"
        description="Add your dishes, drinks, or services with their prices in Tunisian Dinars."
      >
        <Button
          type="button"
          onClick={() => setShowAdd(true)}
          disabled={categories.length === 0}
          className="shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </Button>
      </StepHeading>

      {categories.length === 0 ? (
        <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-8 text-center">
          <UtensilsCrossed className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <h3 className="text-lg font-serif italic text-white">Create categories first</h3>
          <p className="text-xs text-white/40 max-w-sm mx-auto mt-1">
            Head back to Step 3 to set up menu sections, then add dishes here.
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
              All ({products.length})
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
              <h3 className="text-lg font-serif italic text-white">No products yet</h3>
              <p className="text-xs text-white/40 max-w-sm mx-auto mt-1 mb-5">
                Add dishes, drinks, or services so customers can order from their phone.
              </p>
              <Button type="button" onClick={() => setShowAdd(true)}>
                <Plus className="w-4 h-4" />
                Add Your First Product
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
                      <h4 className="text-xs font-medium text-white truncate">{p.name}</h4>
                      <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/10 inline-block mt-1">
                        {getCategoryName(p.categoryId)}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-white font-bold">{formatDT(p.price)}</span>
                  </div>

                  <div className="flex flex-col justify-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditId(p.id)}
                      className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-full transition-colors cursor-pointer"
                      title="Edit Product"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(p.id)}
                      className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors cursor-pointer"
                      title="Delete Product"
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
            <DialogTitle>Add Product</DialogTitle>
            <DialogDescription>
              Fill in the details below. Prices are stored as Tunisian Dinars (DT).
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
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update the product details below.</DialogDescription>
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
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this product? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) removeProduct(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}