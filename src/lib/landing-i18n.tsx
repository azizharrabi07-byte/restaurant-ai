"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type LandingLang = "en" | "fr" | "ar";
export type LandingCurrency = "usd" | "eur";

const copy: Record<LandingLang, Record<string, string>> = {
  en: {
    nav_open: "Open the Platform",
    hero_badge: "QR menu & table ordering for restaurants",
    hero_title_a: "Your menu, on",
    hero_title_b: "every phone.",
    hero_sub:
      "Sufra turns your menu into a digital experience — guests scan a QR on their table, browse, and order straight to your dashboard.",
    b1: "No app for guests — it runs in the browser",
    b2: "Orders reach you live, in real time",
    b3: "Set up in minutes, styled like your brand",
    cta: "Start Free Setup",
    how_link: "See how it works",
    how_eyebrow: "How it works",
    how_title: "From table scan to served — in three steps.",
    h1_t: "Build your menu",
    h1_d:
      "Add categories, items and prices in a live builder — colours, logo and layout theme included. Watch the guest preview update as you type.",
    h2_t: "Print table codes",
    h2_d:
      "Generate a unique QR code for every table in one tap. Each code opens that table's menu — no app for your guests to install.",
    h3_t: "Serve live orders",
    h3_d:
      "Guests tap to order and it lands on your dashboard instantly. Accept, update and mark paid from your phone or tablet.",
    f_eyebrow: "Features",
    f_title: "Everything you need to take orders.",
    f1_t: "Instant QR Menus",
    f1_d: "Every table gets its own code. Guests scan, browse and order — no app required.",
    f2_t: "Menu Themes",
    f2_d: "Classic, minimal, vibrant or gallery — pick a layout that matches your venue and your brand.",
    f3_t: "Real-Time Orders",
    f3_d: "Orders appear on the dashboard the second a guest checks out. One tap to accept.",
    f4_t: "Live Phone Preview",
    f4_d: "See exactly what your guests see — menu, prices and hand-off screen — while you edit.",
    f5_t: "Two-Minute Setup",
    f5_d: "No hardware, no printing service, no onboarding calls. Your menu can be live today.",
    f6_t: "Built for Restaurants",
    f6_d: "Categories, pricing, tables and staff roles — designed around how food businesses actually work.",
    cta_eyebrow: "Ready when you are",
    cta_title: "Ask your first guest to scan a code tonight.",
    cta_sub:
      "Build your menu, generate your table codes, and start taking orders — all from the owner platform, no technical setup.",
    cta_note: "No credit card · 2 minutes",
    foot_rights: "© {year} Sufra",
    foot_made: "Made for restaurants in Tunisia",
    cur_label: "Currency",
    lang_label: "Language",
  },
  fr: {
    nav_open: "Ouvrir la Plateforme",
    hero_badge: "Menu QR et commandes à table pour restaurants",
    hero_title_a: "Votre menu, sur",
    hero_title_b: "tous les téléphones.",
    hero_sub:
      "Sufra transforme votre menu en expérience digitale — vos clients scannent un QR à leur table, parcourent, et commandent directement sur votre tableau de bord.",
    b1: "Aucune appli pour vos clients — tout se passe dans le navigateur",
    b2: "Les commandes arrivent en temps réel",
    b3: "Configuré en quelques minutes, à votre image",
    cta: "Commencer gratuitement",
    how_link: "Découvrir le fonctionnement",
    how_eyebrow: "Comment ça marche",
    how_title: "Du scan à la table servie — en trois étapes.",
    h1_t: "Créez votre menu",
    h1_d:
      "Ajoutez catégories, articles et prix dans un éditeur en direct — couleurs, logo et thème inclus. Votre aperçu client se met à jour pendant que vous tapez.",
    h2_t: "Imprimez vos codes",
    h2_d:
      "Générez un QR code unique pour chaque table en un clic. Chaque code ouvre le menu de cette table — aucune installation pour vos clients.",
    h3_t: "Servez en direct",
    h3_d:
      "Dès qu'un client commande, ça apparaît sur votre tableau de bord. Acceptez, modifiez et encaissez depuis votre téléphone ou tablette.",
    f_eyebrow: "Fonctionnalités",
    f_title: "Tout ce qu'il faut pour prendre les commandes.",
    f1_t: "Menus QR instantanés",
    f1_d: "Chaque table a son code. Vos clients scannent, découvrent et commandent — sans appli.",
    f2_t: "Thèmes de menu",
    f2_d: "Classique, minimal, vibrant ou galerie — un rendu qui colle à votre établissement et à votre marque.",
    f3_t: "Commandes en temps réel",
    f3_d: "Les commandes arrivent sur le tableau de bord dès la validation. Un clic pour accepter.",
    f4_t: "Aperçu téléphone en direct",
    f4_d: "Voyez exactement ce que voient vos clients — menu, prix et écran de confirmation — pendant que vous modifiez.",
    f5_t: "Installation en 2 minutes",
    f5_d: "Pas de matériel, pas de service d'impression, pas d'appel d'onboarding. Votre menu peut être en ligne aujourd'hui.",
    f6_t: "Pensé pour les restaurants",
    f6_d: "Catégories, prix, tables et rôles du personnel — conçu autour de la façon dont travaillent vraiment les établissements.",
    cta_eyebrow: "Prêt quand vous l'êtes",
    cta_title: "Demandez à votre premier client de scanner ce soir.",
    cta_sub:
      "Créez votre menu, générez vos codes de table, et commencez à prendre des commandes — tout depuis la plateforme propriétaire.",
    cta_note: "Sans carte bancaire · 2 minutes",
    foot_rights: "© {year} Sufra",
    foot_made: "Conçu pour les restaurants en Tunisie",
    cur_label: "Devise",
    lang_label: "Langue",
  },
  ar: {
    nav_open: "افتح المنصة",
    hero_badge: "منيو QR وطلب من الطاولة للمطاعم",
    hero_title_a: "منيّوك، على",
    hero_title_b: "كل هاتف.",
    hero_sub:
      "سُفرة تحوّل منيّوك إلى تجربة رقمية — يمسح زبونك الـ QR على طاولته، يتصفّح، ويطلب مباشرةً على لوحة التحكم.",
    b1: "بدون تطبيق للزبائن — يعمل في المتصفح مباشرة",
    b2: "الطلبات تصل إليك مباشرةً، لحظة بلحظة",
    b3: "تجهيز في دقائق، وبأسلوب علامتك التجارية",
    cta: "ابدأ الإعداد مجاناً",
    how_link: "شاهد كيف يعمل",
    how_eyebrow: "كيف يعمل",
    how_title: "من المسح عند الطاولة إلى التقديم — في ثلاث خطوات.",
    h1_t: "أنشئ منيّوك",
    h1_d:
      "أضف الأصناف والعناصر والأسعار في أداة مباشرة — الألوان والشعار ونمط العرض. شاهد معاينة الزبون تتحدث أثناء الكتابة.",
    h2_t: "اطبع أكواد الطاولات",
    h2_d:
      "ولّد كود QR فريداً لكل طاولة بضغطة واحدة. كل كود يفتح منيو تلك الطاولة — دون أي تثبيت لزبائنك.",
    h3_t: "استقبل الطلبات فوراً",
    h3_d:
      "يلمس الزبون «أطلب» فتبدأ الطلبات على لوحة التحكم. اقبل، حدّث، واعتبر الطلب مدفوعاً من هاتفك أو جهازك اللوحي.",
    f_eyebrow: "المميزات",
    f_title: "كل ما تحتاجه لاستقبال الطلبات.",
    f1_t: "منيو QR فوري",
    f1_d: "لكل طاولة كود خاص. يمسح الزبون، يتصفّح، ويطلب — بدون أي تطبيق.",
    f2_t: "أنماط للمنيو",
    f2_d: "كلاسيكي، بسيط، نابض أو معرض — اختر التصميم الذي يناسب محلك وعلامتك.",
    f3_t: "طلبات في الوقت الحقيقي",
    f3_d: "تظهر الطلبات على لوحة التحكم فور إرسالها. قبول بضغطة واحدة.",
    f4_t: "معاينة جوال حيّة",
    f4_d: "شاهد تماماً ما يراه زبونك — المنيو والأسعار وشاشة التأكيد — بينما تقوم بالتحرير.",
    f5_t: "تجهيز في دقيقتين",
    f5_d: "لا أجهزة، لا خدمة طباعة، لا مكالمات إعداد. يمكن أن يظهر منيّوك اليوم.",
    f6_t: "مصمَّم للمطاعم",
    f6_d: "أصناف وأسعار وطاولات وأدوار للموظفين — مصمم حول طريقة عمل المطاعم فعلياً.",
    cta_eyebrow: "جاهزون متى كنت",
    cta_title: "اطلب من أول زبون أن يمسح كوداً الليلة.",
    cta_sub:
      "أنشئ منيّوك، ولّد أكواد طاولاتك، وابدأ باستقبال الطلبات — كله من منصة المالك وبدون أي إعداد تقني.",
    cta_note: "بدون بطاقة بنكية · دقيقتان",
    foot_rights: "© {year} سُفرة",
    foot_made: "صُنع للمطاعم في تونس",
    cur_label: "العملة",
    lang_label: "اللغة",
  },
};

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
  { id: "1", name: "Oat Cortado", description: "Pulled short with oat milk and silky microfoam.", price: 4.75, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "Batch Brew", description: "Today's rotating single origin, brewed fresh.", price: 4.0, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "Vanilla Cold Foam Brew", description: "Slow-steeped cold brew with salted foam.", price: 5.5, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "Berry Matcha Latte", description: "Ceremonial matcha with wild berry compote.", price: 6.0, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "Pistachio Croissant", description: "Hand-laminated with pistachio cream.", price: 5.25, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
];

