"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

type Outcome = "idle" | "sent" | "failed" | "unavailable" | "rateLimited";

export function ForgotForm() {
  const { t, isAr } = useI18n();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setOutcome("idle");
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data: unknown = await res.json().catch(() => null);
      const code =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : undefined;
      const refused = data && typeof data === "object" && "cloud" in data && data.cloud === false;

      // The endpoint is deliberately enumeration-safe: anything it ACCEPTS is
      // reported with the neutral copy. Only a refusal is reported as a
      // failure, so the form never promises a link it knows it did not send.
      if (!res.ok || refused) {
        if (res.status === 429 || code === "RATE_LIMITED") {
          setOutcome("rateLimited");
        } else if (code === "NO_BACKEND" || res.status === 503) {
          setOutcome("unavailable");
        } else {
          setOutcome("failed");
        }
        return;
      }
      setOutcome("sent");
    } catch {
      setOutcome("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const message =
    outcome === "sent"
      ? t("au_resetSent")
      : outcome === "failed"
        ? t("au_resetFailed")
        : outcome === "unavailable"
          ? t("au_resetUnavailable")
          : outcome === "rateLimited"
            ? t("au_resetRateLimited")
            : t("au_resetDesc");
  const failed = outcome === "failed" || outcome === "unavailable" || outcome === "rateLimited";

  return (
    <div className="min-h-dvh bg-[#050505] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm" dir={isAr ? "rtl" : "ltr"}>
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#111] border border-white/10 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-white/80" />
          </div>
          <span className="font-serif italic text-lg">Sufra</span>
        </div>

        <div className="bg-[#0D0D0D] border border-white/10 rounded-2xl p-6">
          <h1 className="font-serif italic text-2xl">{t("au_resetTitle")}</h1>
          <p
            className={
              failed
                ? "text-xs text-red-400 mt-1.5 leading-relaxed"
                : "text-xs text-white/40 mt-1.5 leading-relaxed"
            }
            role={failed ? "alert" : undefined}
          >
            {message}
          </p>

          {outcome !== "sent" && (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono block text-start">
                  {t("au_email")}
                </label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5"
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full mt-1" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t("au_resetSend")}
              </Button>
            </form>
          )}
        </div>

        <p className="text-xs text-white/40 text-center mt-5">
          <Link href="/auth/login" className="text-white/80 underline underline-offset-4 hover:text-white">
            {t("au_backToSignIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
