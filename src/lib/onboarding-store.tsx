"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  INITIAL_STATE,
  DEMO_STATE,
  isMenuTheme,
  type AppState,
  type BrandColor,
  type BusinessType,
  type MenuTheme,
  type Product,
  type WorkerRole,
  type WorkerSession,
} from "@/lib/constants";
import {
  MENU_SYNC_KEY,
  colorFromHex,
  menuPayloadFromState,
  type MenuGetResponse,
  type MenuSyncResult,
} from "@/lib/menu-mapping";
import { useI18n } from "@/lib/i18n";

const WORKER_KEY = "sufra.worker";

export type SavingState = "idle" | "saving" | "saved" | "local" | "error";

interface OnboardingCtx extends AppState {
  restaurantId: string | null;
  savingState: SavingState;
  isCloud: boolean;
  workerSession: WorkerSession | null;
  setWorkerSession: (w: WorkerSession | null) => void;
  setRestaurantName: (v: string) => void;
  setTagline: (v: string) => void;
  setBusinessType: (v: BusinessType) => void;
  setLogo: (v: string | null) => void;
  setCover: (v: string | null) => void;
  setBrandColor: (v: BrandColor) => void;
  setTheme: (v: MenuTheme) => void;
  addCategory: (name: string) => void;
  updateCategory: (id: string, name: string) => void;
  removeCategory: (id: string) => void;
  moveCategory: (id: string, dir: -1 | 1) => void;
  addProduct: (p: Omit<Product, "id">) => void;
  updateProduct: (id: string, p: Partial<Omit<Product, "id">>) => void;
  removeProduct: (id: string) => void;
  saveNow: () => Promise<void>;
  loadDemo: () => void;
  resetAll: () => void;
  generateTables: (count: number) => void;
  removeTable: (id: string) => void;
  acceptOrder: (id: string) => void;
  markOrderPaid: (id: string) => void;
  createInvite: (role: WorkerRole, token: string) => void;
  acceptInvite: (token: string, name: string) => void;
  removeInvite: (id: string) => void;
}

const OnboardingContext = createContext<OnboardingCtx | null>(null);

const uid = () => crypto.randomUUID();

const opsDefaults = {
  tables: [] as AppState["tables"],
  workers: [] as AppState["workers"],
  invites: [] as AppState["invites"],
  orders: [] as AppState["orders"],
};

const INITIAL_FULL: AppState = { ...INITIAL_STATE, ...opsDefaults };

const hasMenuContent = (s: AppState) =>
  s.restaurantName.trim().length > 0 || s.categories.length > 0 || s.products.length > 0;

