"use client";

import { useI18n, type AppLang, type AppCurrency } from "@/lib/i18n";

export type LandingLang = AppLang;
export type LandingCurrency = AppCurrency;

/**
 * Captions for the landing page's phone mock-up. Five of these deliberately do
 * NOT reuse the `g_*` keys: the mock-up is a marketing caption, not the real
 * menu chrome — `all` is "All Items" (the real one is `g_all` = "All ({n})" and
 * would render the placeholder raw here), `search` and `open_now` are title-case
 * variants, and `dine_in` reuses the demo table. Do not "de-duplicate" these
 * against `g_*` without re-checking the rendered copy.
 */
export const LANDING_PHONE_LABELS: Record<
  LandingLang,
  {
    search: string;
    all: string;
    add: string;
    open_now: string;
    dine_in: string;
    type: string;
    scan: string;
    viewport: string;
    no_items: string;
    add_prompt: string;
  }
> = {
  en: {
    search: "Search dishes, coffees, drinks...",
    all: "All Items",
    add: "Add",
    open_now: "Open Now",
    dine_in: "Table 04 · Dine-In",
    type: "Café & Kitchen",
    scan: "Scan to order",
    viewport: "Customer Mobile Viewport (375 × 667)",
    no_items: "No menu items found",
    add_prompt: "Try adjusting your search terms",
  },
  fr: {
    search: "Rechercher plats, cafés, boissons...",
    all: "Tout",
    add: "Ajouter",
    open_now: "Ouvert",
    dine_in: "Table 04 · Sur place",
    type: "Café & Cuisine",
    scan: "Scanner & commander",
    viewport: "Aperçu mobile client (375 × 667)",
    no_items: "Aucun article trouvé",
    add_prompt: "Essayez d'autres termes de recherche",
  },
  ar: {
    search: "ابحث عن أطباق، قهوة، مشروبات...",
    all: "الكل",
    add: "أضف",
    open_now: "مفتوح الآن",
    dine_in: "الطاولة 04 · للاستهلاك داخل المكان",
    type: "مقهى ومطبخ",
    scan: "امسح الطلب",
    viewport: "معاينة الجوال لدى الزبون (375 × 667)",
    no_items: "لا توجد عناصر في المنيو",
    add_prompt: "جرّب تعديل كلمات البحث",
  },
};

const DEMO_CATEGORIES_EN = [
  { id: "1", name: "Espresso & Pourovers", position: 0 },
  { id: "2", name: "Cold Brew & Iced", position: 1 },
  { id: "3", name: "Pastries", position: 2 },
];

const DEMO_CATEGORIES_FR = [
  { id: "1", name: "Espresso & Filtres", position: 0 },
  { id: "2", name: "Cold Brew & Glacés", position: 1 },
  { id: "3", name: "Pâtisseries", position: 2 },
];

const DEMO_CATEGORIES_AR = [
  { id: "1", name: "إسبريسو وفلاتر", position: 0 },
  { id: "2", name: "باردة ومثلجة", position: 1 },
  { id: "3", name: "معجنات", position: 2 },
];

export interface LandingProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  image: string | null;
  isAvailable: boolean;
}

const DEMO_PRODUCTS_EN: LandingProduct[] = [
  { id: "1", name: "Oat Cortado", description: "Pulled short with oat milk and silky microfoam.", price: 2.5, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "Batch Brew", description: "Today's rotating single origin, brewed fresh.", price: 2.2, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "Vanilla Cold Foam Brew", description: "Slow-steeped cold brew with salted foam.", price: 3.0, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "Berry Matcha Latte", description: "Ceremonial matcha with wild berry compote.", price: 3.5, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "Pistachio Croissant", description: "Hand-laminated with pistachio cream.", price: 2.8, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
];

const DEMO_PRODUCTS_FR: LandingProduct[] = [
  { id: "1", name: "Cortado au lait d'avoine", description: "Un court avec du lait d'avoine et un microfoam soyeux.", price: 2.5, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "Café du jour", description: "Origine unique, infusé à votre goût.", price: 2.2, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "Cold Brew & mousse vanille", description: "Cold brew lentement infusé, mousse vanillée.", price: 3.0, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "Matcha aux fruits rouges", description: "Matcha cérémonial et compote de fruits rouges.", price: 3.5, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "Croissant à la pistache", description: "Feuilleté main, crème de pistache.", price: 2.8, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
];

const DEMO_PRODUCTS_AR: LandingProduct[] = [
  { id: "1", name: "كورتادو بحليب الشوفان", description: "قهوة قصيرة بحليب الشوفان ورغوة ناعمة.", price: 2.5, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "قهوة اليوم", description: "بن أحادي الأصل، طازج التحضير.", price: 2.2, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "كولد برو بكريمة الفانيليا", description: "كولد برو مخمّر ببطء مع كريمة مالحة.", price: 3.0, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "ماتشا بالتوت البري", description: "ماتشا احتفالية مع كومبوت التوت.", price: 3.5, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "كرواسون الفستق", description: "رقائق يدوية بكريمة الفستق.", price: 2.8, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
];

export const LANDING_COVER =
  "https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=1400&q=80&auto=format&fit=crop";

export function landingProducts(lang: LandingLang): LandingProduct[] {
  if (lang === "fr") return DEMO_PRODUCTS_FR;
  if (lang === "ar") return DEMO_PRODUCTS_AR;
  return DEMO_PRODUCTS_EN;
}

export function landingCategories(lang: LandingLang) {
  if (lang === "fr") return DEMO_CATEGORIES_FR;
  if (lang === "ar") return DEMO_CATEGORIES_AR;
  return DEMO_CATEGORIES_EN;
}

interface LandingContextValue {
  lang: LandingLang;
  setLang: (l: LandingLang) => void;
  cur: LandingCurrency;
  setCur: (c: LandingCurrency) => void;
  t: (key: string) => string;
  formatPrice: (base: number) => string;
  isAr: boolean;
}

export function LandingProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useLanding(): LandingContextValue {
  const { lang, setLang, cur, setCur, t, formatPrice, isAr } = useI18n();
  return { lang, setLang, cur, setCur, t, formatPrice, isAr };
}