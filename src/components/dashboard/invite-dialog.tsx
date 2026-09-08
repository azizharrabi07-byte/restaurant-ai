"use client";

import { useState } from "react";
import { Check, Copy, ShieldCheck, CreditCard } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { makeToken, appBaseUrl } from "@/lib/utils";
import type { WorkerRole } from "@/lib/constants";
import { QrImage } from "@/components/qr-image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ROLE_META: Record<WorkerRole, { icon: typeof ShieldCheck; hintKey: string }> = {
  Cashier: { icon: CreditCard, hintKey: "inv_roleCashierHint" },
  Manager: { icon: ShieldCheck, hintKey: "inv_roleManagerHint" },
};

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteDialog({ open, onOpenChange }: InviteDialogProps) {
  const { createInvite, restaurantName, brandColor } = useOnboarding();
  const { t } = useI18n();
  const [role, setRole] = useState<WorkerRole>("Cashier");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const displayName = restaurantName || "Velvet & Stone Coffee";
  const link = token
    ? `${appBaseUrl()}/worker/invite/${token}?role=${role}&r=${encodeURIComponent(
        displayName,
      )}&b=${encodeURIComponent(brandColor.value)}`
    : "";

  const handleGenerate = () => {
    const t = makeToken("invite");
    setToken(t);
    createInvite(role, t);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setToken(null);
      setRole("Cashier");
      setCopied(false);
    }
  };

  const RoleIcon = ROLE_META[role].icon;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {!token ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-serif italic text-white">
                {t("inv_dlgTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("inv_dlgDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111111] p-2">
                <RoleIcon className="w-4 h-4 text-white/50 shrink-0" />
                <Select value={role} onValueChange={(v) => setRole(v as WorkerRole)}>
                  <SelectTrigger className="border-transparent bg-transparent focus:border-transparent h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cashier">Cashier</SelectItem>
                    <SelectItem value="Manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] border border-white/10 p-3">
                <RoleIcon className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />
                <p className="text-xs text-white/40 leading-relaxed">{t(ROLE_META[role].hintKey)}</p>
              </div>

              <Button type="button" className="w-full font-bold" onClick={handleGenerate}>
                {t("inv_generate")}
              </Button>
              <p className="text-center text-[10px] font-mono uppercase tracking-widest text-white/35">
                {t("inv_expiresAuto")}
              </p>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-serif italic text-white">
                {t("inv_readyTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("inv_readyDesc", { role })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 pt-2">
              <div className="bg-white rounded-xl p-3 shadow-sm">
                <QrImage value={link} size={168} alt={`${role} invite QR`} />
              </div>

              <div className="w-full space-y-1">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                  {t("inv_linkLabel")}
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111111] px-3 py-2.5">
                  <span className="flex-1 text-xs font-mono text-white/80 truncate">{link}</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-white/40 hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">
                    {t("inv_expires24Short", { role })}
                  </span>
                  <span className={cn("text-[10px] font-mono text-amber-400/90 uppercase")}>
                    {t("inv_awaiting")}
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setToken(null);
                  setRole("Cashier");
                }}
              >
                {t("inv_createAnother")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}