import { describe, it, expect, vi } from "vitest";

// `menu-scan.ts` is a server module ("server-only"); the mock keeps the import
// working under vitest while the module under test stays untouched.
vi.mock("server-only", () => ({}));

import { parseOcrMarkdown, annotationSpec, annotationCategories } from "./menu-scan";
import { reconcileImports, buildMenuImport, type MenuImportResult } from "./menu-import";
import { documentText, type OcrPage } from "./ocr-quality";

/** First item produced for `line` under a single `## Test` heading. */
const item = (line: string) => parseOcrMarkdown(`## Test\n${line}`, "Café Aziz")[0]?.items[0];

// ── parseOcrMarkdown: the price/name truth table (OCR-02, OCR-03) ───
//
// Baseline captured by the audit by EXECUTING the real parser. Every row that
// used to be wrong (Couscous 1 200, $12.50, €12, ١٢٫٥) now has to produce either
// the correct pair or a clean 0, and never a digit left inside the name.

describe("parseOcrMarkdown price and name", () => {
  it("keeps the canonical Tunisian forms", () => {
    expect(item("Cappuccino 12,5")).toMatchObject({ name: "Cappuccino", price: 12.5 });
    expect(item("Cappuccino 12.5")).toMatchObject({ name: "Cappuccino", price: 12.5 });
    expect(item("Cappuccino 12 DT")).toMatchObject({ name: "Cappuccino", price: 12 });
    expect(item("Espresso 4.500 DT")).toMatchObject({ name: "Espresso", price: 4.5 });
    expect(item("Pizza 12.500")).toMatchObject({ name: "Pizza", price: 12.5 });
    expect(item("Tarte 12,500 DT")).toMatchObject({ name: "Tarte", price: 12.5 });
    expect(item("Jus 1,5 DT")).toMatchObject({ name: "Jus", price: 1.5 });
    expect(item("Coca 3 E")).toMatchObject({ name: "Coca", price: 3 });
    expect(item("Salade 6.5€")).toMatchObject({ name: "Salade", price: 6.5 });
  });

  it("reads a space-separated price as TND and keeps NO digit in the name", () => {
    // "1 200" is 1 DT 200 in the millime convention TND is printed in — the
    // 3-digit group is the fraction, exactly as in "1.200". The old parser read
    // the trailing run alone and produced {name:"Couscous 1", price:200}; now
    // the whole numeric run is the price and the name keeps no stray digit.
    expect(item("Couscous 1 200")).toEqual({ name: "Couscous", description: "", price: 1.2 });
    // NBSP — what a PDF text layer or an OCR pass emits.
    expect(item("Couscous 1\u00A0200")).toEqual({ name: "Couscous", description: "", price: 1.2 });
  });

  it("never invents a phantom dish from a spaced price", () => {
    // The executed regression: the corrupted name defeated dedupe, so the merge
    // yielded TWO products, one of them at 200 DT.
    const ai = mkResult([["Test", [["Couscous", 12]]]]);
    const parser = buildMenuImport(
      { categories: parseOcrMarkdown("## Test\nCouscous 1 200", "Café Aziz") },
      { files: 1, pages: 1, source: "fallback", model: "local-parser" },
    );
    const merged = reconcileImports(ai, parser);
    expect(merged.products).toHaveLength(1);
    expect(merged.products[0].name).toBe("Couscous");
    expect(merged.products.every((p) => p.price < 200)).toBe(true);
  });

  it("handles prefix currency symbols and leaves no digits in the name", () => {
    expect(item("Steak $12.50")).toMatchObject({ name: "Steak", price: 12.5 });
    expect(item("Café €12")).toMatchObject({ name: "Café", price: 12 });
    // "€" is read at face value and "$12.50" the same way: one consistent rule,
    // so the two symbols can no longer disagree with each other.
    expect(item("Steak $12.50")?.price).toBe(item("Steak €12.5")?.price);
  });

  it("parses Arabic-Indic digits and separators", () => {
    expect(item("عصير ١٢٫٥")).toMatchObject({ name: "عصير", price: 12.5 });
    expect(item("طاجين ٨")).toMatchObject({ name: "طاجين", price: 8 });
    expect(item("عصير ١٢٫٥")?.name).not.toMatch(/[٠-٩]/);
  });

  it("keeps multi-word names intact", () => {
    expect(item("Brik à l'Œuf 4.500")).toMatchObject({ name: "Brik à l'Œuf", price: 4.5 });
    expect(item("Café au lait 2,5 DT")).toMatchObject({ name: "Café au lait", price: 2.5 });
  });
});

