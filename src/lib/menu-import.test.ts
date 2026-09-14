import { describe, it, expect, vi } from "vitest";
import {
  normalizeName,
  normalizeKey,
  sanitizePrice,
  isOcrArtifact,
  isVenueChrome,
  isVenueChromeLine,
  sanitizeImport,
  buildMenuImport,
  mergeMenuImport,
  planMenuImport,
  previewMenuImport,
  reconcileImports,
  UNCATEGORIZED,
  type MenuImportResult,
  type CategoryRow,
  type ProductRow,
} from "./menu-import";

// ── normalizeName ─────────────────────────────────────────────────

describe("normalizeName", () => {
  it("trims whitespace", () => expect(normalizeName("  Espressos  ")).toBe("Espressos"));
  it("collapses internal whitespace", () => expect(normalizeName("Café  Royal")).toBe("Café Royal"));
  it("returns empty string on non-string input", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
    expect(normalizeName(123)).toBe("");
  });
});

// ── normalizeKey ──────────────────────────────────────────────────

describe("normalizeKey", () => {
  it("lowercases", () => expect(normalizeKey("Boissons")).toBe("boissons"));
  it("NFC normalizes composed and decomposed forms alike", () => {
    const composed = normalizeKey("Crème Brûlée");
    const decomposed = normalizeKey("Cre\u0300me Bru\u0302le\u0301e");
    expect(composed).toBe(decomposed);
    expect(composed).toBe(normalizeKey("Crème Brûlée"));
  });
});

// ── sanitizePrice ─────────────────────────────────────────────────

describe("sanitizePrice", () => {
  it("numeric 4.5 stays 4.5", () => expect(sanitizePrice(4.5)).toBe(4.5));
  it("Tunisian string '4.500' → 4.5", () => expect(sanitizePrice("4.500")).toBe(4.5));
  it("Tunisian with DT '16.500 DT' → 16.5", () => expect(sanitizePrice("16.500 DT")).toBe(16.5));
  it("comma-only '4,500' → 4.5", () => expect(sanitizePrice("4,500")).toBe(4.5));
  it("NaN → 0", () => expect(sanitizePrice("abc")).toBe(0));
  it("negative → 0", () => expect(sanitizePrice(-5)).toBe(0));
  it("undefined → 0", () => expect(sanitizePrice(undefined)).toBe(0));
  it("Infinity → 0", () => expect(sanitizePrice(Number.POSITIVE_INFINITY)).toBe(0));
  it("EUR symbol '4.500 €' → 4.5", () => expect(sanitizePrice("4.500 €")).toBe(4.5));
  // OCR-03 / OCR-14: prefix symbols and Arabic-Indic digits were read as 0 with
  // the digits left inside the product name.
  it("prefix '$' → 12.5", () => expect(sanitizePrice("$12.50")).toBe(12.5));
  it("prefix 'US$' → 12", () => expect(sanitizePrice("US$12")).toBe(12));
  it("prefix '€' → 12, consistently with '$'", () => expect(sanitizePrice("€12")).toBe(12));
  it("Arabic-Indic '١٢٫٥' → 12.5", () => expect(sanitizePrice("١٢٫٥")).toBe(12.5));
  it("Arabic-Indic thousands '١٦٬٥٠٠' → 16.5", () =>
    expect(sanitizePrice("١٦٬٥٠٠")).toBe(16.5));
  // The parser reads "1 200" as 1.2 (TND millime convention); the string path
  // must agree, or the same printed price depends on which stage saw it (OCR-02).
  it("space-separated '1 200' → 1.2 (agrees with the parser)", () =>
    expect(sanitizePrice("1 200")).toBe(1.2));
  it("non-breaking space '1\u00A0200' → 1.2", () => expect(sanitizePrice("1\u00A0200")).toBe(1.2));
  // No honest TND conversion exists for these: a clean 0 (rendered "—") beats a
  // plausible-but-wrong price on a live menu.
  it("unconvertible currency '£12' → 0", () => expect(sanitizePrice("£12")).toBe(0));
  it("unconvertible currency '12 GBP' → 0", () => expect(sanitizePrice("12 GBP")).toBe(0));
  it("ambiguous '1,200.50' → 0", () => expect(sanitizePrice("1,200.50")).toBe(0));
  it("'12.5.6' → 0", () => expect(sanitizePrice("12.5.6")).toBe(0));
  it("above the cap clamps to 9999", () => expect(sanitizePrice("9999999")).toBe(9999));
});

