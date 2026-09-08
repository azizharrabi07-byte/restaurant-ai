"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, ShieldCheck, CreditCard, Copy, Check, X, Clock } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { appBaseUrl } from "@/lib/utils";
import type { Worker, WorkerRole } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { InviteDialog } from "@/components/dashboard/invite-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ROLE_ICON: Record<WorkerRole, typeof ShieldCheck> = {
  Cashier: CreditCard,
  Manager: ShieldCheck,
};

function WorkerCard({ worker, brandColor }: { worker: Worker; brandColor: string }) {
  const RoleIcon = ROLE_ICON[worker.role];
  const { t } = useI18n();
  const initials = worker.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-5 flex items-center gap-4 animate-fade-up">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: brandColor }}
      >
        <span className="font-serif italic font-bold text-black text-sm">{initials}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white font-medium truncate">{worker.name}</p>
        <p className="text-[11px] text-white/40 font-mono mt-0.5">{t("wk_joined", { date: worker.joinedAt })}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/70">
          <RoleIcon className="w-3 h-3" />
          {worker.role}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
          <span className="w-1 h-1 rounded-full bg-emerald-400" /> {t("wk_statusActive")}
        </span>
      </div>
    </div>
  );
}

export default function WorkersPage() {
  const { workers, invites, brandColor, removeInvite } = useOnboarding();
  const { t } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const pendingInvites = invites.filter((i) => i.status === "pending");

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(`${appBaseUrl()}/worker/invite/${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1600);
  };

  const handleRemove = (id: string) => {
    removeInvite(id);
    toast.info(t("wk_removedToast"));
  };

  return (
    <>
      <PageHeader
        eyebrow={t("wk_eyebrow")}
        title={t("wk_title")}
        description={t("wk_desc")}
        actions={
          <Button type="button" className="font-bold" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-3.5 h-3.5 text-black" />
            {t("wk_invite")}
          </Button>
        }
      />

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      {/* Active workers */}
      <h3 className="text-xs font-mono uppercase tracking-widest text-white/60 mb-3">
        {t("wk_active", { n: workers.length })}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-10">
        {workers.map((w) => (
          <WorkerCard key={w.id} worker={w} brandColor={brandColor.value} />
        ))}
      </div>

      {/* Pending invites */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-white/60">
          {t("wk_invites", { n: pendingInvites.length })}
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 flex items-center gap-1.5">
          <Clock className="w-3 h-3" /> {t("wk_valid24")}
        </span>
      </div>

      {pendingInvites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-14 text-center">
          <p className="text-sm text-white/50 font-medium">{t("wk_noInvites")}</p>
          <p className="text-xs text-white/35 mt-1">
            {t("wk_noInvitesSub")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingInvites.map((invite) => {
            const RoleIcon = ROLE_ICON[invite.role];
            return (
              <div
                key={invite.id}
                className="rounded-xl border border-white/10 bg-[#0D0D0D] p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-lg border border-amber-500/20 bg-amber-500/10 flex items-center justify-center shrink-0">
                    <RoleIcon className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium">{t("wk_inviteFor", { role: invite.role })}</p>
                    <p className="text-[11px] font-mono text-white/40 truncate">
                      {invite.token} · {invite.createdAt}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-400">
                    <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                    {t("wk_statusPending")}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(invite.token)}
                    className="text-white/40 hover:text-white h-8 px-2.5 rounded-full hover:bg-white/5 transition-colors cursor-pointer inline-flex items-center gap-1.5 text-xs"
                    title={t("wk_copyTitle")}
                  >
                    {copiedToken === invite.token ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {t("wk_copy")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(invite.id)}
                    className={cn(
                      "text-white/30 hover:text-red-400 h-8 w-8 rounded-full hover:bg-white/5 transition-colors cursor-pointer inline-flex items-center justify-center",
                    )}
                    title={t("wk_removeTitle")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}