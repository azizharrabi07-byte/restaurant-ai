import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PhoneMockup } from "@/components/phone-mockup";
import { BRAND_PALETTE, COVER_PRESETS } from "@/lib/constants";
import { QrCode, Zap, Palette, Store } from "lucide-react";

const DEMO_CATEGORIES = [
  { id: "1", name: "Espresso & Pourovers", position: 0 },
  { id: "2", name: "Cold Brew & Iced", position: 1 },
  { id: "3", name: "Pastries", position: 2 },
];

const DEMO_PRODUCTS = [
  { id: "1", name: "Oat Cortado", price: 4.75, categoryId: "1", image: null },
  { id: "2", name: "Batch Brew", price: 4.0, categoryId: "1", image: null },
  { id: "3", name: "Vanilla Cold Foam Brew", price: 5.5, categoryId: "2", image: null },
  { id: "4", name: "Berry Matcha Latte", price: 6.0, categoryId: "2", image: null },
  { id: "5", name: "Pistachio Croissant", price: 5.25, categoryId: "3", image: null },
];

const features = [
  {
    icon: QrCode,
    title: "Instant QR Menus",
    desc: "Every table gets its own QR code. Customers scan, browse, and order — no app required.",
  },
  {
    icon: Palette,
    title: "Your Brand, Your Style",
    desc: "Pick your colours, upload your logo, and preview how everything looks before going live.",
  },
  {
    icon: Zap,
    title: "Real-Time Orders",
    desc: "Orders appear on your dashboard instantly. Confirm with one tap. It's that simple.",
  },
  {
    icon: Store,
    title: "Built for Restaurants",
    desc: "Categories, pricing, tables — designed around how food businesses actually work.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[#050505] text-[#E5E5E5]">
      {/* Nav */}
      <header className="sticky top-0 z-40 w-full h-16 border-b border-white/10 flex items-center justify-between px-4 sm:px-8 bg-[#080808]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white flex items-center justify-center rounded-sm shrink-0">
            <div className="w-4 h-4 border-2 border-black rotate-45"></div>
          </div>
          <span className="text-lg font-serif italic tracking-tight text-white">Tawla</span>
        </div>
        <Link href="/onboarding">
          <Button size="sm" className="font-bold">
            Get Started
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-8 pt-14 pb-20 sm:pt-20 sm:pb-28">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left — copy */}
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-white/60 backdrop-blur-sm mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Now in development
            </div>
            <h1 className="text-4xl font-serif italic tracking-tight text-white sm:text-5xl lg:text-6xl">
              Your menu, on
              <br />
              every phone.
            </h1>
            <p className="mt-5 text-lg text-white/40 leading-relaxed max-w-md">
              A digital QR menu and ordering system designed for restaurants
              and coffee shops in Tunisia. Simple to set up, beautiful to use.
            </p>
            <div className="mt-8 flex items-center gap-4">
              <Link href="/onboarding">
                <Button size="lg" className="h-12 px-8 font-bold tracking-tight">
                  Start Free Setup
                </Button>
              </Link>
              <span className="text-xs text-white/40 font-mono">No credit card · 2 minutes</span>
            </div>
          </div>

          {/* Right — live phone preview */}
          <div className="flex justify-center lg:justify-end">
            <PhoneMockup
              restaurantName="Velvet & Stone Coffee"
              logo={null}
              brandColor={BRAND_PALETTE[0].value}
              categories={DEMO_CATEGORIES}
              products={DEMO_PRODUCTS}
              cover={COVER_PRESETS[0].url}
              className="scale-[0.9] lg:scale-100 origin-top"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/10 bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 py-16 sm:py-20">
          <p className="text-xs font-mono uppercase tracking-widest text-white/40 text-center mb-12">
            Built for the way you work
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-white/10 bg-[#0D0D0D] p-6 transition-all duration-200 hover:border-white/25"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1A1A1A] border border-white/10">
                  <f.icon className="h-5 w-5 text-white/70" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">{f.title}</h3>
                <p className="mt-1.5 text-xs text-white/40 leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-8 py-6">
          <span className="text-xs text-white/40">
            © {new Date().getFullYear()} Tawla
          </span>
          <span className="text-xs text-white/40">
            Made for restaurants in Tunisia
          </span>
        </div>
      </footer>
    </div>
  );
}