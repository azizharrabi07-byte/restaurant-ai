// ── Types & static data (no "use client" — importable from server components) ──

export interface BrandColor {
  id: string;
  name: string;
  value: string;
  accentBg?: string;
  category?: string;
}

export interface CoverPreset {
  id: string;
  label: string;
  url: string;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  image: string | null;
  isAvailable: boolean;
}

export type BusinessType = "cafe" | "restaurant" | "bar" | "bakery" | "other";

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "cafe", label: "Café" },
  { value: "restaurant", label: "Restaurant" },
  { value: "bar", label: "Bar / Lounge" },
  { value: "bakery", label: "Bakery" },
  { value: "other", label: "Other" },
];

export type MenuTheme = "classic" | "minimal" | "vibrant" | "gallery";

export const MENU_THEMES: {
  id: MenuTheme;
  label: string;
  description: string;
}[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Serif title, pill category chips, image row cards. Balanced and familiar.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Clean mono type, hairline separators, images hidden, quiet and calm.",
  },
  {
    id: "vibrant",
    label: "Vibrant",
    description: "Big serif headline, accent-filled blocks, image-first cards with edge tint.",
  },
  {
    id: "gallery",
    label: "Gallery",
    description: "Large 4:3 photos on top of every dish, bold prices, editorial feel.",
  },
];

export function isMenuTheme(value: unknown): value is MenuTheme {
  return (
    value === "classic" ||
    value === "minimal" ||
    value === "vibrant" ||
    value === "gallery"
  );
}

export interface OnboardingState {
  restaurantName: string;
  tagline: string;
  businessType: BusinessType;
  logo: string | null;
  cover: string | null;
  brandColor: BrandColor;
  theme: MenuTheme;
  categories: Category[];
  products: Product[];
}

// ── Operations domain (owner dashboard / worker dashboard) ─────────

export type OrderStatus = "pending" | "accepted" | "paid";

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  number: number;
  table: number;
  placedAt: string;
  hour: number;
  status: OrderStatus;
  isPaid: boolean;
  items: OrderItem[];
  total: number;
}

export type WorkerRole = "Cashier" | "Manager";

export interface Worker {
  id: string;
  name: string;
  role: WorkerRole;
  joinedAt: string;
}

export interface WorkerInvite {
  id: string;
  token: string;
  role: WorkerRole;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted";
}

export interface MenuTable {
  id: string;
  number: number;
  token: string;
}

export interface AppState extends OnboardingState {
  tables: MenuTable[];
  workers: Worker[];
  invites: WorkerInvite[];
  orders: Order[];
}

export const DEFAULT_COLOR: BrandColor = {
  id: "amber",
  name: "Amber Roast",
  value: "#D97706",
  accentBg: "rgba(217, 119, 6, 0.15)",
  category: "Warm",
};

export const BRAND_PALETTE: BrandColor[] = [
  { id: "amber", name: "Amber Roast", value: "#D97706", accentBg: "rgba(217, 119, 6, 0.15)", category: "Warm" },
  { id: "terracotta", name: "Terracotta Clay", value: "#E05A47", accentBg: "rgba(224, 90, 71, 0.15)", category: "Warm" },
  { id: "emerald", name: "Sage Botanical", value: "#059669", accentBg: "rgba(5, 150, 105, 0.15)", category: "Natural" },
  { id: "burgundy", name: "Bordeaux Noir", value: "#9F1239", accentBg: "rgba(159, 18, 57, 0.15)", category: "Luxe" },
  { id: "indigo", name: "Deep Indigo", value: "#4F46E5", accentBg: "rgba(79, 70, 229, 0.15)", category: "Modern" },
  { id: "slate", name: "Nordic Charcoal", value: "#334155", accentBg: "rgba(51, 65, 85, 0.15)", category: "Minimal" },
  { id: "copper", name: "Burnt Sienna", value: "#B45309", accentBg: "rgba(180, 83, 9, 0.15)", category: "Warm" },
  { id: "gold", name: "Champagne Gold", value: "#CA8A04", accentBg: "rgba(202, 138, 4, 0.15)", category: "Luxe" },
];

