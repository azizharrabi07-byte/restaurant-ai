"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "resolve" | "password" | "done" | "invalid";

function parseHash(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  for (const part of raw.split("&")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      try {
        out[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      } catch {
        /* ignore malformed piece */
      }
    }
  }
  return out;
}

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("resolve");
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Resolve the entry shape: implicit fragment (#access_token=…) from a
  // legacy link click, PKCE query (?token_hash=&type=), or nothing.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const hash = parseHash();
      const queryHash = searchParams.get("token_hash");
      const queryType = searchParams.get("type");

      if (hash.error) {
        if (!cancelled) {
          setError("This link is invalid or expired. Request a new one.");
          setPhase("invalid");
        }
        return;
      }

      if (hash.access_token) {
        try {
          const res = await fetch("/api/auth/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: hash.access_token,
              ...(hash.refresh_token ? { refresh_token: hash.refresh_token } : {}),
            }),
          });
          const data = (await res.json()) as { cloud?: boolean; message?: string };
          if (!res.ok || !data.cloud) throw new Error(data.message ?? "Link verification failed.");
          window.history.replaceState(null, "", window.location.pathname);
          if (!cancelled) setPhase("password");
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Link verification failed.");
            setPhase("invalid");
          }
        }
        return;
      }

      if (queryHash && queryType === "recovery") {
        setTokenHash(queryHash);
        setLinkType(queryType);
        if (!cancelled) setPhase("password");
        return;
      }

      if (!cancelled) setPhase("invalid");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      // PKCE entry completes verification + password in one call; the
      // implicit-fragment entry is already signed in, so it just sets it.
      const res = tokenHash
        ? await fetch("/api/auth/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token_hash: tokenHash, type: linkType, password }),
          })
        : await fetch("/api/auth/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
      const data = (await res.json()) as { cloud?: boolean; message?: string };
      if (!res.ok || !data.cloud) {
        setError(data.message ?? "Something went wrong.");
        return;
      }
      setPhase("done");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
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
          {phase === "resolve" && (
            <p className="text-xs text-white/40 text-center py-6 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying your link…
            </p>
          )}

          {phase === "invalid" && (
            <>
              <h1 className="font-serif italic text-2xl">Invalid link</h1>
              <p className="text-xs text-white/40 mt-2 leading-relaxed">
                {error ?? "This reset link is missing or malformed. Request a new one."}
              </p>
              <Link href="/auth/forgot" className="mt-4 inline-block">
                <Button variant="outline" size="sm">Request new link</Button>
              </Link>
            </>
          )}

          {phase === "password" && (
            <>
              <h1 className="font-serif italic text-2xl">Set a new password</h1>
              <p className="text-xs text-white/40 mt-1.5 leading-relaxed">
                Choose a password of at least 8 characters.
              </p>
              <form onSubmit={submit} className="mt-6 space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                    New password
                  </label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                    Confirm password
                  </label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5"
                    autoComplete="new-password"
                  />
                </div>
                {error && <p className="text-xs text-red-400 leading-relaxed">{error}</p>}
                <Button type="submit" className="w-full mt-1" disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set password & sign in
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#050505] text-white flex items-center justify-center">
          <p className="text-xs font-mono uppercase tracking-widest text-white/40 animate-pulse">
            Loading…
          </p>
        </div>
      }
    >
      <ResetForm />
    </Suspense>
  );
}