// ── isOcrArtifact ─────────────────────────────────────────────────

describe("isOcrArtifact", () => {
  it("[tbl-0.md](tbl-0.md) is an artifact", () =>
    expect(isOcrArtifact("[tbl-0.md](tbl-0.md)")).toBe(true));
  it("tbl-3.md is an artifact", () => expect(isOcrArtifact("tbl-3.md")).toBe(true));
  it("phone number is an artifact", () =>
    expect(isOcrArtifact("+216 71 123 456")).toBe(true));
  it("pure price line is an artifact", () =>
    expect(isOcrArtifact("4.500 DT")).toBe(true));
  it("empty string is an artifact", () => expect(isOcrArtifact("")).toBe(true));
  it("email is an artifact", () =>
    expect(isOcrArtifact("test@example.com")).toBe(true));
  it("legit item is NOT an artifact", () =>
    expect(isOcrArtifact("Brik à l'Œuf")).toBe(false));
  it("A-1 Special is NOT an artifact", () =>
    expect(isOcrArtifact("A-1 Special")).toBe(false));
  it("non-Latin item is NOT an artifact", () =>
    expect(isOcrArtifact("مسخن بالحليب")).toBe(false));
});

// ── isVenueChrome / isVenueChromeLine (captured scan rows) ──────────
//
// Every rejected string below was imported as a PRODUCT by the live run
// (`/tmp/scan1..6.json`): the first four verbatim from the scan results, the
// rest are the same shapes the contact regexes already had to survive.

describe("venue chrome", () => {
  const CHROME_ROWS = [
    "12 Rue de Marseille · Tunis · Tél.", // scan1/2/4, imported at 9999 DT
    "Prix en dinars · Service compris", // scan1/2/4, imported at 0 DT
    "نهج مرسيليا - تونس - الهاتف", // scan3/6, imported at 9999 DT
    "الأسعار بالدينار - الخدمة مشمولة", // scan3/6, imported at 0 DT
    "+216 71 245 890",
    "www.cafe-jasmins.tn",
    "contact@cafe-jasmins.tn",
    "12 Avenue Habib Bourguiba",
  ];

  it("rejects the captured address, footer, phone, URL and e-mail rows", () => {
    for (const row of CHROME_ROWS) {
      expect(isVenueChrome(row)).toBe(true);
      expect(isOcrArtifact(row)).toBe(true);
    }
  });

  it("keeps real dishes, whatever their name looks like", () => {
    for (const dish of [
      "Espresso",
      "Café au lait",
      "Brik à l'Œuf",
      "Homard grillé",
      "مسخن بالحليب",
      "قهوة عربية",
    ]) {
      expect(isVenueChrome(dish)).toBe(false);
      expect(isOcrArtifact(dish)).toBe(false);
    }
  });

  it("treats a priced menu row as a row, never as a phone number", () => {
    // The name-level test cannot be reused on a whole line: a price is a digit
    // run and a dish must survive it.
    expect(isVenueChromeLine("| Couscous royal | 12.500 |")).toBe(false);
    expect(isVenueChromeLine("Assiette tunisienne 6 500")).toBe(false);
    expect(isVenueChromeLine("|  Espresso | 1.200  |")).toBe(false);
    expect(isVenueChromeLine("12 Rue de Marseille · Tunis · Tél. 71 245 890")).toBe(true);
    expect(isVenueChromeLine("71 245 890")).toBe(true);
    expect(isVenueChromeLine("Prix en dinars · Service compris")).toBe(true);
    expect(isVenueChromeLine("الأسعار بالدينار - الخدمة مشمولة")).toBe(true);
  });
});

// ── sanitizeImport ────────────────────────────────────────────────

