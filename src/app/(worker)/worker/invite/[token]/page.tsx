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
  error?: string;
  message?: string;
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
  const { t, lang, isAr } = useI18n();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [serverRejected, setServerRejected] = useState(false);
  const [working, setWorking] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [serverInvite, setServerInvite] = useState<ServerInviteInfo | null>(null);
  const [serverChecked, setServerChecked] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

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

  // `Cashier`/`Manager` are the stored and wire values; only their DISPLAY is
  // translated (I18N-09). `wk_manager`/`wk_cashier` are the role NAMES — the
  // same pair the owner workers page and the worker shell badge use.
  // `inv_roleManager`/`inv_roleCashier` are the long role *descriptions*
  // rendered as the paragraph further down, not labels.
  const roleLabel = role === "Manager" ? t("wk_manager") : t("wk_cashier");
  const displayName =
    (serverInvite?.restaurantName || undefined) ??
    nameParam ??
    restaurantName ??
    t("ob_yourCafe");
  const accent = serverInvite?.brandColor ?? colorParam ?? brandColor.value;
  // The stored instant is formatted for the reader (I18N-10); anything that is
  // not a parseable instant — a legacy English literal in localStorage — falls
  // back to the translated 24-hour copy instead of showing raw text.
  const expiryAt = storeInvite ? new Date(storeInvite.expiresAt) : null;
  const expiry =
    expiryAt && !Number.isNaN(expiryAt.getTime())
      ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(
          Math.round((expiryAt.getTime() - Date.now()) / 3_600_000),
          "hour",
        )
      : t("inv_expires24");

  const handleAccept = async () => {
    if (!valid || alreadyAccepted || working) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    setWorking(true);
    setAcceptError(null);

    // Authoritative accept happens server-side against the invite table.
    let server: AcceptResponse | null = null;
    // The local demo path is reserved for genuinely offline conditions: the
    // request never reached the server, or there is no backend configured.
    // Every explicit refusal is surfaced instead of faking a join.
    let offline = false;
    try {
      const res = await fetch("/api/auth/worker/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: cleanName }),
      });
      const data = (await res.json().catch(() => null)) as AcceptResponse | null;
      if (res.ok) {
        if (data && typeof data === "object") server = data;
      } else if (res.status === 401 || res.status === 404) {
        // The server answered, so this device is not offline — it simply does
        // not recognize the invite (unknown, expired or already used). A
        // local-only token must never grant access on its own.
        setServerRejected(true);
        setAccepted(true);
        setWorking(false);
        return;
      } else if (res.status === 409 && data?.error === "ALREADY_USED") {
        setAcceptError(t("inv_alreadyUsed"));
        setWorking(false);
        return;
      } else if (res.status === 503 && data?.error === "NEEDS_MIGRATION") {
        setAcceptError(t("inv_needsMigration"));
        setWorking(false);
        return;
      } else if (res.status === 503 && data?.error === "NO_BACKEND") {
        offline = true;
      } else if (res.status === 429) {
        // The route sends Retry-After; fall back to the documented minute.
        setAcceptError(t("inv_rateLimited", { s: res.headers.get("Retry-After") ?? "60" }));
        setWorking(false);
        return;
      } else {
        // Any other refusal (403/500/…) is a real error, not an offline state.
        setAcceptError(data?.message ?? t("inv_serverError"));
        setWorking(false);
        return;
      }
    } catch {
      // The request never reached the server — keep the offline flow.
      offline = true;
    }

    const serverWorker = server?.cloud ? server.worker : undefined;
    if (!serverWorker && !offline) {
      setAcceptError(server?.message ?? t("inv_serverError"));
      setWorking(false);
      return;
    }
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
      description: t("inv_welcomeToastDesc", { name: displayName, role: roleLabel }),
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
            <p className="mt-2 text-sm text-white/40">{t("inv_ready", { role: roleLabel })}</p>
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
                  {roleLabel}
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
                {working ? t("inv_working") : t("inv_accept")}
                {!working && <ArrowRight className={cn("w-4 h-4 text-black", isAr && "rotate-180")} />}
              </Button>

              {acceptError && (
                <p className="mt-3 text-center text-xs text-red-400 leading-relaxed">
                  {acceptError}
                </p>
              )}

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

/**
 * Suspense fallback. This is a separate component because `useI18n` is a hook
 * and the page shell itself has no access to it — the fallback renders before
 * Suspense resolves, so it needs its own translated label.
 */
function InviteLoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-background text-foreground flex items-center justify-center">
      <p className="text-xs font-mono uppercase tracking-widest text-white/40 animate-pulse">
        {t("common_loading")}
      </p>
    </div>
  );
}

export default function WorkerInvitePage() {
  return (
    <Suspense fallback={<InviteLoadingFallback />}>
      <InviteContent />
    </Suspense>
  );
}