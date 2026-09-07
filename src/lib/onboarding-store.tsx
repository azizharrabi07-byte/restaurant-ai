"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  INITIAL_STATE,
  DEMO_STATE,
  type BrandColor,
  type Category,
  type OnboardingState,
  type Product,
} from "@/lib/constants";

interface OnboardingCtx extends OnboardingState {
  setRestaurantName: (v: string) => void;
  setLogo: (v: string | null) => void;
  setCover: (v: string | null) => void;
  setBrandColor: (v: BrandColor) => void;
  addCategory: (name: string) => void;
  updateCategory: (id: string, name: string) => void;
  removeCategory: (id: string) => void;
  moveCategory: (id: string, dir: -1 | 1) => void;
  addProduct: (p: Omit<Product, "id">) => void;
  updateProduct: (id: string, p: Partial<Omit<Product, "id">>) => void;
  removeProduct: (id: string) => void;
  loadDemo: () => void;
  resetAll: () => void;
}

const OnboardingContext = createContext<OnboardingCtx | null>(null);

const uid = () => crypto.randomUUID();

// ── Provider ───────────────────────────────────────────────────────

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<OnboardingState>(INITIAL_STATE);

  const setRestaurantName = useCallback(
    (restaurantName: string) => set((s) => ({ ...s, restaurantName })),
    [],
  );
  const setLogo = useCallback(
    (logo: string | null) => set((s) => ({ ...s, logo })),
    [],
  );
  const setCover = useCallback(
    (cover: string | null) => set((s) => ({ ...s, cover })),
    [],
  );
  const setBrandColor = useCallback(
    (brandColor: BrandColor) => set((s) => ({ ...s, brandColor })),
    [],
  );

  const addCategory = useCallback(
    (name: string) =>
      set((s) => ({
        ...s,
        categories: [
          ...s.categories,
          { id: uid(), name, position: s.categories.length },
        ],
      })),
    [],
  );

  const updateCategory = useCallback(
    (id: string, name: string) =>
      set((s) => ({
        ...s,
        categories: s.categories.map((c) =>
          c.id === id ? { ...c, name } : c,
        ),
      })),
    [],
  );

  const removeCategory = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        categories: s.categories
          .filter((c) => c.id !== id)
          .map((c, i) => ({ ...c, position: i })),
        products: s.products.filter((p) => p.categoryId !== id),
      })),
    [],
  );

  const moveCategory = useCallback(
    (id: string, dir: -1 | 1) =>
      set((s) => {
        const cats = [...s.categories];
        const idx = cats.findIndex((c) => c.id === id);
        if (idx < 0) return s;
        const target = idx + dir;
        if (target < 0 || target >= cats.length) return s;
        [cats[idx], cats[target]] = [cats[target], cats[idx]];
        return {
          ...s,
          categories: cats.map((c, i) => ({ ...c, position: i })),
        };
      }),
    [],
  );

  const addProduct = useCallback(
    (p: Omit<Product, "id">) =>
      set((s) => ({ ...s, products: [...s.products, { ...p, id: uid() }] })),
    [],
  );

  const updateProduct = useCallback(
    (id: string, patch: Partial<Omit<Product, "id">>) =>
      set((s) => ({
        ...s,
        products: s.products.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      })),
    [],
  );

  const removeProduct = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        products: s.products.filter((p) => p.id !== id),
      })),
    [],
  );

  const loadDemo = useCallback(() => set(DEMO_STATE), []);

  const resetAll = useCallback(() => set(INITIAL_STATE), []);

  return (
    <OnboardingContext.Provider
      value={{
        ...state,
        setRestaurantName,
        setLogo,
        setCover,
        setBrandColor,
        addCategory,
        updateCategory,
        removeCategory,
        moveCategory,
        addProduct,
        updateProduct,
        removeProduct,
        loadDemo,
        resetAll,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingCtx {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used inside OnboardingProvider");
  return ctx;
}