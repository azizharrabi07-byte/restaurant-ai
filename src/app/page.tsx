"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PhoneMockup } from "@/components/phone-mockup";
import { BrandMark, BrandWordmark } from "@/components/brand-logo";
import {
  LandingProvider,
  useLanding,
  landingCategories,
  landingProducts,
  LANDING_COVER,
  LANDING_PHONE_LABELS,
  type LandingLang,
  type LandingCurrency,
} from "@/lib/landing-i18n";
import {
  QrCode,
  LayoutTemplate,
  BellRing,
  MonitorSmartphone,
  Zap,
  Store,
  ArrowRight,
  Menu,
  Check,
  Languages,
  Coins,
} from "lucide-react";

const LANGS: { key: LandingLang; label: string }[] = [
  { key: "en", label: "EN" },
  { key: "fr", label: "FR" },
  { key: "ar", label: "AR" },
];

const CURRENCIES: { key: LandingCurrency; label: string; symbol: string }[] = [
  { key: "tnd", label: "TND", symbol: "DT" },
  { key: "usd", label: "USD", symbol: "$" },
  { key: "eur", label: "EUR", symbol: "€" },
];

function Switcher() {
  const { lang, setLang, cur, setCur } = useLanding();
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
      <span className="hidden sm:flex items-center gap-1.5 px-2 text-[10px] font-mono uppercase tracking-wider text-white/40">
        <Languages className="w-3 h-3" />
        {LANGS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLang(l.key)}
            className={cn(
              "px-2 py-1 rounded-full text-[10px] font-mono font-semibold transition-all cursor-pointer",
              lang === l.key
                ? "bg-white text-black"
                : "text-white/50 hover:text-white",
            )}
          >
            {l.label}
          </button>
        ))}
      </span>
      <span className="hidden sm:flex h-4 w-px bg-white/10" />
      <span className="hidden sm:flex items-center gap-1.5 px-2 text-[10px] font-mono uppercase tracking-wider text-white/40">
        <Coins className="w-3 h-3" />
        {CURRENCIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCur(c.key)}
            className={cn(
              "px-2 py-1 rounded-full text-[10px] font-mono font-semibold transition-all cursor-pointer",
              cur === c.key
                ? "bg-white text-black"
                : "text-white/50 hover:text-white",
            )}
          >
            {c.symbol}
          </button>
        ))}
      </span>
    </div>
  );
}