describe("sanitizeImport", () => {
  it("nested categories shape", () => {
    const { categories, products } = sanitizeImport({
      categories: [
        { name: "Boissons", items: [{ name: "Espresso", description: "", price: 4.5 }] },
      ],
    });
    expect(categories.length).toBe(1);
    expect(categories[0].name).toBe("Boissons");
    expect(products.length).toBe(1);
    expect(products[0].categoryName).toBe("Boissons");
    expect(products[0].price).toBe(4.5);
  });

  it("flat products shape (category field)", () => {
    const { products } = sanitizeImport({
      products: [{ name: "Salade", description: "", price: 5, category: "Entrées" }],
    });
    expect(products[0].categoryName).toBe("Entrées");
  });

  it("flat products shape (categoryName field)", () => {
    const { products } = sanitizeImport({
      products: [{ name: "Salade", description: "", price: 5, categoryName: "Entrées" }],
    });
    expect(products[0].categoryName).toBe("Entrées");
  });

  it("dupes within same category merge", () => {
    const { products } = sanitizeImport({
      categories: [
        {
          name: "Boissons",
          items: [
            { name: "Espresso", description: "", price: 3 },
            { name: "Espresso", description: "Double", price: 5 },
          ],
        },
      ],
    });
    expect(products.length).toBe(1);
    expect(products[0].name).toBe("Espresso");
  });

  it("case/whitespace dedup", () => {
    const { products } = sanitizeImport({
      categories: [
        {
          name: "Boissons",
          items: [
            { name: "Espresso", description: "", price: 3 },
            { name: "espresso", description: "", price: 3 },
            { name: " Espresso ", description: "", price: 3 },
          ],
        },
      ],
    });
    expect(products.length).toBe(1);
  });

  it("uncategorized bucket added for orphan products", () => {
    const { categories, products } = sanitizeImport({
      products: [{ name: "Mystery Item", description: "", price: 1, categoryName: "" }],
    });
    expect(products.length).toBe(1);
    expect(products[0].categoryName).toBe(UNCATEGORIZED);
    expect(categories.some((c) => c.name === UNCATEGORIZED)).toBe(true);
  });

  it("uncategorized bucket NOT added when no orphans", () => {
    const { categories } = sanitizeImport({
      categories: [{ name: "X", items: [{ name: "Y", description: "", price: 1 }] }],
    });
    expect(categories.some((c) => c.name === UNCATEGORIZED)).toBe(false);
  });

  it("price 4.500 DT coerces to 4.5", () => {
    const { products } = sanitizeImport({
      categories: [{ name: "X", items: [{ name: "Y", description: "", price: "4.500 DT" }] }],
    });
    expect(products[0].price).toBe(4.5);
  });

  it("invalid price (NaN string) becomes 0", () => {
    const { products } = sanitizeImport({
      categories: [{ name: "X", items: [{ name: "Y", description: "", price: "not-a-price" }] }],
    });
    expect(products[0].price).toBe(0);
  });

  it("negative price becomes 0", () => {
    const { products } = sanitizeImport({
      categories: [{ name: "X", items: [{ name: "Y", description: "", price: -5 }] }],
    });
    expect(products[0].price).toBe(0);
  });
});

// ── buildMenuImport ───────────────────────────────────────────────

describe("buildMenuImport", () => {
  it("wraps categories + products with stats", () => {
    const r = buildMenuImport(
      { categories: [{ name: "X", items: [{ name: "Y", description: "", price: 1 }] }] },
      { files: 1, pages: 2, source: "ai", model: "mistral-ocr-latest" },
    );
    expect(r.stats.source).toBe("ai");
    expect(r.stats.model).toBe("mistral-ocr-latest");
    expect(r.stats.files).toBe(1);
    expect(r.stats.pages).toBe(2);
    expect(r.categories.length).toBe(1);
    expect(r.products.length).toBe(1);
  });
});

// ── mergeMenuImport ───────────────────────────────────────────────

