"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* generic success regardless */
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#050505] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#111] border border-white/10 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-white/80" />
          </div>
          <span className="font-serif italic text-lg">Sufra</span>
        </div>

        <div className="bg-[#0D0D0D] border border-white/10 rounded-2xl p-6">
          <h1 className="font-serif italic text-2xl">Reset password</h1>
          <p className="text-xs text-white/40 mt-1.5 leading-relaxed">
            {sent
              ? "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder."
              : "Enter your owner email and we'll send you a reset link."}
          </p>

          {!sent && (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                  Email
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
                Send reset link
              </Button>
            </form>
          )}
        </div>

        <p className="text-xs text-white/40 text-center mt-5">
          <Link href="/auth/login" className="text-white/80 underline underline-offset-4 hover:text-white">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}