// ── parseOcrMarkdown: structure (OCR-04, OCR-12, OCR-17, OCR-18) ────

describe("parseOcrMarkdown structure", () => {
  it("imports a table-laid-out menu", () => {
    // `table_format:"markdown"` returns tables in `page.tables`, never in the
    // page markdown; when rows DO reach the parser, each row used to become a
    // product literally named "| Café | 2.500 |" with price 0.
    const cats = parseOcrMarkdown(
      ["## Plats", "| Plat | Prix |", "|---|---|", "| Couscous | 12.500 |", "| Brik | 4.500 |"].join(
        "\n",
      ),
      "Café Aziz",
    );
    expect(cats).toHaveLength(1);
    expect(cats[0].items.map((i) => [i.name, i.price])).toEqual([
      ["Couscous", 12.5],
      ["Brik", 4.5],
    ]);
  });

  it("keeps a table's middle cells as the description", () => {
    const cats = parseOcrMarkdown(
      ["| Plat | Description | Prix |", "|---|---|---|", "| Ojja | Tomate et oeufs | 8.000 |"].join(
        "\n",
      ),
      "Café Aziz",
    );
    expect(cats[0].items[0]).toMatchObject({
      name: "Ojja",
      description: "Tomate et oeufs",
      price: 8,
    });
  });

  it("structures a headingless menu under the Menu catch-all", () => {
    expect(parseOcrMarkdown("Café 2\nThé 2\nJus 3", "Café Aziz")).toEqual([
      {
        name: "Menu",
        items: [
          { name: "Café", description: "", price: 2 },
          { name: "Thé", description: "", price: 2 },
          { name: "Jus", description: "", price: 3 },
        ],
      },
    ]);
  });

  it("keeps items printed before the first heading", () => {
    // Used to be dropped silently: the sink was detached when the first heading
    // replaced it, and the catch-all only fires when there is NO heading (OCR-12).
    const cats = parseOcrMarkdown("Café 2\n## Boissons\nThé 3", "Café Aziz");
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe("Boissons");
    expect(cats[0].items.map((i) => i.name)).toEqual(["Café", "Thé"]);
  });

  it("applies an orphan price line to the next item", () => {
    // "Menu du jour / 12.500" — the price is printed above the dish. The old
    // parser dropped it and the dish imported as free (OCR-18).
    expect(parseOcrMarkdown("## Boissons\n2.500\nCafé", "Café Aziz")[0].items).toEqual([
      { name: "Café", description: "", price: 2.5 },
    ]);
  });

  it("still applies a stray price to the previous item that has none", () => {
    expect(parseOcrMarkdown("## Boissons\nCafé\n2.500", "Café Aziz")[0].items).toEqual([
      { name: "Café", description: "", price: 2.5 },
    ]);
  });

  it("treats bold and deep headings as sections", () => {
    expect(parseOcrMarkdown("**Nos Boissons**\nCafé 2", "Café Aziz")[0].name).toBe("Nos Boissons");
    expect(parseOcrMarkdown("#### Starters\nBrik 4", "Café Aziz")[0].name).toBe("Starters");
    // "#### Starters" used to become a PRODUCT named "#### Starters".
    expect(parseOcrMarkdown("#### Starters\nBrik 4", "Café Aziz")[0].items).toHaveLength(1);
  });

  it("does not let a short venue name swallow a real heading", () => {
    // With venue "Le", the old prefix test dropped "Legumes Grilles" (OCR-17).
    expect(parseOcrMarkdown("## Legumes Grilles\nBrik 4", "Le")[0].name).toBe("Legumes Grilles");
    // A section really can be called "Drinks"/"Food" (OCR-17).
    expect(parseOcrMarkdown("## Drinks\nCafé 2\n## Food\nBrik 4", "Café Aziz").map((c) => c.name)).toEqual(
      ["Drinks", "Food"],
    );
  });

  it("drops the venue's own name as a heading", () => {
    const cats = parseOcrMarkdown("## Café Aziz\n## Boissons\nCafé 2", "Café Aziz");
    expect(cats.map((c) => c.name)).toEqual(["Boissons"]);
  });

  it("never surfaces the pipeline's own table placeholders as products", () => {
    // The parser is deliberately NOT the sanitizer: it keeps the placeholder
    // line, and `isOcrArtifact` drops it in `buildMenuImport` — so a table-only
    // page can never contribute a product (or a live category) named after it.
    const cats = parseOcrMarkdown("## Plats\n[tbl-0.md](tbl-0.md)", "Café Aziz");
    const built = buildMenuImport(
      { categories: cats },
      { files: 1, pages: 1, source: "fallback", model: "local-parser" },
    );
    expect(built.products).toEqual([]);
    expect(built.categories).toEqual([]);
  });
});

