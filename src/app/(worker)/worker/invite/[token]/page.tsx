"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Clock, ShieldCheck, CreditCard, ArrowRight } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { BrandMark, BrandWordmark } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkerRole } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";

const ROLE_VALUES: string[] = ["Cashier", "Manager"];

interface AcceptResponse {
  cloud?: boolean;
  worker?: { id: string; name: string; role: WorkerRole } | null;
  sessionToken?: string;
}

interface ServerInviteInfo {
  role: WorkerRole;
  restaurantName: string;
  brandColor: string | null;
  expiresAt: string | null;
}

function InviteContent() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { invites, acceptInvite, createInvite, restaurantName, brandColor, setWorkerSession } =
    useOnboarding();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [serverRejected, setServerRejected] = useState(false);
  const [working, setWorking] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [serverInvite, setServerInvite] = useState<ServerInviteInfo | null>(null);
  const [serverChecked, setServerChecked] = useState(false);

  const token = params.token ?? "";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Authoritative invite lookup: role/name come from the server, never the URL.
  useEffect(() => {
    if (!token) {
      setServerChecked(true);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/auth/worker/invite/${encodeURIComponent(token)}`);
        if (!alive) return;
        if (res.ok) {
          const json = (await res.json()) as {
            cloud?: boolean;
            invite?: { role?: string; restaurantName?: string; brandColor?: string | null; expiresAt?: string | null };
          };
          if (json.cloud && json.invite && (json.invite.role === "Cashier" || json.invite.role === "Manager")) {
            setServerInvite({
              role: json.invite.role,
              restaurantName: json.invite.restaurantName ?? "",
              brandColor: json.invite.brandColor ?? null,
              expiresAt: json.invite.expiresAt ?? null,
            });
          }
        }
      } catch {
        /* offline — local demo path below */
      } finally {
        if (alive) setServerChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const roleParam = searchParams.get("role");
  const nameParam = searchParams.get("r");
  const colorParam = searchParams.get("b");

  const storeInvite = invites.find((i) => i.token === token);
  // Legacy local links carry details in the URL (demo mode only). Server
  // invites never trust URL params.
  const fromUrl = Boolean(roleParam && nameParam);
  const valid = Boolean(serverInvite) || Boolean(storeInvite) || fromUrl;
  const alreadyAccepted = storeInvite?.status === "accepted" || accepted;

  const role: WorkerRole = serverInvite
    ? serverInvite.role
    : ROLE_VALUES.includes(roleParam ?? "")
      ? (roleParam as WorkerRole)
      : (storeInvite?.role ?? "Cashier");
  const displayName =
    (serverInvite?.restaurantName || undefined) ??
    nameParam ??
    restaurantName ??
    "Velvet & Stone Coffee";
  const accent = serverInvite?.brandColor ?? colorParam ?? brandColor.value;
  const expiry = storeInvite?.expiresAt ?? t("inv_expires24");

  const handleAccept = async () => {
    if (!valid || alreadyAccepted || working) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    setWorking(true);

    // Authoritative accept happens server-side against the invite table.
    let server: AcceptResponse | null = null;
    try {
      const res = await fetch("/api/auth/worker/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: cleanName }),
      });
      if (res.ok) {
        const json = (await res.json()) as AcceptResponse;
        if (json && typeof json === "object") server = json;
      } else if (res.status === 401 || res.status === 404) {
        // The server doesn't recognize this invite. Only fall through when the
        // invite exists in the local store (offline/demo mode); a bare URL
        // alone must NOT grant access.
        if (!storeInvite) {
          setServerRejected(true);
          setAccepted(true);
          setWorking(false);
          return;
        }
      }
      // 429/503 and network failures degrade to the local demo path.
    } catch {
      /* offline — keep local flow */
    }

    const serverWorker = server?.cloud ? server.worker : undefined;
    if (serverWorker) {
      if (!storeInvite || storeInvite.status !== "pending") createInvite(serverWorker.role, token);
      acceptInvite(token, serverWorker.name);
      setWorkerSession({
        id: serverWorker.id,
        name: serverWorker.name,
        role: serverWorker.role,
      });
    } else {
      if (!storeInvite || storeInvite.status !== "pending") createInvite(role, token);
      acceptInvite(token, cleanName);
    }
    setAccepted(true);
    setWorking(false);
    toast.success(t("inv_welcomeToast"), {
      description: t("inv_welcomeToastDesc", { name: displayName, role }),
    });
    setTimeout(() => router.push("/worker/dashboard"), 900);
  };

  const RoleIcon = role === "Manager" ? ShieldCheck : CreditCard;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-4 sm:px-8 bg-[#080808]">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-white text-black flex items-center justify-center rounded-sm shrink-0 transition-transform group-hover:rotate-45 overflow-hidden">
            <BrandMark className="scale-90" />
          </div>
          <BrandWordmark />
        </Link>
        <span className="text-xs font-mono uppercase tracking-widest text-white/40">
          {t("inv_header")}
        </span>
      </header>

      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        {!mounted || !serverChecked ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center animate-pulse">
            <p className="text-xs font-mono uppercase tracking-widest text-white/40">
              {t("inv_loading")}
            </p>
          </div>
        ) : !valid || serverRejected ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full border border-white/10 bg-white/5 flex items-center justify-center">
              <span className="text-lg">🕓</span>
            </div>
            <h1 className="mt-5 text-xl font-serif italic text-white">{t("inv_notFound")}</h1>
            <p className="mt-2 text-sm text-white/40 leading-relaxed">
              {t("inv_notFoundDesc")}
            </p>
            <Link href="/" className="mt-6 inline-block">
              <Button variant="outline" size="sm">
                {t("inv_backHome")}
              </Button>
            </Link>
          </div>
        ) : alreadyAccepted ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-xl font-serif italic text-white">
              {t("inv_welcome", { name: displayName })}
            </h1>
            <p className="mt-2 text-sm text-white/40">{t("inv_ready", { role })}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] overflow-hidden animate-fade-up">
            <div
              className="h-28 bg-gradient-to-b from-white/5 to-transparent"
              style={{ backgroundColor: accent }}
            />
            <div className="px-6 sm:px-8 pb-8 pt-4 -mt-10">
              <div className="flex justify-center">
                <RestaurantLogo logo={null} name={displayName} brandColor={accent} size={72} />
              </div>

              <p className="mt-5 text-center text-[10px] font-mono uppercase tracking-widest text-white/40">
                {t("inv_invitedTo")}
              </p>
              <h1 className="mt-1.5 text-center text-2xl sm:text-3xl font-serif italic text-white leading-tight">
                {displayName}
              </h1>

              <div className="mt-4 flex justify-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-wider",
                    role === "Manager"
                      ? "border-white/10 bg-white/5 text-white/70"
                      : "border-[#D97706]/25 bg-[#D97706]/10 text-[#f1b057]",
                  )}
                >
                  <RoleIcon className="w-3.5 h-3.5" />
                  {role}
                </span>
              </div>

              <p className="mt-5 text-center text-xs text-white/40 leading-relaxed">
                {role === "Manager"
                  ? t("inv_roleManager")
                  : t("inv_roleCashier")}
              </p>

              <div className="mt-5 flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/35">
                <Clock className="w-3 h-3" />
                {expiry}
              </div>

              <div className="mt-5 space-y-2">
                <label htmlFor="worker-name" className="block text-[10px] font-mono uppercase tracking-widest text-white/40">
                  {t("inv_name")}
                </label>
                <Input
                  id="worker-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("inv_namePh")}
                />
              </div>

              <Button
                type="button"
                className="mt-4 w-full font-bold"
                size="lg"
                onClick={() => void handleAccept()}
                disabled={working}
              >
                {working ? t("inv_working") ?? "Working…" : t("inv_accept")}
                {!working && <ArrowRight className="w-4 h-4 text-black" />}
              </Button>

              <p className="mt-4 text-center text-[10px] text-white/35">
                {t("inv_noAcc")}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function WorkerInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-background text-foreground flex items-center justify-center">
          <p className="text-xs font-mono uppercase tracking-widest text-white/40 animate-pulse">
            Loading…
          </p>
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}