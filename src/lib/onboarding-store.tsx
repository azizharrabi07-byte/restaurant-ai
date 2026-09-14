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
import { mergeMenuImport, type MenuImportResult } from "@/lib/menu-import";
import { slugify } from "@/lib/utils";

const WORKER_KEY = "sufra.worker";

export type SavingState =
  | "idle"
  | "saving"
  | "saved"
  | "local"
  | "empty"
  | "hydration_failed"
  | "error";

/** The server's rejection, kept verbatim so the UI can explain it. */
export interface SaveError {
  code: string;
  message: string;
}

/**
 * Whether the store's copy of the menu came from the server. `failed` is a
 * distinct state from `empty`: a restaurant with no menu yet may be edited and
 * saved, while a failed hydration must not be autosaved over (FE-13c).
 */
export type HydrationState = "pending" | "cloud" | "local" | "failed";

interface OnboardingCtx extends AppState {
  restaurantId: string | null;
  savingState: SavingState;
  /** Set only when the last save was rejected/failed; `code` is the server's. */
  lastSaveError: SaveError | null;
  isCloud: boolean;
  hydrationState: HydrationState;
  hydrationFailed: boolean;
  /**
   * Slug pinned for this restaurant — the server's stored value once the row
   * exists, or an explicitly chosen one before it does. `null` lets the server
   * derive (and disambiguate) the slug from the name on first insert.
   */
  restaurantSlug: string | null;
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
  /** `null` when the menu is live on the server, otherwise why it is not. */
  saveNow: () => Promise<SaveError | null>;
  setRestaurantSlug: (slug: string) => void;
  loadDemo: () => void;
  resetAll: () => void;
  importMenuFromScan: (scan: MenuImportResult) => void;
  generateTables: (count: number) => void;
  removeTable: (id: string) => void;
  acceptOrder: (id: string) => void;
  markOrderPaid: (id: string) => void;
  createInvite: (role: WorkerRole, token: string) => void;
  acceptInvite: (token: string, name: string) => void;
  removeInvite: (id: string) => void;
}

const OnboardingContext = createContext<OnboardingCtx | null>(null);

/**
 * The server returns machine codes, not owner-facing copy. Known codes map to
 * their own sentence; everything else falls back to a generic failure so the
 * owner is never shown a transport error for a server rejection.
 */
function saveErrorMessage(
  code: string,
  serverMessage: string | undefined,
  t: (key: string) => string,
): string {
  if (code === "SLUG_TAKEN") return t("save_errorSlugTaken");
  if (code === "NETWORK") return t("save_errorNetwork");
  if (serverMessage && serverMessage.trim()) return serverMessage;
  return t("save_errorServer");
}

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

