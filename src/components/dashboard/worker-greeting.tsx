"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { useWorkerIdentity } from "@/lib/worker-identity";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * Modal shown once per browser when a cashier/manager opens the terminal —
 * prompts them for their display name so orders can be attributed.
 */
export function WorkerGreeting() {
  const { worker, setName } = useWorkerIdentity();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    // Only ask after we've read from localStorage (worker === null → no identity yet).
    if (worker === null) {
      // Delay a tick so the dashboard is visible behind.
      const id = setTimeout(() => setOpen(true), 350);
      return () => clearTimeout(id);
    }
    setOpen(false);
  }, [worker]);

  // Also request notification permission once we know who they are.
  useEffect(() => {
    if (worker && typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        // Fire-and-forget; browsers will only show the prompt on a user gesture
        // so attempt it silently — user will be asked the first time an alert fires.
        void Notification.requestPermission().catch(() => {});
      }
    }
  }, [worker]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (!v) return;
    setName(v);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* cannot close without a name */ }}>
      <DialogContent
        className="max-w-sm [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center mx-auto mb-3">
            <UserRound className="w-6 h-6" />
          </div>
          <DialogTitle className="text-center text-xl font-serif italic">
            {t("wg_title")}
          </DialogTitle>
          <DialogDescription className="text-center">
            {t("wg_desc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-2">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1.5">
              {t("wg_nameLabel")}
            </label>
            <Input
              autoFocus
              placeholder={t("wg_namePh")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={40}
            />
          </div>
          <Button type="submit" className="w-full font-bold" disabled={!value.trim()}>
            {t("wg_enter")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
