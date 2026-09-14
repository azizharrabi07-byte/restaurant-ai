"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

interface AuthFormProps {
  mode: "login" | "signup";
}

/** Same-origin paths only — never let a query string bounce the owner off-site. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useI18n();

  const isLogin = mode === "login";

  /**
   * Where the owner was heading before the auth wall. Read after mount rather
   * than through `useSearchParams` so the server-rendered auth pages need no
   * extra Suspense boundary.
   */
  const [next, setNext] = useState("/dashboard");
  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const withNext = (path: string) =>
    next === "/dashboard" ? path : `${path}?next=${encodeURIComponent(next)}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(isLogin ? {} : { name }) }),
      });
      const data = (await res.json()) as { cloud?: boolean; message?: string };
      if (!res.ok || !data.cloud) {
        setError(data.message ?? t("au_genericError"));
        return;
      }
      // The menu store reads `/api/auth/session`, so refresh the server tree
      // first: the dashboard must not render before the provider knows it is
      // signed in and has left local/demo mode (FE-08).
      router.refresh();
      router.replace(next);
    } catch {
      setError(t("au_networkError"));
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
          <h1 className="font-serif italic text-2xl">
            {isLogin ? t("au_welcomeBack") : t("au_createAccountTitle")}
          </h1>
          <p className="text-xs text-white/40 mt-1.5 leading-relaxed">
            {isLogin ? t("au_loginDesc") : t("au_signupDesc")}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            {!isLogin && (
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                  {t("au_name")}
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("au_namePh")}
                  className="mt-1.5"
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
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
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                {t("au_password")}
              </label>
              <Input
                type="password"
                required
                minLength={isLogin ? 6 : 8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? "••••••••" : t("au_passwordNewPh")}
                className="mt-1.5"
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 leading-relaxed">{error}</p>
            )}

            <Button type="submit" className="w-full mt-1" disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isLogin ? t("au_signIn") : t("au_createAccount")}
            </Button>
            {isLogin && (
              <p className="text-center text-xs text-white/40">
                <a
                  href="/auth/forgot"
                  className="underline underline-offset-4 hover:text-white"
                >
                  {t("au_forgot")}
                </a>
              </p>
            )}
          </form>
        </div>

        <p className={cn("text-xs text-white/40 text-center mt-5")}>
          {isLogin ? (
            <>
              {t("au_firstTime")}{" "}
              <a
                href={withNext("/auth/signup")}
                className="text-white/80 underline underline-offset-4 hover:text-white"
              >
                {t("au_createAccount")}
              </a>
            </>
          ) : (
            <>
              {t("au_haveAccount")}{" "}
              <a
                href={withNext("/auth/login")}
                className="text-white/80 underline underline-offset-4 hover:text-white"
              >
                {t("au_signIn")}
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