/** Synchronous best-effort snapshot — also used at page-hide time (FE-12). */
function writeLocalSnapshot(payload: unknown): void {
  try {
    localStorage.setItem(MENU_SYNC_KEY, JSON.stringify(payload));
  } catch {
    try {
      localStorage.removeItem(MENU_SYNC_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/** Uses fetch when it can outlive the page, sendBeacon otherwise (FE-12). */
function putMenuKeepalive(payload: unknown): void {
  const body = JSON.stringify(payload);
  try {
    void fetch("/api/menu", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    try {
      navigator.sendBeacon("/api/menu", new Blob([body], { type: "application/json" }));
    } catch {
      /* the local snapshot is already on disk */
    }
  }
}

// ── Provider ───────────────────────────────────────────────────────

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<AppState>(INITIAL_FULL);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantSlug, setRestaurantSlugState] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<SavingState>("idle");
  const [lastSaveError, setLastSaveError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [hydrationState, setHydrationState] = useState<HydrationState>("pending");
  const [workerSession, setWorkerSessionState] = useState<WorkerSession | null>(null);
  const stateRef = useRef<AppState>(state);
  const tRef = useRef(t);
  /**
   * True when the in-memory menu was either read from the server or confirmed
   * by the server to be absent. Autosave refuses to run before that (FE-13c),
   * so a failed hydration can never overwrite a live menu with an empty one.
   */
  const canSaveRef = useRef(false);
  const hydrationFailedRef = useRef(false);
  const hydratingRef = useRef(false);
  const slugRef = useRef<string | null>(null);
  /** Serialized menu at the last save attempt — page-hide compares against it. */
  const snapshotRef = useRef<string>("");

  useEffect(() => {
    stateRef.current = state;
    tRef.current = t;
  }, [state, t]);

  /**
   * Single writer for the menu state. It mirrors the result into `stateRef`
   * synchronously so read-modify-write sequences inside one event handler
   * (create invite → accept invite, generate tables → save now) see each
   * other, and updaters run exactly once instead of once per React attempt.
   */
  const set = useCallback((next: AppState | ((s: AppState) => AppState)) => {
    const value =
      typeof next === "function" ? (next as (s: AppState) => AppState)(stateRef.current) : next;
    stateRef.current = value;
    setState(value);
  }, []);

  const setRestaurantSlug = useCallback((slug: string) => {
    // Normalize here rather than trusting the caller: the server rejects any
    // slug outside `^[a-z0-9-]{0,63}$` with a 400, and an owner typing
    // "Chez Ali" must not produce one.
    const clean = slug.trim() ? slugify(slug).slice(0, 63) : "";
    slugRef.current = clean || null;
    setRestaurantSlugState(clean || null);
  }, []);

  /**
   * The exact body `PUT /api/menu` receives. The slug is pinned once known:
   * the server keeps a stored slug authoritative on update, and pins an
   * explicitly chosen one on first insert (recovering from 409 SLUG_TAKEN).
   */
  const buildPayload = useCallback(() => {
    const payload = menuPayloadFromState(stateRef.current);
    const pinned = slugRef.current;
    if (pinned) payload.restaurant.slug = pinned;
    return payload;
  }, []);

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

  // ── Hydrate from the backend and follow auth changes (FE-08) ─────
  useEffect(() => {
    let alive = true;

    const hydrate = async () => {
      if (hydratingRef.current) return;
      hydratingRef.current = true;
      try {
        // The session is the authority on whether this device has a
        // restaurant: `GET /api/menu` is scoped by the owner cookie but also
        // answers an anonymous caller with an empty 200, which is
        // indistinguishable from "no menu yet".
        let signedIn = false;
        try {
          const sessionRes = await fetch("/api/auth/session");
          if (sessionRes.ok) {
            const session = (await sessionRes.json()) as { cloud?: boolean };
            signedIn = Boolean(session.cloud);
          }
        } catch {
          /* fall through to the menu fetch, which 401s when unauthenticated */
        }
        if (!alive) return;

        let data: MenuGetResponse | null = null;
        try {
          const res = await fetch("/api/menu");
          if (!alive) return;
          if (res.ok) data = (await res.json()) as MenuGetResponse;
          else if (res.status === 401) signedIn = false;
        } catch {
          /* network failure */
        }
        if (!alive) return;

        if (!signedIn) {
          // Local/demo mode. A missing or emptied response is authoritative
          // here ("no menu yet"), so editing and saving remain allowed.
          if (data && !data.restaurant) {
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
            canSaveRef.current = true;
            hydrationFailedRef.current = false;
            setHydrationState("local");
            return;
          }
          canSaveRef.current = false;
          hydrationFailedRef.current = true;
          setHydrationState("failed");
          return;
        }

        if (!data) {
          // Authenticated but the menu could not be read: never let the
          // autosave write this empty-looking state back over the real menu.
          canSaveRef.current = false;
          hydrationFailedRef.current = true;
          setHydrationState("failed");
          return;
        }

        if (!data.restaurant) {
          // Signed in, no restaurant row yet — first save creates it.
          canSaveRef.current = true;
          hydrationFailedRef.current = false;
          setHydrationState("local");
          return;
        }

        set((s) => ({
          ...s,
          restaurantName: data.restaurant!.name,
          tagline: data.restaurant!.tagline,
          businessType: (data.restaurant!.businessType || "cafe") as BusinessType,
          logo: data.restaurant!.logoUrl,
          cover: data.restaurant!.coverUrl,
          brandColor: colorFromHex(data.restaurant!.primaryColor),
          theme: isMenuTheme(data.restaurant!.theme) ? data.restaurant!.theme : "classic",
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
        const storedSlug = data.restaurant.slug;
        if (storedSlug && storedSlug !== slugRef.current) {
          slugRef.current = storedSlug;
          setRestaurantSlugState(storedSlug);
        }
        canSaveRef.current = true;
        hydrationFailedRef.current = false;
        setHydrationState("cloud");
      } finally {
        hydratingRef.current = false;
      }
    };

    void hydrate();

    // A client-side sign-in refreshes the session cookie without remounting
    // this provider, so re-hydrate the moment the document becomes visible
    // again (e.g. the owner returns to the dashboard tab).
    const onVisible = () => {
      if (document.visibilityState === "visible") void hydrate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [set]);

  // ── Persist to Supabase (with local fallback) ────────────────────
  /**
   * Resolves to `null` when the menu is live on the server, or to the reason
   * it is not — so callers that claim success (the wizard's Finish button)
   * can wait for the answer instead of guessing (FE-11).
   */
  const saveNow = useCallback(async (): Promise<SaveError | null> => {
    const current = stateRef.current;
    if (!canSaveRef.current) {
      // No successful hydration: refuse rather than overwrite a live menu
      // with an empty-looking editor (FE-13c).
      const failed = hydrationFailedRef.current;
      setSavingState(failed ? "hydration_failed" : "empty");
      return {
        code: failed ? "NO_HYDRATION" : "EMPTY",
        message: tRef.current(failed ? "save_hydrationFailed" : "save_nothingToSave"),
      };
    }
    if (!hasMenuContent(current)) {
      setSavingState("empty");
      return { code: "EMPTY", message: tRef.current("save_nothingToSave") };
    }

    const payload = buildPayload();
    // Local snapshot is best-effort only: base64 images can exceed the ~5MB
    // quota (QuotaExceededError). That must never kill the server save below.
    writeLocalSnapshot(payload);
    snapshotRef.current = JSON.stringify(payload);

    setSavingState("saving");
    try {
      const res = await fetch("/api/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let result: MenuSyncResult | null = null;
      try {
        result = (await res.json()) as MenuSyncResult;
      } catch {
        /* non-JSON body — the HTTP status below still tells the truth */
      }

      if (res.ok && result?.cloud) {
        if (result.restaurantId) setRestaurantId(result.restaurantId);
        // The restaurant now exists on the server, so this device is in cloud
        // mode without waiting for another hydration (FE-02/FE-08) — and the
        // slug it stored is pinned so later saves cannot drift away from the
        // links already printed from it.
        slugRef.current = payload.restaurant.slug;
        setRestaurantSlugState(payload.restaurant.slug);
        canSaveRef.current = true;
        hydrationFailedRef.current = false;
        setHydrationState("cloud");
        setLastSaveError(null);
        setSavingState("saved");
        return null;
      }

      const code = result?.error ?? `HTTP_${res.status}`;
      if (res.ok || code === "NO_OWNER") {
        // Server reachable but no backend/session behind it — this device
        // only. There is nothing to verify, so this is not a rejection.
        setLastSaveError(null);
        setSavingState("local");
        return { code, message: tRef.current("save_signIn") };
      }
      if (code === "UNAUTHORIZED") {
        // The session expired mid-session: signing in is the recovery.
        setLastSaveError(null);
        setSavingState("local");
        return { code, message: tRef.current("save_signIn") };
      }
      const failure = { code, message: saveErrorMessage(code, undefined, tRef.current) };
      setLastSaveError(failure);
      setSavingState("error");
      return failure;
    } catch {
      const failure = { code: "NETWORK", message: tRef.current("save_errorNetwork") };
      setLastSaveError(failure);
      setSavingState("error");
      return failure;
    }
  }, [buildPayload]);

  // Debounced autosave on any menu change (after a successful hydration).
  useEffect(() => {
    if (!canSaveRef.current) return;
    // The hydrated view is already what local storage holds — nothing to flush.
    if (!snapshotRef.current) snapshotRef.current = JSON.stringify(buildPayload());
    const timer = setTimeout(() => {
      void saveNow();
    }, 900);
    return () => clearTimeout(timer);
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
    hydrationState,
    saveNow,
    set,
    buildPayload,
  ]);

  // ── Flush a pending edit when the page goes away (FE-12) ─────────
  useEffect(() => {
    const flush = () => {
      const payload = buildPayload();
      const serialized = JSON.stringify(payload);
      // Synchronous: the snapshot must land while the page can still run.
      writeLocalSnapshot(payload);
      if (!canSaveRef.current || serialized === snapshotRef.current) return;
      putMenuKeepalive(payload);
      snapshotRef.current = serialized;
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [buildPayload]);

  // ── Restaurant identity ───────────────────────────────────────────
  const setRestaurantName = useCallback(
    (restaurantName: string) => set((s) => ({ ...s, restaurantName })),
    [set],
  );
  const setTagline = useCallback(
    (tagline: string) => set((s) => ({ ...s, tagline })),
    [set],
  );
  const setBusinessType = useCallback(
    (businessType: BusinessType) => set((s) => ({ ...s, businessType })),
    [set],
  );
  const setLogo = useCallback(
    (logo: string | null) => set((s) => ({ ...s, logo })),
    [set],
  );
  const setCover = useCallback(
    (cover: string | null) => set((s) => ({ ...s, cover })),
    [set],
  );
  const setBrandColor = useCallback(
    (brandColor: BrandColor) => set((s) => ({ ...s, brandColor })),
    [set],
  );
  const setTheme = useCallback(
    (theme: MenuTheme) => set((s) => ({ ...s, theme })),
    [set],
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
    [set],
  );
  const updateCategory = useCallback(
    (id: string, name: string) =>
      set((s) => ({
        ...s,
        categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
      })),
    [set],
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
    [set],
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
    [set],
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
    [set],
  );
  const updateProduct = useCallback(
    (id: string, patch: Partial<Omit<Product, "id">>) =>
      set((s) => ({
        ...s,
        products: s.products.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      })),
    [set],
  );
  const removeProduct = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        products: s.products.filter((p) => p.id !== id),
      })),
    [set],
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
  }, [t, set]);
  const resetAll = useCallback(() => set(INITIAL_FULL), [set]);

  // ── Scan → import into the wizard (canonical whole-menu merge) ─────
  const importMenuFromScan = useCallback((scan: MenuImportResult) => {
    set((s) => {
      const u = uid;
      const merged = mergeMenuImport(
        { categories: s.categories, products: s.products },
        scan,
        u,
      );
      return { ...s, categories: merged.categories, products: merged.products };
    });
  }, [set]);

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
              // 64-bit token (16 hex chars): unpredictable, not derived from
              // the table number or anything guessable.
              token: uid().replace(/-/g, "").slice(0, 16),
            };
          }),
        };
      }),
    [set],
  );
  const removeTable = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        tables: s.tables.filter((t) => t.id !== id),
      })),
    [set],
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
    [set],
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
    [set],
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
            // Instants, never localized copy: the display side formats these
            // for the reader's language (I18N-10).
            createdAt: new Date().toISOString(),
            // 24h, matching `INVITE_TTL_MS` in src/lib/worker-invite.ts, which
            // cannot be imported here (it pulls in node:crypto for the token).
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            status: "pending",
          },
          ...s.invites,
        ],
      })),
    [set],
  );
  const acceptInvite = useCallback(
    (token: string, name: string) => {
      // The worker identity must not be minted inside a state updater: React
      // may invoke updaters more than once (StrictMode, concurrent renders),
      // which would run the localStorage write and the session change twice.
      const invite = stateRef.current.invites.find(
        (i) => i.token === token && i.status === "pending",
      );
      if (!invite) return;

      const workerId = uid();
      const workerName = name.trim() || invite.role;
      setWorkerSession({ id: workerId, name: workerName, role: invite.role });
      set((s) => {
        const current = s.invites.find((i) => i.id === invite.id);
        if (!current || current.status !== "pending") return s;
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
              joinedAt: new Date().toISOString(),
            },
          ],
        };
      });
    },
    [setWorkerSession, set],
  );
  const removeInvite = useCallback(
    (id: string) =>
      set((s) => ({
        ...s,
        invites: s.invites.filter((i) => i.id !== id),
      })),
    [set],
  );

  // The session, not "a restaurant row happens to exist", decides cloud mode:
  // it is the same authority the API routes use, and unlike a mount-once
  // fetch it is re-read whenever auth changes (FE-08).
  const isCloud = hydrationState === "cloud" && restaurantId !== null;
  const hydrationFailed = hydrationState === "failed";

  return (
    <OnboardingContext.Provider
      value={{
        ...state,
        restaurantId,
        restaurantSlug,
        savingState,
        lastSaveError,
        hydrationState,
        hydrationFailed,
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
        setRestaurantSlug,
        loadDemo,
        resetAll,
        importMenuFromScan,
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