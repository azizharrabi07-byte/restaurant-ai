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
  price: number;
  categoryId: string;
  image: string | null;
}

export interface OnboardingState {
  restaurantName: string;
  logo: string | null;
  cover: string | null;
  brandColor: BrandColor;
  categories: Category[];
  products: Product[];
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
  logo: null,
  cover: null,
  brandColor: DEFAULT_COLOR,
  categories: [],
  products: [],
};

export const DEMO_STATE: OnboardingState = {
  restaurantName: "Velvet & Stone Coffee",
  logo: LOGO_PRESETS[0]?.url ?? null,
  cover: COVER_PRESETS[0]?.url ?? null,
  brandColor: DEFAULT_COLOR,
  categories: [
    { id: "cat-1", name: "Espresso & Pourovers", position: 0 },
    { id: "cat-2", name: "Cold Brew & Iced", position: 1 },
    { id: "cat-3", name: "Pastries & Sourdough", position: 2 },
    { id: "cat-4", name: "Artisan Brunch", position: 3 },
  ],
  products: [
    {
      id: "prod-1",
      name: "Oat Cortado (Ethiopia Guji)",
      price: 4.75,
      categoryId: "cat-1",
      image: "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "prod-2",
      name: "Vanilla Bean Cold Foam Brew",
      price: 5.5,
      categoryId: "cat-2",
      image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "prod-3",
      name: "Pistachio Cardamom Croissant",
      price: 5.25,
      categoryId: "cat-3",
      image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "prod-4",
      name: "Avocado & Yuzu Sourdough Toast",
      price: 13.5,
      categoryId: "cat-4",
      image: "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "prod-5",
      name: "Single Origin Batch Brew",
      price: 4.0,
      categoryId: "cat-1",
      image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "prod-6",
      name: "Wild Berry Matcha Latte",
      price: 6.0,
      categoryId: "cat-2",
      image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=600&q=80",
    },
  ],
};