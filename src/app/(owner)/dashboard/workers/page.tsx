"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  UserPlus,
  ShieldCheck,
  CreditCard,
  Copy,
  Check,
  X,
  Clock,
  Trash2,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { appBaseUrl } from "@/lib/utils";
import type { Worker, WorkerRole } from "@/lib/constants";
import { PageHeader } from "@/components/dashboard/page-header";
import { InviteDialog } from "@/components/dashboard/invite-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ROLE_ICON: Record<WorkerRole, typeof ShieldCheck> = {
  Cashier: CreditCard,
  Manager: ShieldCheck,
};

/** A row from `GET /api/workers` — `role` is free-form in the live schema. */
interface ServerWorker {
  id: string;
  name: string;
  role: string | null;
  createdAt: string | null;
}

function WorkerCard({
  worker,
  brandColor,
  onRevoke,
}: {
  worker: Worker;
  brandColor: string;
  /** Present only for server rows — local/demo workers have no row to revoke. */
  onRevoke?: () => void;
}) {
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
          {worker.role === "Manager" ? t("wk_manager") : t("wk_cashier")}
        </span>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
            <span className="w-1 h-1 rounded-full bg-emerald-400" /> {t("wk_statusActive")}
          </span>
          {onRevoke && (
            <button
              type="button"
              onClick={onRevoke}
              title={t("wk_revokeTitle")}
              className="text-white/30 hover:text-red-400 h-6 w-6 rounded-full hover:bg-white/5 transition-colors cursor-pointer inline-flex items-center justify-center"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkersPage() {
  const { workers, invites, brandColor, removeInvite } = useOnboarding();
  const { t, lang } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [serverWorkers, setServerWorkers] = useState<ServerWorker[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<ServerWorker | null>(null);
  const [revoking, setRevoking] = useState(false);

  // The server list is the only place a worker session can be revoked from, so
  // it must be read from the API — the local store never hydrates workers.
  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus("loading");
      try {
        const res = await fetch("/api/workers");
        const data = (await res.json().catch(() => null)) as
          | { cloud?: boolean; workers?: ServerWorker[]; error?: string }
          | null;
        if (!alive) return;
        if (res.ok && data?.cloud) {
          setServerWorkers(data.workers ?? []);
          setStatus("ready");
          return;
        }
        if (data?.error === "NO_BACKEND") {
          // Demo/self-hosted without Supabase: the local list is all there is.
          setServerWorkers([]);
          setStatus("unavailable");
          return;
        }
        setServerWorkers(null);
        setStatus("error");
      } catch {
        if (!alive) return;
        setServerWorkers(null);
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const pendingInvites = invites.filter((i) => i.status === "pending");

  const locale = lang === "fr" ? "fr-FR" : lang === "ar" ? "ar-TN" : "en-GB";
  const joinedLabel = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  };

  const serverIds = new Set((serverWorkers ?? []).map((w) => w.id));
  const rows: { worker: Worker; server: ServerWorker | null }[] = [
    ...(serverWorkers ?? []).map((w): { worker: Worker; server: ServerWorker } => ({
      worker: {
        id: w.id,
        name: w.name,
        // The live schema allows 'Cashier'/'Manager' in either case.
        role: (w.role ?? "").trim().toLowerCase() === "manager" ? "Manager" : "Cashier",
        joinedAt: joinedLabel(w.createdAt),
      },
      server: w,
    })),
    // Local (demo) workers have no server row; keep showing them so the offline
    // path keeps working.
    ...workers
      .filter((w) => !serverIds.has(w.id))
      // The store keeps ISO instants; format them like the server rows.
      .map((w) => ({ worker: { ...w, joinedAt: joinedLabel(w.joinedAt) }, server: null })),
  ];

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(`${appBaseUrl()}/worker/invite/${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1600);
  };

  const handleRemove = (id: string) => {
    removeInvite(id);
    toast.info(t("wk_removedToast"));
  };

  const handleRevoke = useCallback(async () => {
    const target = revokeTarget;
    if (!target) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as
        | { cloud?: boolean; error?: string }
        | null;
      if (res.ok && data?.cloud) {
        setServerWorkers((prev) => (prev ?? []).filter((w) => w.id !== target.id));
        setRevokeTarget(null);
        toast.success(t("wk_revokedToast", { name: target.name }));
        return;
      }
      toast.error(`${t("wk_revokeFailed")}${data?.error ? ` (${data.error})` : ""}`);
    } catch {
      toast.error(t("wk_revokeFailed"));
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, t]);

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
        {t("wk_active", { n: rows.length })}
      </h3>

      {status === "loading" && (
        <div className="rounded-xl border border-white/10 bg-[#0D0D0D] py-10 mb-10 flex items-center justify-center gap-2 text-xs font-mono uppercase tracking-wider text-white/40">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t("wk_loading")}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-5 py-4 mb-10 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-xs text-red-300/90 flex-1">{t("wk_loadFailed")}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("wk_retry")}
          </Button>
        </div>
      )}

      {status !== "loading" && status !== "error" && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-14 text-center mb-10">
          <p className="text-sm text-white/50 font-medium">{t("wk_noWorkers")}</p>
          <p className="text-xs text-white/35 mt-1 max-w-sm mx-auto">{t("wk_noWorkersSub")}</p>
        </div>
      )}

      {status !== "loading" && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-10">
          {rows.map(({ worker, server }) => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              brandColor={brandColor.value}
              onRevoke={server ? () => setRevokeTarget(server) : undefined}
            />
          ))}
        </div>
      )}

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
                    <p className="text-sm text-white font-medium">
                      {t("wk_inviteFor", {
                        role: invite.role === "Manager" ? t("wk_manager") : t("wk_cashier"),
                      })}
                    </p>
                    <p className="text-[11px] font-mono text-white/40 truncate">
                      {invite.token} · {joinedLabel(invite.createdAt)}
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

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wk_revokeTitle")}</DialogTitle>
            <DialogDescription>
              {t("wk_revokeBody", { name: revokeTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
            >
              {t("ca_cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {t("wk_revokeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