// ── reconcileImports: the documented safety invariant (OCR-01) ──────

type RawCat = [name: string, items: Array<[name: string, price: number]>];

const mkResult = (cats: RawCat[], source: "ai" | "fallback" = "ai"): MenuImportResult => ({
  categories: cats.map(([name]) => ({ name })),
  products: cats.flatMap(([name, items]) =>
    items.map(([n, price]) => ({ name: n, description: "", price, categoryName: name })),
  ),
  stats: { files: 1, pages: 0, source, model: source === "ai" ? "mistral-ocr-latest" : "local-parser" },
});

describe("reconcileImports invariant", () => {
  it("never returns fewer products than the richer input (executed a/b/a case)", () => {
    // EXECUTED by the audit: ai = {Salade@Starters}, parser = {Salade@Starters,
    // Salade@Mains} returned ONE product and lost the Mains listing. The
    // disambiguated slot resolved to the bare AI slot and OVERWROTE the parser
    // product already attached there.
    const ai = mkResult([["Starters", [["Salade", 3]]]]);
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
    expect(r.products).toHaveLength(2);
    expect(r.products.map((p) => p.categoryName).sort()).toEqual(["Mains", "Starters"]);
    expect(r.products.map((p) => p.price).sort()).toEqual([3, 6]);
  });

  it("holds for every merge shape", () => {
    const cases: Array<[MenuImportResult, MenuImportResult]> = [
      [
        mkResult([["A", [["X", 1]]]]),
        mkResult(
          [
            ["A", [["X", 1]]],
            ["B", [["X", 2]]],
            ["C", [["Y", 3]]],
          ],
          "fallback",
        ),
      ],
      [
        mkResult([
          ["A", [["X", 1]]],
          ["B", [["X", 2]]],
        ]),
        mkResult([["A", [["X", 1]]]], "fallback"),
      ],
      [mkResult([], "ai"), mkResult([["A", [["X", 1], ["Z", 4]]]], "fallback")],
      [mkResult([["A", [["X", 1]]]]), mkResult([], "fallback")],
    ];
    for (const [ai, parser] of cases) {
      const r = reconcileImports(ai, parser);
      expect(r.products.length).toBeGreaterThanOrEqual(
        Math.max(ai.products.length, parser.products.length),
      );
    }
  });

  it("still merges an equivalent dish pair into one product", () => {
    const ai = mkResult([["Coffees", [["Cappuccino", 4.5]]]]);
    const parser = mkResult([["Coffees", [["Cappuccino", 4.5]]]], "fallback");
    expect(reconcileImports(ai, parser).products).toHaveLength(1);
  });
});