export const LOGO_PRESETS: CoverPreset[] = [
  {
    id: "coffee-cup",
    label: "Coffee Cup Icon",
    url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=200&q=80",
  },
  {
    id: "croissant",
    label: "Bakery Emblem",
    url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=200&q=80",
  },
  {
    id: "plate",
    label: "Culinary Dish",
    url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=200&q=80",
  },
];

export const COVER_PRESETS: CoverPreset[] = [
  {
    id: "morning-counter",
    label: "Morning Counter",
    url: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "bakery-spread",
    label: "Bakery Spread",
    url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "minimal-interior",
    label: "Warm Minimalist Dining",
    url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "bistro-mood",
    label: "Atmospheric Bistro",
    url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "cocktail-lounge",
    label: "Craft Bar & Cocktails",
    url: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=1200&q=80",
  },
];

export const INITIAL_STATE: OnboardingState = {
  restaurantName: "",
  tagline: "",
  businessType: "cafe",
  logo: null,
  cover: null,
  brandColor: DEFAULT_COLOR,
  theme: "classic",
  categories: [],
  products: [],
};

const CAT_ESP = "10000000-0000-4000-8000-000000000001";
const CAT_COLD = "10000000-0000-4000-8000-000000000002";
const CAT_PAST = "10000000-0000-4000-8000-000000000003";
const CAT_BRUN = "10000000-0000-4000-8000-000000000004";

export const DEMO_STATE: OnboardingState = {
  restaurantName: "Velvet & Stone Coffee",
  tagline: "Single-origin coffee, slow mornings, warm corners.",
  businessType: "cafe",
  logo: LOGO_PRESETS[0]?.url ?? null,
  cover: COVER_PRESETS[0]?.url ?? null,
  brandColor: DEFAULT_COLOR,
  theme: "classic",
  categories: [
    { id: CAT_ESP, name: "Espresso & Pourovers", position: 0 },
    { id: CAT_COLD, name: "Cold Brew & Iced", position: 1 },
    { id: CAT_PAST, name: "Pastries & Sourdough", position: 2 },
    { id: CAT_BRUN, name: "Artisan Brunch", position: 3 },
  ],
  products: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Oat Cortado (Ethiopia Guji)",
      description: "Pulled short with oat milk under a thin layer of microfoam.",
      price: 4.75,
      categoryId: CAT_ESP,
      image: "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      name: "Vanilla Bean Cold Foam Brew",
      description: "Slow-steeped cold brew topped with vanilla salted cold foam.",
      price: 5.5,
      categoryId: CAT_COLD,
      image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      name: "Pistachio Cardamom Croissant",
      description: "Hand-laminated, filled with pistachio cream and cardamom sugar.",
      price: 5.25,
      categoryId: CAT_PAST,
      image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000004",
      name: "Avocado & Yuzu Sourdough Toast",
      description: "Smashed avocado, yuzu dressing and chili crunch on toasted sourdough.",
      price: 13.5,
      categoryId: CAT_BRUN,
      image: "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000005",
      name: "Single Origin Batch Brew",
      description: "Today's rotating single origin, brewed in small batches.",
      price: 4.0,
      categoryId: CAT_ESP,
      image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000006",
      name: "Wild Berry Matcha Latte",
      description: "Ceremonial matcha with a swirl of wild berry compote.",
      price: 6.0,
      categoryId: CAT_COLD,
      image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=600&q=80",
      isAvailable: true,
    },
  ],
};

// ── Map tables (generated per restaurant) ──────────────────────────
// Tables are created by the owner via `generateTables` and persisted to
// Supabase. There is intentionally no bundled seed — real data only.