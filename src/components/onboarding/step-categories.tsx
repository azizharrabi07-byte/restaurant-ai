"use client";

import { useState } from "react";
import {
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { type Category } from "@/lib/constants";
import { StepHeading } from "@/components/onboarding/step-heading";

const CAFE_PRESETS = ["pre_c1", "pre_c2", "pre_c3", "pre_c4"];

const BISTRO_PRESETS = ["pre_b1", "pre_b2", "pre_b3", "pre_b4"];

export function StepCategories({ headingEyebrow }: { headingEyebrow?: string }) {
  const { t } = useI18n();
  const {
    categories,
    products,
    addCategory,
    updateCategory,
    removeCategory,
    moveCategory,
  } = useOnboarding();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setModalOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setFormName(cat.name);
    setModalOpen(true);
  };

  const handleSave = () => {
    const trimmed = formName.trim();
    if (!trimmed) return;
    if (editing) {
      updateCategory(editing.id, trimmed);
    } else {
      addCategory(trimmed);
    }
    setModalOpen(false);
  };

  const loadPresets = (keys: string[]) => {
    keys.forEach((key) => {
      const name = t(key);
      const exists = categories.some(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (!exists) addCategory(name);
    });
  };

  return (
    <div className="max-w-2xl mx-auto text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
      <StepHeading
        eyebrow={headingEyebrow ?? "Step 03 · Categories"}
        title={t("ca_title")}
        description={t("ca_desc")}
      >
        <Button type="button" onClick={openCreate} className="shrink-0">
          <Plus className="w-4 h-4" />
          {t("ca_add")}
        </Button>
      </StepHeading>

      <div className="space-y-4">
        {categories.length === 0 ? (
          <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-8 text-center">
            <FolderTree className="w-10 h-10 text-white/20 mx-auto mb-3" />
            <h3 className="text-lg font-serif italic text-white">{t("ca_emptyTitle")}</h3>
            <p className="text-xs text-white/40 max-w-sm mx-auto mt-1 mb-5">
              {t("ca_emptyDesc")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button type="button" onClick={openCreate}>
                <Plus className="w-4 h-4" />
                {t("ca_createCustom")}
              </Button>
              <button
                type="button"
                onClick={() => loadPresets(CAFE_PRESETS)}
                className="text-xs text-white/60 hover:text-white px-3.5 py-2 rounded-full bg-[#111111] border border-white/10 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t("ca_loadCafe")}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-[#0D0D0D] border border-white/10 rounded-xl p-3 sm:p-4 divide-y divide-white/5">
            {categories.map((cat, index) => {
              const productCount = products.filter((p) => p.categoryId === cat.id).length;

              return (
                <div
                  key={cat.id}
                  className="py-3 px-3 flex items-center justify-between gap-3 group transition-colors hover:bg-white/[0.02] rounded-lg"
                >
                  {/* Reorder and Title */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex flex-col gap-0.5 text-white/30 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveCategory(cat.id, -1)}
                        className="hover:text-white disabled:opacity-20 p-0.5 transition-colors cursor-pointer"
                        title={t("ca_moveUp")}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === categories.length - 1}
                        onClick={() => moveCategory(cat.id, 1)}
                        className="hover:text-white disabled:opacity-20 p-0.5 transition-colors cursor-pointer"
                        title={t("ca_moveDown")}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-white truncate">{cat.name}</h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-white/60 border border-white/10">
                          {productCount} {productCount === 1 ? t("ca_itemOne") : t("ca_itemOther")}
                        </span>
                      </div>
                      <p className="text-xs text-white/40 truncate mt-0.5">
                        {productCount > 0
                          ? products.slice(0, 1).filter((p) => p.categoryId === cat.id)[0]?.name
                          : t("ca_noDishes")}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(cat)}
                      className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-full transition-colors cursor-pointer"
                      title={t("ca_editTitle")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(cat.id)}
                      className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors cursor-pointer"
                      title={t("ca_deleteTitle")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick presets helper */}
        {categories.length > 0 && (
          <div className="flex items-center justify-between px-2 pt-1 text-xs text-white/40">
            <span>{t("ca_needIdeas")}</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => loadPresets(CAFE_PRESETS)}
                className="text-[11px] uppercase tracking-wider text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                {t("ca_addCafe")}
              </button>
              <span className="text-white/20">·</span>
              <button
                type="button"
                onClick={() => loadPresets(BISTRO_PRESETS)}
                className="text-[11px] uppercase tracking-wider text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                {t("ca_addBistro")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Category Modal */}
      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("ca_dlgTitleEdit") : t("ca_dlgTitleNew")}</DialogTitle>
            <DialogDescription>
              {t("ca_dlgDesc")}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium block mb-1.5">
              {t("ca_nameLabel")}
            </label>
            <Input
              placeholder={t("ca_namePh")}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t("ca_cancel")}
            </Button>
            <Button type="submit" onClick={handleSave} disabled={!formName.trim()}>
              {editing ? t("ca_update") : t("ca_create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ca_delTitle")}</DialogTitle>
            <DialogDescription>
              {t("ca_delDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              {t("ca_cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) removeCategory(deleteId);
                setDeleteId(null);
              }}
            >
              {t("ca_delConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}