function Header() {
  const { t } = useLanding();
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/10 bg-[#080808]/80 backdrop-blur-md flex items-center justify-between px-4 sm:px-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-white text-black flex items-center justify-center rounded-sm shrink-0 transition-transform group-hover:rotate-45 overflow-hidden">
            <BrandMark className="scale-90" />
          </div>
          <BrandWordmark />
        </Link>
        <nav className="hidden md:flex items-center gap-6 ml-8">
          <a
            href="#how"
            className="text-xs font-mono uppercase tracking-wider text-white/40 hover:text-white transition-colors"
          >
            {t("how_eyebrow")}
          </a>
          <a
            href="#features"
            className="text-xs font-mono uppercase tracking-wider text-white/40 hover:text-white transition-colors"
          >
            {t("f_eyebrow")}
          </a>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Switcher />
        <Link href="/onboarding">
          <Button size="sm" className="font-bold">
            {t("nav_open")}
          </Button>
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  const { t, lang, formatPrice, isAr } = useLanding();
  const categories = landingCategories(lang);
  const products = landingProducts(lang);
  const phoneLabels = LANDING_PHONE_LABELS[lang];
  return (
    <section className="relative mx-auto max-w-6xl px-4 sm:px-8 pt-14 pb-20 sm:pt-24 sm:pb-28">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="anim-glow pointer-events-none absolute -top-24 right-0 lg:-right-24 h-[420px] w-[420px] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, rgba(217,119,6,0.22) 0%, transparent 65%)",
        }}
      />
      <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div className="max-w-xl">
          <div className="anim-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-white/60 backdrop-blur-sm mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("hero_badge")}
          </div>
          <h1 className="anim-rise d-1 text-4xl font-serif italic tracking-tight text-white sm:text-5xl lg:text-6xl">
            {t("hero_title_a")}
            <br />
            {t("hero_title_b")}
          </h1>
          <p className="anim-rise d-2 mt-5 text-lg text-white/40 leading-relaxed max-w-md">
            {t("hero_sub")}
          </p>
          <ul className="anim-rise d-3 mt-6 space-y-2">
            {[t("b1"), t("b2"), t("b3")].map((point) => (
              <li
                key={point}
                className="flex items-center gap-2.5 text-sm text-white/60"
              >
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                {point}
              </li>
            ))}
          </ul>
          <div className="anim-rise d-4 mt-8 flex flex-wrap items-center gap-4">
            <Link href="/onboarding">
              <Button size="lg" className="h-12 px-8 font-bold tracking-tight">
                {t("cta")}
                <ArrowRight className={cn("w-4 h-4", isAr && "rotate-180")} />
              </Button>
            </Link>
            <a
              href="#how"
              className="text-xs font-mono uppercase tracking-wider text-white/40 hover:text-white transition-colors"
            >
              {t("how_link")}
            </a>
          </div>
        </div>

        <div className="anim-rise d-2 anim-floaty flex justify-center lg:justify-end">
          <PhoneMockup
            restaurantName="Velvet & Stone Coffee"
            logo={null}
            brandColor="#D97706"
            categories={categories}
            products={products}
            cover={LANDING_COVER}
            formatPrice={formatPrice}
            labels={phoneLabels}
            className="scale-[0.9] sm:scale-100 origin-top transition-transform duration-300 hover:scale-[0.95] sm:hover:scale-[1.03]"
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useLanding();
  const steps = [
    {
      n: "01",
      icon: Menu,
      title: t("h1_t"),
      desc: t("h1_d"),
    },
    {
      n: "02",
      icon: QrCode,
      title: t("h2_t"),
      desc: t("h2_d"),
    },
    {
      n: "03",
      icon: BellRing,
      title: t("h3_t"),
      desc: t("h3_d"),
    },
  ];
  return (
    <section id="how" className="border-t border-white/10 bg-white/[0.015] scroll-mt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-20 sm:py-24">
        <div className="max-w-lg mb-14">
          <p className="anim-rise text-xs font-mono uppercase tracking-widest text-white/40 mb-3">
            {t("how_eyebrow")}
          </p>
          <h2 className="anim-rise d-1 text-3xl font-serif italic tracking-tight text-white sm:text-4xl">
            {t("how_title")}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={cn(
                "anim-rise group relative rounded-xl border border-white/10 bg-[#0D0D0D] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/25",
                `d-${i + 1}`,
              )}
            >
              <span className="text-xs font-mono text-white/30">{s.n}</span>
              <div className="mt-6 flex h-10 w-10 items-center justify-center rounded-lg bg-[#1A1A1A] border border-white/10">
                <s.icon className="h-5 w-5 text-white/70" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm text-white/40 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const { t } = useLanding();
  const features = [
    { icon: QrCode, title: t("f1_t"), desc: t("f1_d") },
    { icon: LayoutTemplate, title: t("f2_t"), desc: t("f2_d") },
    { icon: BellRing, title: t("f3_t"), desc: t("f3_d") },
    { icon: MonitorSmartphone, title: t("f4_t"), desc: t("f4_d") },
    { icon: Zap, title: t("f5_t"), desc: t("f5_d") },
    { icon: Store, title: t("f6_t"), desc: t("f6_d") },
  ];
  return (
    <section id="features" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-20 sm:py-24">
        <div className="max-w-lg mb-14">
          <p className="anim-rise text-xs font-mono uppercase tracking-widest text-white/40 mb-3">
            {t("f_eyebrow")}
          </p>
          <h2 className="anim-rise d-1 text-3xl font-serif italic tracking-tight text-white sm:text-4xl">
            {t("f_title")}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={cn(
                "anim-rise rounded-xl border border-white/10 bg-[#0D0D0D] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/25",
                `d-${(i % 6) + 1}`,
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1A1A1A] border border-white/10">
                <f.icon className="h-5 w-5 text-white/70" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-xs text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  const { t, isAr } = useLanding();
  return (
    <section className="border-t border-white/10 bg-white/[0.015]">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-20 text-center">
        <p className="anim-rise text-xs font-mono uppercase tracking-widest text-white/40 mb-4">
          {t("cta_eyebrow")}
        </p>
        <h2 className="anim-rise d-1 mx-auto max-w-2xl text-3xl font-serif italic tracking-tight text-white sm:text-4xl">
          {t("cta_title")}
        </h2>
        <p className="anim-rise d-2 mx-auto mt-4 max-w-md text-sm text-white/40 leading-relaxed">
          {t("cta_sub")}
        </p>
        <div className="anim-rise d-3 mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/onboarding">
            <Button size="lg" className="h-12 px-8 font-bold tracking-tight">
              {t("cta")}
              <ArrowRight className={cn("w-4 h-4", isAr && "rotate-180")} />
            </Button>
          </Link>
          <span className="text-xs text-white/40 font-mono">{t("cta_note")}</span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useLanding();
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 sm:px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-white text-black flex items-center justify-center rounded-sm overflow-hidden">
            <BrandMark className="scale-90" />
          </div>
          <span className="text-xs text-white/40">{t("foot_rights")}</span>
        </div>
        <span className="text-xs text-white/40">{t("foot_made")}</span>
      </div>
    </footer>
  );
}

function LandingContent() {
  const { isAr } = useLanding();
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      lang={isAr ? "ar" : undefined}
      className={cn(
        "min-h-dvh bg-[#050505] text-[#E5E5E5] scroll-smooth",
        isAr && "font-[Cairo,_sans-serif]",
      )}
    >
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}

export default function LandingPage() {
  return (
    <LandingProvider>
      <LandingContent />
    </LandingProvider>
  );
}