// ── documentText: the REAL captured provider payload ────────────────
//
// Verbatim from the live run's raw `/v1/ocr` response — `/tmp/raw2.json`, i.e.
// the table-laid-out photograph `/tmp/menu2.png` read by `mistral-ocr-latest`.
// Look at the table objects: `{id, content, format, word_confidence_scores}`.
// There is NO `markdown` key on them, so reading `t.markdown` contributed an
// empty string for all five tables while `page.markdown` kept only the
// `[tbl-N.md](tbl-N.md)` placeholders: the server logged
// `pages=1 chars=280 tables=5` and the parser received ZERO of the 19 printed
// dishes — the "grid-laid-out menu extracts nothing" defect.
const CAPTURED_PAGE = {
  index: 0,
  markdown: `# CAFÉ DES JASMINS

12 Rue de Marseille · Tunis · Tél. 71 245 890

CAFÉS

[tbl-0.md](tbl-0.md)

BOISSONS FROIDES

[tbl-1.md](tbl-1.md)

PÂTISSERIES

[tbl-2.md](tbl-2.md)

PLATS

[tbl-3.md](tbl-3.md)

EXTRAS

[tbl-4.md](tbl-4.md)

Prix en dinars · Service compris`,
  tables: [
    {
      id: "tbl-0.md",
      content: `|  Espresso | 1.200  |
| --- | --- |
|  Café au lait | 1.800  |
|  Cappuccino | 2.200  |
|  Café crème | 2.500  |
|  Direct | 1.500  |`,
      format: "markdown",
      word_confidence_scores: null,
    },
    {
      id: "tbl-1.md",
      content: `|  Thé à la menthe | 1.500  |
| --- | --- |
|  Jus d'orange | 3.000  |
|  Citronnade | 2.800  |
|  Eau minérale | 1.000  |
|  Soda | 1.800  |`,
      format: "markdown",
      word_confidence_scores: null,
    },
    {
      id: "tbl-2.md",
      content: `|  Croissant | 1.200  |
| --- | --- |
|  Pain au chocolat | 1,500  |
|  Brioche | 1.000  |
|  Mille-feuille | 2.500  |
|  Baklava | 2.000  |`,
      format: "markdown",
      word_confidence_scores: null,
    },
    {
      id: "tbl-3.md",
      content: `|  Assiette tunisienne | 6 500  |
| --- | --- |
|  Omelette fromage | 4.500 DT  |`,
      format: "markdown",
      word_confidence_scores: null,
    },
    {
      id: "tbl-4.md",
      content: `|  Chantilly | 0.800  |
| --- | --- |
|  Amandes | 0.700  |`,
      format: "markdown",
      word_confidence_scores: null,
    },
  ],
};

/** The `document_annotation` of that same capture: a JSON STRING, and empty. */
const CAPTURED_EMPTY_ANNOTATION = '{"categories": []}';

/** The 19 dishes the captured page prints, as the live run imported them. */
const CAPTURED_DISHES: Array<[string, number]> = [
  ["Espresso", 1.2],
  ["Café au lait", 1.8],
  ["Cappuccino", 2.2],
  ["Café crème", 2.5],
  ["Direct", 1.5],
  ["Thé à la menthe", 1.5],
  ["Jus d'orange", 3],
  ["Citronnade", 2.8],
  ["Eau minérale", 1],
  ["Soda", 1.8],
  ["Croissant", 1.2],
  ["Pain au chocolat", 1.5],
  ["Brioche", 1],
  ["Mille-feuille", 2.5],
  ["Baklava", 2],
  ["Assiette tunisienne", 6.5],
  ["Omelette fromage", 4.5],
  ["Chantilly", 0.8],
  ["Amandes", 0.7],
];

const build = (markdown: string, venue = "ZZ Test Cafe"): MenuImportResult =>
  buildMenuImport(
    { categories: parseOcrMarkdown(markdown, venue) },
    { files: 1, pages: 1, source: "fallback", model: "local-parser" },
  );