// ── Provider ───────────────────────────────────────────────────────

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, set] = useState<AppState>(INITIAL_FULL);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<SavingState>("idle");
  const [workerSession, setWorkerSessionState] = useState<WorkerSession | null>(null);
  const hydratedRef = useRef(false);
  const stateRef = useRef<AppState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Restore the worker identity from local storage once at startup.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKER_KEY);
      if (raw) {
        const w = JSON.parse(raw) as WorkerSession;
        if (w && typeof w.id === "string" && w.id) setWorkerSessionState(w);
      }
    } catch {
      /* corrupted/private mode — ignore */
    }
  }, []);

  const setWorkerSession = useCallback((w: WorkerSession | null) => {
    setWorkerSessionState(w);
    try {
      if (w) window.localStorage.setItem(WORKER_KEY, JSON.stringify(w));
      else window.localStorage.removeItem(WORKER_KEY);
    } catch {
      /* private mode */
    }
  }, []);

  // ── Hydrate from the backend once at startup ─────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/menu");
        if (!res.ok) throw new Error("menu fetch failed");
        const data = (await res.json()) as MenuGetResponse;
        if (!alive) return;

        if (data.restaurant) {
          set((s) => ({
            ...s,
            restaurantName: data.restaurant!.name,
            tagline: data.restaurant!.tagline,
            businessType: (data.restaurant!.businessType || "cafe") as BusinessType,
            logo: data.restaurant!.logoUrl,
            cover: data.restaurant!.coverUrl,
            brandColor: colorFromHex(data.restaurant!.primaryColor),
            theme: isMenuTheme(data.restaurant!.theme)
              ? data.restaurant!.theme
              : "classic",
            categories: data.categories,
            products: data.products.map((p) => ({
              id: p.id,
              categoryId: p.categoryId,
              name: p.name,
              description: p.description,
              price: p.price,
              image: p.imageUrl,
              isAvailable: p.isAvailable,
            })),
            tables: data.tables,
          }));
          setRestaurantId(data.restaurant.id);
        } else {
          const raw = localStorage.getItem(MENU_SYNC_KEY);
          if (raw) {
            try {
              const saved = JSON.parse(raw) as MenuGetResponse;
              if (saved.restaurant) {
                set((s) => ({
                  ...s,
                  restaurantName: saved.restaurant!.name,
                  tagline: saved.restaurant!.tagline ?? "",
                  businessType: (saved.restaurant!.businessType || "cafe") as BusinessType,
                  logo: saved.restaurant!.logoUrl,
                  cover: saved.restaurant!.coverUrl,
                  brandColor: colorFromHex(saved.restaurant!.primaryColor),
                  theme: isMenuTheme(saved.restaurant!.theme)
                    ? saved.restaurant!.theme
                    : "classic",
                  categories: saved.categories ?? [],
                  products: (saved.products ?? []).map((p) => ({
                    id: p.id,
                    categoryId: p.categoryId,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    image: p.imageUrl,
                    isAvailable: p.isAvailable,
                  })),
                  tables: saved.tables ?? [],
                }));
              }
            } catch {
              /* corrupted local copy — ignore */
            }
          }
        }
      } catch {
        /* offline — keep defaults */
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Persist to Supabase (with local fallback) ────────────────────
  const saveNow = useCallback(async () => {
    const current = stateRef.current;
    if (!hasMenuContent(current)) return;

    const payload = menuPayloadFromState(current);
    localStorage.setItem(MENU_SYNC_KEY, JSON.stringify(payload));

    setSavingState("saving");
    try {
      const res = await fetch("/api/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as MenuSyncResult;
      if (res.ok) {
        if (result.cloud) {
          if (result.restaurantId) setRestaurantId(result.restaurantId);
          setSavingState("saved");
        } else {
          setSavingState("local");
        }
      } else {
        setSavingState(result.error === "NO_OWNER" ? "local" : "error");
      }
    } catch {
      setSavingState("error");
    }
  }, []);

  // Debounced autosave on any menu change (after hydration).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = setTimeout(() => {
      void saveNow();
    }, 900);
    return () => clearTimeout(t);
  }, [
    state.restaurantName,
    state.tagline,
    state.businessType,
    state.brandColor,
    state.logo,
    state.cover,
    state.theme,
    state.categories,
    state.products,
    state.tables,
    saveNow,
  ]);

  // ── Restaurant identity ───────────────────────────────────────────
  const setRestaurantName = useCallback(
    (restaurantName: string) => set((s) => ({ ...s, restaurantName })),
    [],
  );
  const setTagline = useCallback(
    (tagline: string) => set((s) => ({ ...s, tagline })),
    [],
  );
  const setBusinessType = useCallback(
    (businessType: BusinessType) => set((s) => ({ ...s, businessType })),
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
  const setTheme = useCallback(
    (theme: MenuTheme) => set((s) => ({ ...s, theme })),
    [],
  );

  // ── Categories ────────────────────────────────────────────────────
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
        categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
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

  // ── Products ──────────────────────────────────────────────────────
  const addProduct = useCallback(
    (p: Omit<Product, "id">) =>
      set((s) => ({
        ...s,
        products: [
          ...s.products,
          {
            ...p,
            description: p.description ?? "",
            isAvailable: p.isAvailable ?? true,
            id: uid(),
          },
        ],
      })),
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

  const loadDemo = useCallback(() => {
    set((s) => ({
      ...s,
      ...DEMO_STATE,
      restaurantName: t("demo_ven"),
      tagline: t("demo_tag"),
      categories: DEMO_STATE.categories.map((c, i) => ({
        ...c,
        name: t(`demo_cat${i + 1}`),
      })),
      products: DEMO_STATE.products.map((p, i) => ({
        ...p,
        name: t(`demo_p${i + 1}n`),
        description: t(`demo_p${i + 1}d`),
      })),
    }));
  }, [t]);
  const resetAll = useCallback(() => set(INITIAL_FULL), []);

  // ── Operations: tables ──────────────────────────────────────────
  const generateTables = useCallback(
    (count: number) =>
      set((s) => {
        const n = Math.max(1, Math.min(40, count));
        const existing = new Map(s.tables.map((t) => [Number(t.number), t]));
        return {
          ...s,
          tables: Array.from({ length: n }, (_, i) => {
            const num = i + 1;
            const cur = existing.get(num);
            if (cur) return cur;
            return {
              id: uid(),
              number: num,
              token: uid().replace(/-/g, "").slice(0, 8),
            };
          }),
        };
      }),
    [],
  );
  const removeTable = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        tables: s.tables.filter((t) => t.id !== id),
      })),
    [],
  );

  // ── Operations: orders ──────────────────────────────────────────
  const acceptOrder = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id === id && o.status === "pending"
            ? { ...o, status: "accepted" as const }
            : o,
        ),
      })),
    [],
  );
  const markOrderPaid = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id === id && o.status === "accepted"
            ? { ...o, status: "paid" as const, isPaid: true }
            : o,
        ),
      })),
    [],
  );

  // ── Operations: workers & invites ───────────────────────────────
  const createInvite = useCallback(
    (role: WorkerRole, token: string) =>
      set((s) => ({
        ...s,
        invites: [
          {
            id: uid(),
            token,
            role,
            createdAt: "Just now",
            expiresAt: "In 24 hours",
            status: "pending",
          },
          ...s.invites,
        ],
      })),
    [],
  );
  const acceptInvite = useCallback(
    (token: string, name: string) =>
      set((s) => {
        const invite = s.invites.find(
          (i) => i.token === token && i.status === "pending",
        );
        if (!invite) return s;
        const workerId = uid();
        const workerName = name.trim() || invite.role;
        setWorkerSession({ id: workerId, name: workerName, role: invite.role });
        return {
          ...s,
          invites: s.invites.map((i) =>
            i.id === invite.id ? { ...i, status: "accepted" as const } : i,
          ),
          workers: [
            ...s.workers,
            {
              id: workerId,
              name: workerName,
              role: invite.role,
              joinedAt: "Just now",
            },
          ],
        };
      }),
    [setWorkerSession],
  );
  const removeInvite = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        invites: s.invites.filter((i) => i.id !== id),
      })),
    [],
  );

  const isCloud = restaurantId !== null;

  return (
    <OnboardingContext.Provider
      value={{
        ...state,
        restaurantId,
        savingState,
        isCloud,
        workerSession,
        setWorkerSession,
        setRestaurantName,
        setTagline,
        setBusinessType,
        setLogo,
        setCover,
        setBrandColor,
        setTheme,
        addCategory,
        updateCategory,
        removeCategory,
        moveCategory,
        addProduct,
        updateProduct,
        removeProduct,
        saveNow,
        loadDemo,
        resetAll,
        generateTables,
        removeTable,
        acceptOrder,
        markOrderPaid,
        createInvite,
        acceptInvite,
        removeInvite,
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