describe("mergeMenuImport", () => {
  let _id = 0;
  const uid = () => `id-${_id++}`;

  const makeCat = (name: string, pos = 0): CategoryRow => ({
    id: `old-${name}`,
    name,
    position: pos,
  });
  const makeProd = (catId: string, name: string): ProductRow => ({
    id: `old-prod-${name}`,
    categoryId: catId,
    name,
    description: "",
    price: 5,
    image: null,
    isAvailable: true,
  });

  it("merges both categories and products into existing state", () => {
    _id = 0;
    const state = { categories: [], products: [] };
    const result = buildMenuImport(
      { categories: [{ name: "A", items: [{ name: "X", description: "", price: 1 }] }] },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const merged = mergeMenuImport(state, result, uid);
    expect(merged.categories.length).toBe(1);
    expect(merged.products.length).toBe(1);
    expect(merged.products[0].categoryId).toBe(merged.categories[0].id);
  });

  it("category relationship survives merge by normalized-name lookup", () => {
    _id = 0;
    const state = { categories: [makeCat("Boissons")], products: [makeProd("old-Boissons", "Café")] };
    const result = buildMenuImport(
      {
        categories: [
          { name: "Boissons", items: [{ name: "Espresso", description: "", price: 3 }] },
          { name: "Desserts", items: [{ name: "Tarte", description: "", price: 8 }] },
        ],
      },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const merged = mergeMenuImport(state, result, uid);
    expect(merged.categories.length).toBe(2);
    expect(merged.products.length).toBe(3);
    const boissons = merged.categories.find((c) => c.name === "Boissons")!;
    expect(merged.products.find((p) => p.name === "Espresso")!.categoryId).toBe(boissons.id);
    expect(merged.products.find((p) => p.name === "Café")!.categoryId).toBe(boissons.id);
  });

  it("dup categories with same normalized name merge", () => {
    _id = 0;
    const state = { categories: [], products: [] };
    const result = buildMenuImport(
      {
        categories: [
          { name: "boissons", items: [{ name: "E", description: "", price: 2 }] },
          { name: "Boissons", items: [{ name: "C", description: "", price: 3 }] },
        ],
      },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const merged = mergeMenuImport(state, result, uid);
    expect(merged.categories.length).toBe(1);
    expect(merged.products.length).toBe(2);
  });

  it("dup products within same category merge", () => {
    _id = 0;
    const state = { categories: [], products: [] };
    const result = buildMenuImport(
      {
        categories: [
          {
            name: "Boissons",
            items: [
              { name: "Espresso", description: "", price: 3 },
              { name: "espresso", description: "D", price: 4 },
            ],
          },
        ],
      },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const merged = mergeMenuImport(state, result, uid);
    expect(merged.products.length).toBe(1);
    expect(merged.products[0].price).toBe(3);
  });

  it("missing category puts product into Uncategorized", () => {
    _id = 0;
    const state = { categories: [], products: [] };
    const result: import("./menu-import").MenuImportResult = {
      categories: [],
      products: [
        { name: "Mystery", description: "", price: 5, categoryName: "Phantom Category" },
      ],
      stats: { files: 1, pages: 0, source: "ai", model: "m" },
    };
    const merged = mergeMenuImport(state, result, uid);
    expect(merged.categories.some((c) => c.name === UNCATEGORIZED)).toBe(true);
    const unc = merged.categories.find((c) => c.name === UNCATEGORIZED)!;
    expect(merged.products[0].categoryId).toBe(unc.id);
  });

  it("Categories-step and Products-step merges are identical (same input)", () => {
    _id = 0;
    const state = { categories: [makeCat("Boissons")], products: [] };
    const result = buildMenuImport(
      {
        categories: [
          { name: "Boissons", items: [{ name: "Jus", description: "", price: 2 }] },
          { name: "Plats", items: [{ name: "Couscous", description: "", price: 10 }] },
        ],
      },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    _id = 0;
    const a = mergeMenuImport(
      { categories: [...state.categories], products: [...state.products] },
      result,
      uid,
    );
    _id = 0;
    const b = mergeMenuImport(
      { categories: [...state.categories], products: [...state.products] },
      result,
      uid,
    );
    expect(a.categories.length).toBe(b.categories.length);
    expect(a.products.length).toBe(b.products.length);
    expect(a.categories.map((c) => c.name).sort()).toEqual(b.categories.map((c) => c.name).sort());
    const prodSig = (r: { categories: CategoryRow[]; products: ProductRow[] }) =>
      r.products
        .map((p) => `${r.categories.find((c) => c.id === p.categoryId)?.name ?? "?"}:${p.name}`)
        .sort();
    expect(prodSig(a)).toEqual(prodSig(b));
  });

  it("multi-file merge produces single result", () => {
    _id = 0;
    const state = { categories: [], products: [] };
    const r1 = buildMenuImport(
      { categories: [{ name: "Boissons", items: [{ name: "E", description: "", price: 2 }] }] },
      { files: 1, pages: 10, source: "ai", model: "m" },
    );
    const r2 = buildMenuImport(
      { categories: [{ name: "Plats", items: [{ name: "Couscous", description: "", price: 10 }] }] },
      { files: 1, pages: 10, source: "ai", model: "m" },
    );
    const m1 = mergeMenuImport(state, r1, uid);
    const m2 = mergeMenuImport(m1, r2, uid);
    expect(m2.categories.length).toBe(2);
    expect(m2.products.length).toBe(2);
  });

  // OCR-09: the hand-typed row wins, but the skip used to be SILENT — the
  // dialog closed as if everything had imported. `planMenuImport` reports it so
  // the review step can show which rows were kept and what the scan proposed.
  it("reports a row it kept instead of the scanned one", () => {
    _id = 0;
    const state = {
      categories: [makeCat("Boissons")],
      products: [
        { ...makeProd("old-Boissons", "Espresso"), description: "mine", price: 9 },
      ],
    };
    const result = buildMenuImport(
      { categories: [{ name: "Boissons", items: [{ name: "espresso", description: "", price: 3 }] }] },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const plan = planMenuImport(state, result, uid);

    expect(plan.merged.products).toHaveLength(1);
    expect(plan.merged.products[0].price).toBe(9);
    expect(plan.merged.products[0].description).toBe("mine");
    expect(plan.report).toEqual({
      added: 0,
      keptExisting: 1,
      kept: [
        { name: "espresso", categoryName: "Boissons", existingPrice: 9, scannedPrice: 3 },
      ],
    });
  });

  it("does not report a row it actually added", () => {
    _id = 0;
    const result = buildMenuImport(
      { categories: [{ name: "Boissons", items: [{ name: "Thé", description: "", price: 2 }] }] },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const plan = planMenuImport({ categories: [], products: [] }, result, uid);
    expect(plan.report).toEqual({ added: 1, keptExisting: 0, kept: [] });
  });

  it("does not report a duplicate INSIDE one scan result as kept", () => {
    _id = 0;
    const result = buildMenuImport(
      {
        categories: [
          {
            name: "Boissons",
            items: [
              { name: "Thé", description: "", price: 2 },
              { name: "thé", description: "", price: 3 },
            ],
          },
        ],
      },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const plan = planMenuImport({ categories: [], products: [] }, result, uid);
    expect(plan.merged.products).toHaveLength(1);
    expect(plan.report).toEqual({ added: 1, keptExisting: 0, kept: [] });
  });

  it("previewMenuImport reports the same outcome without touching state", () => {
    const state = {
      categories: [makeCat("Boissons")],
      products: [{ ...makeProd("old-Boissons", "Espresso"), price: 9 }],
    };
    const result = buildMenuImport(
      { categories: [{ name: "Boissons", items: [{ name: "Espresso", description: "", price: 3 }] }] },
      { files: 1, pages: 0, source: "ai", model: "m" },
    );
    const before = JSON.stringify(state);
    const report = previewMenuImport(state, result);
    expect(report.keptExisting).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ── reconcileImports ───────────────────────────────────────────────

type RawCat = [name: string, items: Array<[name: string, price: number, description?: string]>];

const mkResult = (cats: RawCat[], source: "ai" | "fallback" = "ai"): MenuImportResult => ({
  categories: cats.map(([name]) => ({ name })),
  products: cats.flatMap(([name, items]) =>
    items.map(([n, price, description = ""]) => ({
      name: n,
      description,
      price,
      categoryName: name,
    })),
  ),
  stats: {
    files: 1,
    pages: 0,
    source,
    model: source === "ai" ? "mistral-ocr-latest" : "local-parser",
  },
});

const ai8 = (): MenuImportResult =>
  mkResult([
    [
      "Coffees",
      [
        ["Expresso", 1, "Strong single-shot espresso"],
        ["Cappuccino", 4.5, "Espresso with steamed milk"],
        ["Turkish Coffee", 2, "Classic cezve-brewed"],
        ["Macchiato", 3.5, "Espresso kissed with milk"],
      ],
    ],
    [
      "Salades",
      [
        ["Tuna Salad", 6.5, "Tuna, tomato, olives"],
        ["Caesar Salad", 7, "Crisp romaine, parmesan"],
        ["Feta Salad", 5.5],
      ],
    ],
    ["Sandwiches", [["Brik a l Oeuf", 4.5]]],
  ]);

const parser8 = (): MenuImportResult =>
  mkResult(
    [
      [
        "Coffees",
        [
          ["Expresso", 1],
          ["Cappuccino", 4.5],
          ["Turkish Coffee", 2],
          ["Macchiato", 3.5],
        ],
      ],
      [
        "Salades",
        [
          ["Tuna Salad", 6.5],
          ["Caesar Salad", 7],
          ["Feta Salad", 5.5],
        ],
      ],
      ["Sandwiches", [["Brik a l Oeuf", 4.5]]],
    ],
    "fallback",
  );

const keySet = (r: MenuImportResult) => r.products.map((p) => normalizeKey(p.name)).sort();

describe("reconcileImports", () => {
  it("equivalent AI 8 + parser 8 merges to exactly a single product per dish", () => {
    const r = reconcileImports(ai8(), parser8());
    expect(r.products.length).toBe(8);
    expect(new Set(keySet(r)).size).toBe(8);
    expect(r.categories.map((c) => c.name).sort()).toEqual(
      ["Coffees", "Salades", "Sandwiches"].sort(),
    );
    const cap = r.products.find((p) => normalizeKey(p.name) === "cappuccino");
    expect(cap?.description).toBe("Espresso with steamed milk");
    expect(cap?.price).toBe(4.5);
  });

  it("parser discovers extra dishes -> all kept, AI metadata preserved", () => {
    const parser = parser8();
    parser.products.push({ name: "Spanish Latte", description: "", price: 4, categoryName: "Coffees" });
    parser.products.push({ name: "Greek Yogurt", description: "", price: 3, categoryName: "Salades" });
    parser.categories.push({ name: "Desserts" });
    parser.products.push({ name: "Baklava", description: "", price: 3.5, categoryName: "Desserts" });

    const r = reconcileImports(ai8(), parser);
    expect(r.products.length).toBeGreaterThanOrEqual(11);
    expect(keySet(r)).toContain(normalizeKey("Spanish Latte"));
    expect(keySet(r)).toContain(normalizeKey("Greek Yogurt"));
    expect(keySet(r)).toContain(normalizeKey("Baklava"));
    expect(r.categories.map((c) => c.name)).toContain("Desserts");
    const cap = r.products.find((p) => normalizeKey(p.name) === "cappuccino");
    expect(cap?.description).toBe("Espresso with steamed milk");
  });

  it("AI discovers extra dishes -> all kept, parser baseline kept", () => {
    const ai = ai8();
    ai.products.push({ name: "Flat White", description: "Double ristretto", price: 4.2, categoryName: "Coffees" });
    ai.categories.push({ name: "Desserts" });
    ai.products.push({ name: "Tiramisu", description: "Coffee-soaked", price: 5, categoryName: "Desserts" });

    const r = reconcileImports(ai, parser8());
    expect(r.products.length).toBeGreaterThanOrEqual(10);
    expect(keySet(r)).toContain(normalizeKey("Flat White"));
    expect(keySet(r)).toContain(normalizeKey("Tiramisu"));
    expect(keySet(r)).toContain(normalizeKey("Tuna Salad"));
    expect(r.products.find((p) => normalizeKey(p.name) === "flat white")?.description).toBe(
      "Double ristretto",
    );
  });

  it("dish present only in AI survives with its category", () => {
    const ai = mkResult([["Coffees", [["Lungo", 2, "Long pour"]]]]);
    const r = reconcileImports(ai, mkResult([], "fallback"));
    expect(r.products.length).toBe(1);
    expect(r.products[0].name).toBe("Lungo");
    expect(r.products[0].categoryName).toBe("Coffees");
    expect(r.products[0].description).toBe("Long pour");
    expect(r.stats.source).toBe("ai");
  });

  it("dish present only in parser survives with its category", () => {
    const parser = mkResult([["Juices", [["Orange Juice", 3]]]], "fallback");
    const r = reconcileImports(mkResult([], "ai"), parser);
    expect(r.products.length).toBe(1);
    expect(r.products[0].name).toBe("Orange Juice");
    expect(r.products[0].categoryName).toBe("Juices");
  });

  it("duplicate dish from both sources becomes one product", () => {
    const ai = mkResult([["Bar", [["Mojito", 6, "Fresh mint"]]]]);
    const parser = mkResult([["bar", [["MOJITO", 6]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.length).toBe(1);
    expect(r.products[0].name).toBe("Mojito"); // AI spelling wins
    expect(r.products[0].description).toBe("Fresh mint");
    expect(r.products[0].price).toBe(6);
  });

  it("duplicate category from both sources becomes one (case-insensitive)", () => {
    const ai = mkResult([["Coffees", [["Cappuccino", 4.5, "Steamed milk"]]]]);
    const parser = mkResult([["coffees", [["Cappuccino", 4.5]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.categories.length).toBe(1);
    expect(r.categories[0].name).toBe("Coffees");
  });

  it("AI description enriches a parser-only dish", () => {
    const ai = mkResult([["Salades", [["Feta Salad", 5.5, "Feta, cucumber, olives"]]]]);
    const parser = mkResult([["Salades", [["Feta Salad", 5.5]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products[0].description).toBe("Feta, cucumber, olives");
  });

  it("valid parser price survives a malformed AI price", () => {
    const ai = mkResult([["Coffees", [["Cappuccino", NaN, "Steamed milk"]]]]);
    const parser = mkResult([["Coffees", [["Cappuccino", 4.5]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.find((p) => normalizeKey(p.name) === "cappuccino")?.price).toBe(4.5);
  });

  it("both prices valid but different -> parser (literal OCR) price wins", () => {
    const ai = mkResult([["Coffees", [["Cappuccino", 5, "Steamed milk"]]]]);
    const parser = mkResult([["Coffees", [["Cappuccino", 4.5]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.find((p) => normalizeKey(p.name) === "cappuccino")?.price).toBe(4.5);
  });

  it("OCR artifacts never survive reconciliation", () => {
    const parser: MenuImportResult = {
      categories: [{ name: "Coffees" }],
      products: [
        { name: "[tbl-0.md](tbl-0.md)", description: "", price: 0, categoryName: "Coffees" },
        { name: "Expresso", description: "", price: 1, categoryName: "Coffees" },
      ],
      stats: { files: 1, pages: 0, source: "fallback", model: "local-parser" },
    };
    const ai = mkResult([["Coffees", [["Expresso", 1, "Strong"]]]]);
    const r = reconcileImports(ai, parser);
    expect(r.products.length).toBe(1);
    expect(r.products[0].name).toBe("Expresso");
  });

  it("keeps category relationships correct when both sources agree", () => {
    const r = reconcileImports(ai8(), parser8());
    const cap = r.products.find((p) => normalizeKey(p.name) === "cappuccino");
    expect(cap?.categoryName).toBe("Coffees");
    const tuna = r.products.find((p) => normalizeKey(p.name) === "tuna salad");
    expect(tuna?.categoryName).toBe("Salades");
  });

  it("prefers parser relationship when parser association is confident", () => {
    const ai = mkResult([["Sides", [["Salade", 3, "Side salad"]]]]);
    const parser = mkResult([["Salades", [["Salade", 3]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.find((p) => normalizeKey(p.name) === "salade")?.categoryName).toBe("Salades");
  });

  it("uses AI category when parser association is uncertain (Uncategorized)", () => {
    const ai = mkResult([["Salades", [["Feta Salad", 5.5, "Feta, olives"]]]]);
    const parser = mkResult([], "fallback");
    parser.products.push({ name: "Feta Salad", description: "", price: 5.5, categoryName: UNCATEGORIZED });
    const r = reconcileImports(ai, parser);
    expect(r.products.find((p) => normalizeKey(p.name) === "feta salad")?.categoryName).toBe(
      "Salades",
    );
    expect(r.categories.map((c) => c.name)).toContain("Salades");
  });

  it("uses AI category when parser association is the catch-all Menu heading", () => {
    const ai = mkResult([["Coffees", [["Macchiato", 3.5, "Espresso kiss"]]]]);
    const parser = mkResult([["Menu", [["Macchiato", 3.5]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.find((p) => normalizeKey(p.name) === "macchiato")?.categoryName).toBe("Coffees");
    expect(r.categories.map((c) => c.name)).toContain("Coffees");
    expect(r.categories.map((c) => c.name)).not.toContain("Menu");
  });

  it("preserves the same dish listed in two different categories within one source", () => {
    const ai = mkResult([
      ["Starters", [["Salade", 3, "Small"]]],
      ["Mains", [["Salade", 6, "Large"]]],
    ]);
    const parser = mkResult([["Starters", [["Salade", 3]]]], "fallback");
    const r = reconcileImports(ai, parser);
    expect(r.products.length).toBe(2);
    expect(keySet(r)).toEqual([normalizeKey("Salade"), normalizeKey("Salade")]);
    const starter = r.products.find((p) => p.categoryName === "Starters");
    const mains = r.products.find((p) => p.categoryName === "Mains");
    expect(starter?.price).toBe(3);
    expect(mains?.price).toBe(6);
    expect(mains?.description).toBe("Large");
  });

  // OCR-01: the documented invariant `final >= max(ai, parser)` was FALSE for
  // this executed shape. The parser printed "Salade" under two sections and the
  // AI saw it once; the disambiguated slot overwrote the parser product already
  // stored under the bare slot, losing the Mains listing (and orphaning the
  // category, which sanitizeImport then dropped).
  it("keeps a parser dish listed in two sections when the AI saw only one", () => {
    const ai = mkResult([["Starters", [["Salade", 3, "Small"]]]]);
    const parser = mkResult(
      [
        ["Starters", [["Salade", 3]]],
        ["Mains", [["Salade", 6]]],
      ],
      "fallback",
    );
    const r = reconcileImports(ai, parser);
    expect(r.products.length).toBeGreaterThanOrEqual(
      Math.max(ai.products.length, parser.products.length),
    );
    expect(r.products.length).toBe(2);
    expect(r.products.map((p) => p.categoryName).sort()).toEqual(["Mains", "Starters"]);
    expect(r.categories.map((c) => c.name).sort()).toEqual(["Mains", "Starters"]);
    const mains = r.products.find((p) => p.categoryName === "Mains");
    expect(mains?.price).toBe(6);
  });

  it("never shrinks below the richer input", () => {
    const parser = parser8();
    parser.products.push({ name: "Expresso", description: "", price: 1, categoryName: "Brunch" });
    const ai = ai8();
    const r = reconcileImports(ai, parser);
    expect(r.products.length).toBeGreaterThanOrEqual(
      Math.max(ai.products.length, parser.products.length),
    );
  });

  it("stats source reflects the AI extraction when AI contributed dishes", () => {
    const r = reconcileImports(ai8(), parser8());
    expect(r.stats.source).toBe("ai");
    const parserOnly = reconcileImports(mkResult([], "ai"), parser8());
    expect(parserOnly.stats.source).toBe("fallback");
  });
});