describe("documentText (captured Mistral payload)", () => {
  it("keeps every table body that lives in `content`, in place", () => {
    const text = documentText([CAPTURED_PAGE]);
    for (const table of CAPTURED_PAGE.tables) {
      expect(table).not.toHaveProperty("markdown");
      expect(text).toContain(table.content);
    }
    // The page's own text is still first, so reading order is preserved...
    expect(text.indexOf("# CAFÉ DES JASMINS")).toBeLessThan(text.indexOf("Espresso"));
    // ...and each body sits where its placeholder was, i.e. under its caption.
    expect(text).not.toContain("[tbl-0.md](tbl-0.md)");
    expect(text.indexOf("CAFÉS")).toBeLessThan(text.indexOf("Espresso"));
    expect(text.indexOf("Espresso")).toBeLessThan(text.indexOf("Thé à la menthe"));
    expect(text.indexOf("Thé à la menthe")).toBeLessThan(text.indexOf("Croissant"));
  });

  it("extracts all 19 printed dishes under the sections the card prints", () => {
    // EXECUTED reference: the same photograph returned 0 of 19 dishes before the
    // bodies reached the parser, and the venue here is deliberately NOT the one
    // printed on the card (the live A/B that produced `aiItems: 0`).
    const built = build(documentText([CAPTURED_PAGE]));
    expect(built.products).toHaveLength(19);
    expect(built.categories.map((c) => c.name)).toEqual([
      "CAFÉS",
      "BOISSONS FROIDES",
      "PÂTISSERIES",
      "PLATS",
      "EXTRAS",
    ]);
    const imported = new Map(built.products.map((p) => [p.name, p.price]));
    for (const [name, price] of CAPTURED_DISHES) expect(imported.get(name)).toBe(price);
    // Every printed dish is filed under its own section, not the venue's name.
    for (const [category, count] of [
      ["CAFÉS", 5],
      ["BOISSONS FROIDES", 5],
      ["PÂTISSERIES", 5],
      ["PLATS", 2],
      ["EXTRAS", 2],
    ] as Array<[string, number]>) {
      expect(built.products.filter((p) => p.categoryName === category)).toHaveLength(count);
    }
    const names = built.products.map((p) => p.name);
    expect(names).not.toContain("12 Rue de Marseille · Tunis · Tél.");
    expect(names).not.toContain("Prix en dinars · Service compris");
    expect(names).not.toContain("CAFÉS");
  });

  it("still reads a table whose body is in `markdown` (other provider shape)", () => {
    // Derived fixture: the same page through the fallback field name, with no
    // `id` for the placeholder to match — document order decides.
    const legacy: OcrPage = {
      markdown: "## Boissons\n[tbl-0.md](tbl-0.md)",
      tables: [{ markdown: "| Café | 2.500 |\n| --- | --- |\n| Thé | 1.500 |" }],
    };
    expect(build(documentText([legacy])).products.map((p) => [p.name, p.price])).toEqual([
      ["Café", 2.5],
      ["Thé", 1.5],
    ]);
  });

  it("attaches a body with no placeholder below the page text", () => {
    // Derived fixture: nothing may be lost when the provider sends a table the
    // page text does not reference.
    const orphan: OcrPage = {
      markdown: "## Boissons",
      tables: [{ id: "tbl-9.md", content: "| Café | 2.500 |" }],
    };
    expect(build(documentText([orphan])).products.map((p) => [p.name, p.price])).toEqual([
      ["Café", 2.5],
    ]);
  });

  it("promotes a printed caption above a table to a section, never a product", () => {
    // The captured layout: the caption is plain text, its rows are the table.
    const cats = parseOcrMarkdown(
      "CAFÉS\n\n|  Espresso | 1.200  |\n| --- | --- |\n|  Direct | 1.500  |",
      "Café Aziz",
    );
    expect(cats.map((c) => [c.name, c.items.map((i) => i.name)])).toEqual([
      ["CAFÉS", ["Espresso", "Direct"]],
    ]);
  });

  it("does not promote a priced dish line above a table", () => {
    // Only a caption (no price of its own) opens a section: a priced line is a
    // dish even when a table follows it.
    expect(
      build("Menu du jour 12.500\n| Espresso | 1.200 |").products.map((p) => [p.name, p.price]),
    ).toEqual([
      ["Menu du jour", 12.5],
      ["Espresso", 1.2],
    ]);
    // A menu with no tables at all is untouched.
    expect(build("Café 2\nThé 2\nJus 3").categories.map((c) => c.name)).toEqual(["Menu"]);
  });

  it("never drops a body because of its declared format", () => {
    // Derived fixture: a body the provider does not label `markdown` must reach
    // the parser all the same — the format is surfaced in the OCR log instead.
    const html: OcrPage = {
      markdown: "## Boissons",
      tables: [{ content: "| Café | 2.500 |", format: "html" }],
    };
    expect(documentText([html])).toContain("| Café | 2.500 |");
  });

  it("passes a page with no tables through unchanged", () => {
    const only: OcrPage = { markdown: "## Boissons\nCafé 2.500" };
    expect(documentText([only])).toContain("Café 2.500");
  });
});

