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

const ROLE_VALUES: string[] = ["Cashier", "Manager"];

function InviteContent() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { invites, acceptInvite, createInvite, restaurantName, brandColor } = useOnboarding();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const token = params.token ?? "";
  const roleParam = searchParams.get("role");
  const nameParam = searchParams.get("r");
  const colorParam = searchParams.get("b");

  const storeInvite = invites.find((i) => i.token === token);
  const fromUrl = Boolean(roleParam && nameParam);
  // A QR from the invite dialog carries its details in the URL, so it works on
  // any device even though state is local. The seeded token falls back to store.
  const valid = fromUrl || Boolean(storeInvite);
  const alreadyAccepted = storeInvite?.status === "accepted" || accepted;

  const role: WorkerRole = ROLE_VALUES.includes(roleParam ?? "")
    ? (roleParam as WorkerRole)
    : (storeInvite?.role ?? "Cashier");
  const displayName = nameParam || restaurantName || "Velvet & Stone Coffee";
  const accent = colorParam || brandColor.value;
  const expiry = storeInvite?.expiresAt ?? "In 24 hours";

  const handleAccept = () => {
    if (!valid || alreadyAccepted) return;
    if (!storeInvite || storeInvite.status !== "pending") {
      createInvite(role, token);
    }
    acceptInvite(token, name);
    setAccepted(true);
    toast.success("Welcome aboard!", {
      description: `You joined ${displayName} as ${role}.`,
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
          Worker Invite
        </span>
      </header>

      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        {!mounted ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center animate-pulse">
            <p className="text-xs font-mono uppercase tracking-widest text-white/40">
              Loading invite…
            </p>
          </div>
        ) : !valid ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full border border-white/10 bg-white/5 flex items-center justify-center">
              <span className="text-lg">🕓</span>
            </div>
            <h1 className="mt-5 text-xl font-serif italic text-white">Invite not found</h1>
            <p className="mt-2 text-sm text-white/40 leading-relaxed">
              This invite link is expired, was already used, or doesn’t exist. Ask the owner to
              generate a new one.
            </p>
            <Link href="/" className="mt-6 inline-block">
              <Button variant="outline" size="sm">
                Back to Sufra
              </Button>
            </Link>
          </div>
        ) : alreadyAccepted ? (
          <div className="rounded-2xl border border-white/10 bg-[#0D0D0D] p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-xl font-serif italic text-white">
              You’re in — welcome to {displayName}
            </h1>
            <p className="mt-2 text-sm text-white/40">{role} account ready. Opening your terminal…</p>
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
                You’ve been invited to join
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
                  ? "You’ll get full oversight of tables, workers, and live orders."
                  : "You’ll take orders at the register and settle them from the terminal."}
              </p>

              <div className="mt-5 flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/35">
                <Clock className="w-3 h-3" />
                {expiry}
              </div>

              <div className="mt-5 space-y-2">
                <label htmlFor="worker-name" className="block text-[10px] font-mono uppercase tracking-widest text-white/40">
                  Your name
                </label>
                <Input
                  id="worker-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Yassine"
                />
              </div>

              <Button type="button" className="mt-4 w-full font-bold" size="lg" onClick={handleAccept}>
                Accept Invite
                <ArrowRight className="w-4 h-4 text-black" />
              </Button>

              <p className="mt-4 text-center text-[10px] text-white/35">
                No account needed — you’ll land straight in the cashier terminal.
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