const DEMO_PRODUCTS_FR: LandingProduct[] = [
  { id: "1", name: "Cortado au lait d'avoine", description: "Un court avec du lait d'avoine et un microfoam soyeux.", price: 4.75, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "Café du jour", description: "Origine unique, infusé à votre goût.", price: 4.0, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "Cold Brew & mousse vanille", description: "Cold brew lentement infusé, mousse vanillée.", price: 5.5, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "Matcha aux fruits rouges", description: "Matcha cérémonial et compote de fruits rouges.", price: 6.0, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "Croissant à la pistache", description: "Feuilleté main, crème de pistache.", price: 5.25, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
];

const DEMO_PRODUCTS_AR: LandingProduct[] = [
  { id: "1", name: "كورتادو بحليب الشوفان", description: "قهوة قصيرة بحليب الشوفان ورغوة ناعمة.", price: 4.75, categoryId: "1", image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "2", name: "قهوة اليوم", description: "بن أحادي الأصل، طازج التحضير.", price: 4.0, categoryId: "1", image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "3", name: "كولد برو بكريمة الفانيليا", description: "كولد برو مخمّر ببطء مع كريمة مالحة.", price: 5.5, categoryId: "2", image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "4", name: "ماتشا بالتوت البري", description: "ماتشا احتفالية مع كومبوت التوت.", price: 6.0, categoryId: "2", image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
  { id: "5", name: "كرواسون الفستق", description: "رقائق يدوية بكريمة الفستق.", price: 5.25, categoryId: "3", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80&auto=format&fit=crop", isAvailable: true },
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
  formatPrice: (usd: number) => string;
  isAr: boolean;
}

const LandingContext = createContext<LandingContextValue | null>(null);

const EUR_RATE = 0.92;

export function LandingProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<LandingLang>("en");
  const [cur, setCur] = useState<LandingCurrency>("usd");

  const t = (key: string) => {
    const dict = copy[lang];
    const val = dict[key];
    if (val === undefined) return key;
    return val.replace("{year}", String(new Date().getFullYear()));
  };

  const formatPrice = (usd: number) => {
    if (cur === "eur") return `€${(usd * EUR_RATE).toFixed(2)}`;
    return `$${usd.toFixed(2)}`;
  };

  return (
    <LandingContext.Provider
      value={{
        lang,
        setLang,
        cur,
        setCur,
        t,
        formatPrice,
        isAr: lang === "ar",
      }}
    >
      {children}
    </LandingContext.Provider>
  );
}

export function useLanding(): LandingContextValue {
  const ctx = useContext(LandingContext);
  if (!ctx) throw new Error("useLanding must be used within LandingProvider");
  return ctx;
}