// ── Venue chrome: the real rows every scan invented ─────────────────
//
// The strings below are verbatim from the live run's captured results
// (`/tmp/scan1..6.json`). Two of them were imported as products on EVERY scan.

describe("venue chrome is never a product", () => {
  it("drops the address/phone line instead of pricing it at 9999", () => {
    // `scan1/2/4`: "12 Rue de Marseille · Tunis · Tél." imported at 9999 DT —
    // the phone digits "71 245 890" assembled into one number and clamped by
    // sanitizePrice's ceiling.
    const built = build("## CAFÉS\n12 Rue de Marseille · Tunis · Tél. 71 245 890\nEspresso 1.200");
    expect(built.products.map((p) => [p.name, p.price])).toEqual([["Espresso", 1.2]]);
  });

  it("drops the card footer instead of importing it at 0", () => {
    const built = build("## EXTRAS\nChantilly 0.800\nPrix en dinars · Service compris");
    expect(built.products.map((p) => [p.name, p.price])).toEqual([["Chantilly", 0.8]]);
  });

  it("drops the Arabic address and footer of the third photograph", () => {
    // `scan3`/`scan6`, verbatim: both were imported as products at 9999 and 0.
    const built = build(
      "## إضافات — Extras\nAmandes 0.700\nنهج مرسيليا - تونس - الهاتف 71 245 890\nالأسعار بالدينار - الخدمة مشمولة",
    );
    expect(built.products.map((p) => [p.name, p.price])).toEqual([["Amandes", 0.7]]);
  });

  it("never lets a bare phone number price the next dish", () => {
    // A phone-only line used to be held as an orphan price: "71 245 890" above
    // "Espresso" priced Espresso at 9999 DT.
    expect(build("## CAFÉS\n71 245 890\nEspresso").products).toEqual([
      { name: "Espresso", description: "", price: 0, categoryName: "CAFÉS" },
    ]);
  });

  it("still imports a legitimate 9999 DT dish, and a priced row beside a phone", () => {
    // Rejection is on the LINE being contact noise, never on the number.
    expect(build("## PLATS\nHomard grillé 9999").products.map((p) => [p.name, p.price])).toEqual([
      ["Homard grillé", 9999],
    ]);
    expect(
      build("## PLATS\n| Homard grillé | 9999 |\n| Couscous royal | 12.500 |").products.map((p) => [
        p.name,
        p.price,
      ]),
    ).toEqual([
      ["Homard grillé", 9999],
      ["Couscous royal", 12.5],
    ]);
  });
});

/** The AI rows of the Arabic/French card, verbatim from `/tmp/scan6.json`. */
const CAPTURED_AI_ROWS = [
  { name: "قهوة عربية", description: "", price: 2.5, categoryName: "قهوة — Cafés" },
  { name: "Café au lait", description: "", price: 3.2, categoryName: "قهوة — Cafés" },
  { name: "قهوة كابوسان", description: "", price: 2.8, categoryName: "قهوة — Cafés" },
  { name: "Cappuccino", description: "", price: 8.5, categoryName: "قهوة — Cafés" },
  { name: "Direct", description: "", price: 1.5, categoryName: "قهوة — Cafés" },
  { name: "شاي بالنعناع", description: "", price: 1.5, categoryName: "مشروبات باردة — Boissons froides" },
  { name: "Jus d'orange", description: "", price: 4, categoryName: "مشروبات باردة — Boissons froides" },
  { name: "عصير ليمون", description: "", price: 3, categoryName: "مشروبات باردة — Boissons froides" },
  { name: "ماء معدني", description: "", price: 1, categoryName: "مشروبات باردة — Boissons froides" },
  { name: "Soda", description: "", price: 1.8, categoryName: "مشروبات باردة — Boissons froides" },
  { name: "بقلاوة", description: "", price: 2, categoryName: "حلويات — Pâtisseries" },
  { name: "Croissant", description: "", price: 1.2, categoryName: "حلويات — Pâtisseries" },
  { name: "مقروض", description: "", price: 1.8, categoryName: "حلويات — Pâtisseries" },
  { name: "Chantilly", description: "", price: 0.8, categoryName: "إضافات — Extras" },
  { name: "لوز", description: "", price: 0.7, categoryName: "إضافات — Extras" },
  // Invented from the card's own header and footer (last two rows of scan6):
  { name: "نهج مرسيليا - تونس - الهاتف", description: "", price: 9999, categoryName: "قهوة — Cafés" },
  {
    name: "الأسعار بالدينار - الخدمة مشمولة",
    description: "",
    price: 0,
    categoryName: "إضافات — Extras",
  },
];

describe("captured AI rows", () => {
  it("drops the two rows the annotation invented, keeping all 15 dishes", () => {
    const built = buildMenuImport(
      { products: CAPTURED_AI_ROWS },
      { files: 1, pages: 1, source: "ai", model: "mistral-ocr-latest" },
    );
    expect(built.products).toHaveLength(15);
    expect(built.products.map((p) => p.name)).toEqual(
      CAPTURED_AI_ROWS.slice(0, 15).map((r) => r.name),
    );
    expect(built.categories.map((c) => c.name)).toEqual([
      "قهوة — Cafés",
      "مشروبات باردة — Boissons froides",
      "حلويات — Pâtisseries",
      "إضافات — Extras",
    ]);
  });
});

// ── The annotation prompt and the empty-annotation signal ───────────

describe("annotationSpec", () => {
  const spec = annotationSpec("ZZ Test Cafe");

  it("keeps the strict json_schema the endpoint is driven with", () => {
    const schema = spec.format.json_schema as {
      strict: boolean;
      schema: { required: string[]; additionalProperties: boolean };
    };
    expect(schema.strict).toBe(true);
    expect(schema.schema.required).toEqual(["categories"]);
    expect(schema.schema.additionalProperties).toBe(false);
  });

  it("asks for the visible dishes whatever the venue string is", () => {
    // The venue used to be a filter ("return ONLY the dishes of the target
    // venue"), which is what made the model answer {"categories": []} for a
    // venue name that is not on the card — a silent empty AI result.
    expect(spec.prompt).toContain("ZZ Test Cafe");
    expect(spec.prompt).toMatch(/DISAMBIGUATION HINT/);
    expect(spec.prompt).toMatch(/never let it decide whether to extract/);
    expect(spec.prompt).toMatch(/non-empty categories array is required/);
    expect(spec.prompt).not.toMatch(/return ONLY the dishes/);
  });

  it("still says what to do when no venue was typed", () => {
    expect(annotationSpec("   ").prompt).toMatch(/main printed menu/);
  });
});

describe("annotationCategories", () => {
  it("classifies the captured empty annotation as empty", () => {
    expect(annotationCategories(JSON.parse(CAPTURED_EMPTY_ANNOTATION))).toEqual({ kind: "empty" });
  });

  it("classifies categories that carry no dish as empty", () => {
    expect(annotationCategories({ categories: [{ name: "CAFÉS", items: [] }] })).toEqual({
      kind: "empty",
    });
    expect(annotationCategories({ categories: [] })).toEqual({ kind: "empty" });
  });

  it("accepts an annotation that carries dishes", () => {
    const parsed = { categories: [{ name: "CAFÉS", items: [{ name: "Espresso", price: 1.2 }] }] };
    expect(annotationCategories(parsed)).toEqual({ kind: "categories", categories: parsed.categories });
  });

  it("classifies malformed payloads as malformed, not empty", () => {
    for (const bad of [null, undefined, "[]", 42, {}, { categories: "xF" }]) {
      expect(annotationCategories(bad)).toEqual({ kind: "malformed" });
    }
    expect(annotationCategories({ products: [] })).toEqual({ kind: "malformed" });
  });
});
