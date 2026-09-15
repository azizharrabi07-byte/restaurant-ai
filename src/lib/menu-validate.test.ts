import { describe, expect, it } from "vitest";
import {
  MENU_STRUCTURE_RULES,
  mergeStructuredMenu,
  parseLlmJsonObject,
  validateMenuImport,
} from "./menu-validate";
import { UNCATEGORIZED, type MenuImportResult } from "./menu-import";

// Every string driven through the gate below was observed on live OCR of real
// cards — the three dietary-legend lines and the address are the exact rows the
// naive LLM+parser union imported as products (one of them at 9999 DT, the
// phone digits assembled into a price), and "Couscous 1 200" is the
// thousands-separator case the deterministic parser reads as 1.2.

type Row = { name: string; price?: number; description?: string; categoryName?: string };

/** A MenuImportResult whose category list is given, or derived from the rows. */
const mk = (rows: Row[], categories?: string[]): MenuImportResult => {
  const products = rows.map((r) => ({
    name: r.name,
    description: r.description ?? "",
    price: r.price ?? 0,
    categoryName: r.categoryName ?? UNCATEGORIZED,
  }));
  const names = categories ?? [...new Set(products.map((p) => p.categoryName))];
  return {
    categories: names.map((name) => ({ name })),
    products,
    stats: { files: 1, pages: 2, source: "llm", model: "meta/llama-3.2-11b-vision-instruct" },
  };
};

// ── validateMenuImport: the furniture a model still emits ────────────

describe("validateMenuImport — venue furniture and fragments", () => {
  it("drops the legend, address, footer, header and wrapped fragments, and keeps the real dish", () => {
    const input = mk(
      [
        { name: "V: Vegetarian" },
        { name: "VG: Vegan" },
        { name: "GF: Gluten Free" },
        { name: "12 Rue de Marseille · Tunis · Tél. 71 245 890", price: 9999 },
        { name: "Prix en dinars · Service compris" },
        { name: "FOOD & DRINKS" },
        { name: "Cauliflower &" },
        { name: "Panini with Pastrami, Dijon Mustard," },
        { name: "Couscous", price: 1200, categoryName: "PLATS" },
      ],
      ["PLATS"],
    );

    const { categories, products, report } = validateMenuImport(input);

    // A legitimately high price is not junk: rejection is on the LINE being
    // furniture, never on how big its number is.
    expect(products).toEqual([
      { name: "Couscous", description: "", price: 1200, categoryName: "PLATS" },
    ]);
    expect(categories.map((c) => c.name)).toEqual(["PLATS"]);
    expect(report.dropped).toEqual([
      { reason: "DIETARY_LEGEND", name: "V: Vegetarian", categoryName: UNCATEGORIZED, price: 0 },
      { reason: "DIETARY_LEGEND", name: "VG: Vegan", categoryName: UNCATEGORIZED, price: 0 },
      { reason: "DIETARY_LEGEND", name: "GF: Gluten Free", categoryName: UNCATEGORIZED, price: 0 },
      {
        reason: "VENUE_CONTACT",
        name: "12 Rue de Marseille · Tunis · Tél. 71 245 890",
        categoryName: UNCATEGORIZED,
        price: 9999,
      },
      {
        reason: "FOOTER",
        name: "Prix en dinars · Service compris",
        categoryName: UNCATEGORIZED,
        price: 0,
      },
      // A section header that leaked in as a product has no price of its own:
      // the "an un-priced fragment is not an item" rule is what removes it.
      { reason: "NO_PRICE", name: "FOOD & DRINKS", categoryName: UNCATEGORIZED, price: 0 },
      { reason: "DANGLING_FRAGMENT", name: "Cauliflower &", categoryName: UNCATEGORIZED, price: 0 },
      {
        reason: "DANGLING_FRAGMENT",
        name: "Panini with Pastrami, Dijon Mustard,",
        categoryName: UNCATEGORIZED,
        price: 0,
      },
    ]);
  });

  it("drops a bare phone number and a URL line", () => {
    const { products, report } = validateMenuImport(
      mk([
        { name: "71 245 890" },
        { name: "[www.cafe-aziz.tn](http://www.cafe-aziz.tn)", price: 3 },
      ]),
    );
    expect(products).toEqual([]);
    expect(report.dropped.map((d) => d.reason)).toEqual(["VENUE_CONTACT", "VENUE_CONTACT"]);
  });

  it("does not remove a dish that merely starts with the footer word", () => {
    const { products } = validateMenuImport(
      mk([{ name: "Menu Enfant", price: 15 }]),
    );
    expect(products.map((p) => p.name)).toEqual(["Menu Enfant"]);
  });
});

// ── validateMenuImport: item vs description ─────────────────────────

describe("validateMenuImport — item vs description", () => {
  it("keeps a real dish with its description and its price", () => {
    const { products, report } = validateMenuImport(
      mk([
        {
          name: "Cappuccino",
          price: 4.5,
          description: "Espresso, steamed milk and foam",
          categoryName: "CAFÉS",
        },
      ]),
    );
    expect(products).toEqual([
      {
        name: "Cappuccino",
        description: "Espresso, steamed milk and foam",
        price: 4.5,
        categoryName: "CAFÉS",
      },
    ]);
    expect(report.dropped).toEqual([]);
  });

  it("drops an un-priced fragment but keeps the same line as a description", () => {
    const fragment = validateMenuImport(mk([{ name: "Dijon Mustard", price: 0 }]));
    expect(fragment.products).toEqual([]);
    expect(fragment.report.dropped).toEqual([
      { reason: "NO_PRICE", name: "Dijon Mustard", categoryName: UNCATEGORIZED, price: 0 },
    ]);

    const item = validateMenuImport(
      mk([{ name: "Panini", price: 9.5, description: "with Pastrami, Dijon Mustard," }]),
    );
    expect(item.products).toEqual([
      {
        name: "Panini",
        description: "with Pastrami, Dijon Mustard,",
        price: 9.5,
        categoryName: UNCATEGORIZED,
      },
    ]);
    expect(item.report.dropped).toEqual([]);
  });

  it("keeps a genuinely free item, at 0", () => {
    const { products } = validateMenuImport(
      mk([{ name: "Pain", description: "offert", price: 0 }]),
    );
    expect(products).toEqual([
      { name: "Pain", description: "offert", price: 0, categoryName: UNCATEGORIZED },
    ]);
  });
});

// ── validateMenuImport: shape ───────────────────────────────────────

describe("validateMenuImport — shape", () => {
  it("drops a category whose every listing was removed", () => {
    const { categories, products, report } = validateMenuImport(
      mk(
        [
          { name: "Couscous", price: 12, categoryName: "PLATS" },
          { name: "V: Vegan", categoryName: "EXTRAS" },
        ],
        ["PLATS", "EXTRAS"],
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Couscous"]);
    expect(categories.map((c) => c.name)).toEqual(["PLATS"]);
    expect(report.droppedCategories).toEqual(["EXTRAS"]);
  });

  it("keeps one row per dish per section and prefers the richer row", () => {
    const { products, report } = validateMenuImport(
      mk([
        { name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" },
        { name: "cappuccino", description: "milk foam", categoryName: "CAFÉS" },
      ]),
    );
    expect(products).toEqual([
      { name: "Cappuccino", description: "", price: 4.5, categoryName: "CAFÉS" },
    ]);
    expect(report.dropped).toEqual([
      { reason: "DUPLICATE", name: "cappuccino", categoryName: "CAFÉS", price: 0 },
    ]);
  });

  it("floors a negative price at 0 and rounds to millimes", () => {
    const { products, report } = validateMenuImport(
      mk([
        { name: "Couscous", price: 1200.0004 },
        { name: "Brik", price: -3, description: "offerte" },
      ]),
    );
    expect(products).toEqual([
      { name: "Couscous", description: "", price: 1200, categoryName: UNCATEGORIZED },
      { name: "Brik", description: "offerte", price: 0, categoryName: UNCATEGORIZED },
    ]);
    expect(report.pricesAdjusted).toBe(2);
  });

  it("never renames or invents a row", () => {
    const { products } = validateMenuImport(
      mk([{ name: "  Brik   à l'Œuf ", price: 2.5 }]),
    );
    expect(products).toEqual([
      { name: "Brik à l'Œuf", description: "", price: 2.5, categoryName: UNCATEGORIZED },
    ]);
  });
});

// ── mergeStructuredMenu: the merge that replaced the union ──────────

describe("mergeStructuredMenu", () => {
  it("does not union: the parser's fragment and its misread price never reach the result", () => {
    const structured = mk([{ name: "Couscous", price: 1200, categoryName: "PLATS" }]);
    // What the deterministic parser holds for the same card: "Couscous 1 200"
    // read as 1.2 (its millime convention), plus the two rows that made the
    // union's 36 junk products.
    const parser = mk(
      [
        { name: "Couscous", price: 1.2, categoryName: "PLATS" },
        { name: "Cauliflower &", price: 0, categoryName: "PLATS" },
        { name: "FOOD & DRINKS", price: 0, categoryName: "PLATS" },
      ],
      ["PLATS"],
    );

    const { result, recovered, report } = mergeStructuredMenu(structured, parser);

    expect(result.products).toEqual([
      { name: "Couscous", description: "", price: 1200, categoryName: "PLATS" },
    ]);
    expect(result.categories.map((c) => c.name)).toEqual(["PLATS"]);
    expect(recovered).toBe(0);
    expect(report.dropped).toEqual([]);
    expect(result.stats.source).toBe("llm");
  });

  it("recovers a priced line the structurer dropped, with its section", () => {
    const structured = mk([{ name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" }]);
    const parser = mk(
      [
        { name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" },
        { name: "Thé à la menthe", price: 2.5, categoryName: "BOISSONS" },
      ],
      ["CAFÉS", "BOISSONS"],
    );

    const { result, recovered } = mergeStructuredMenu(structured, parser);

    expect(result.products).toEqual([
      { name: "Cappuccino", description: "", price: 4.5, categoryName: "CAFÉS" },
      { name: "Thé à la menthe", description: "", price: 2.5, categoryName: "BOISSONS" },
    ]);
    expect(result.categories.map((c) => c.name)).toEqual(["CAFÉS", "BOISSONS"]);
    expect(recovered).toBe(1);
    expect(result.stats).toMatchObject({
      files: 1,
      pages: 2,
      source: "llm+parser",
      model: "meta/llama-3.2-11b-vision-instruct",
    });
  });

  it("adds the section of a recovered row the structurer never emitted", () => {
    const structured = mk([{ name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" }]);
    const parser = mk([{ name: "Thé", price: 2.5, categoryName: "BOISSONS" }], ["BOISSONS"]);

    const { result } = mergeStructuredMenu(structured, parser);

    expect(result.categories.map((c) => c.name)).toEqual(["CAFÉS", "BOISSONS"]);
  });

  it("never recovers an un-priced row", () => {
    const structured = mk([{ name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" }]);
    const parser = mk([{ name: "milk foam", price: 0, categoryName: "CAFÉS" }], ["CAFÉS"]);

    const { result, recovered } = mergeStructuredMenu(structured, parser);

    expect(result.products.map((p) => p.name)).toEqual(["Cappuccino"]);
    expect(recovered).toBe(0);
  });

  it("does not credit the parser for a recovered row the gate removes", () => {
    const structured = mk([{ name: "Cappuccino", price: 4.5, categoryName: "CAFÉS" }]);
    const parser = mk(
      [
        {
          name: "12 Rue de Marseille · Tunis · Tél. 71 245 890",
          price: 9999,
          categoryName: "CAFÉS",
        },
      ],
      ["CAFÉS"],
    );

    const { result, recovered, report } = mergeStructuredMenu(structured, parser);

    expect(result.products.map((p) => p.name)).toEqual(["Cappuccino"]);
    expect(recovered).toBe(0);
    expect(result.stats.source).toBe("llm");
    expect(report.dropped.map((d) => d.reason)).toEqual(["VENUE_CONTACT"]);
  });
});

// ── parseLlmJsonObject: a chat reply is not a JSON document ─────────

describe("parseLlmJsonObject", () => {
  it("parses a bare JSON object, nested keys included", () => {
    const parsed = parseLlmJsonObject('{"categories":[{"name":"CAFÉS"}],"products":[]}');
    expect(parsed).toEqual({
      ok: true,
      value: { categories: [{ name: "CAFÉS" }], products: [] },
    });
  });

  it("takes the outermost object out of a fenced or preamble-carrying reply", () => {
    expect(parseLlmJsonObject('```json\n{"a":{"b":1}}\n```')).toEqual({
      ok: true,
      value: { a: { b: 1 } },
    });
    expect(parseLlmJsonObject('Voici le menu :\n{"a":1}\nBon appétit !')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("types the failure instead of throwing", () => {
    // Truncated by the token ceiling, prose (what four of the five entitled
    // models actually answered), an array, and a non-string body.
    expect(parseLlmJsonObject('{"categories":[{"name":').ok).toBe(false);
    expect(parseLlmJsonObject("I could not read this menu.").ok).toBe(false);
    expect(parseLlmJsonObject("[1,2,3]").ok).toBe(false);
    expect(parseLlmJsonObject(null).ok).toBe(false);
  });
});

// ── The prompt contract ─────────────────────────────────────────────

// The rule block is what the benchmark measured (15s, 20/20 priced, zero junk).
// Two of its rules are load-bearing and fail in the SILENT direction: without
// the thousands-separator rule and the Arabic-Indic digit rule the model drops
// priced lines instead of emitting junk, which no other assertion in this suite
// can catch.
describe("MENU_STRUCTURE_RULES", () => {
  it("keeps the price conversions the deterministic parser gets wrong", () => {
    expect(MENU_STRUCTURE_RULES).toMatch(/THOUSANDS separator: "1 200" means 1200/);
    expect(MENU_STRUCTURE_RULES).toMatch(/Arabic-Indic/);
    expect(MENU_STRUCTURE_RULES).toMatch(/millimes/);
    expect(MENU_STRUCTURE_RULES).toMatch(/Never drop a\s+priced line/);
    expect(MENU_STRUCTURE_RULES).toMatch(/ONLY the JSON object/);
  });

  // The regression these pin: this constant was once committed with every
  // non-Latin glyph stripped out of it — the Arabic-Indic digits replaced by
  // ASCII "0123456789", no `٫` separator, and not one Arabic letter left in the
  // file — so rules 1, 5 and 6 asked the model to read characters the prompt
  // never showed it, and a live run captured the Arabic-Indic line
  // "قهوة عربية ٢٫٥٠٠" on one scan and dropped it on the next. Asserting the
  // word "Arabic" is exactly what let that through: it survives the strip. The
  // expected characters are written as escapes on purpose, so a normalizing
  // editor cannot quietly rewrite this test into agreement with a stripped
  // constant.

  it("carries the Arabic-Indic digits themselves, not an ASCII stand-in", () => {
    const digits = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";
    expect(MENU_STRUCTURE_RULES).toContain(digits);
    // The stripped form was `Arabic-Indic digits 0123456789 are 0-9`: ASCII
    // digits claimed to be Arabic-Indic. That claim must never come back.
    expect(MENU_STRUCTURE_RULES).not.toMatch(/Arabic-Indic digits [0-9]/);
  });

  it("carries the Arabic decimal and thousands separators", () => {
    expect(MENU_STRUCTURE_RULES).toContain("\u066B"); // ٫ — the decimal separator
    expect(MENU_STRUCTURE_RULES).toContain("\u066C"); // ٬ — the thousands separator
  });

  it("carries Arabic letters, so the Arabic-script rules have an anchor", () => {
    expect(MENU_STRUCTURE_RULES).toContain("\u0642\u0647\u0648\u0629"); // قهوة
    expect(MENU_STRUCTURE_RULES).toContain("\u0639\u0631\u0628\u064A\u0629"); // عربية
    expect(MENU_STRUCTURE_RULES).toMatch(/[\u0600-\u06FF]{3,}/);
  });

  it("carries the worked Arabic price example next to the ASCII ones", () => {
    expect(MENU_STRUCTURE_RULES).toContain('"\u0662\u066B\u0665\u0660\u0660" means 2.5');
    expect(MENU_STRUCTURE_RULES).toContain('"\u0661\u0662" means 12');
    expect(MENU_STRUCTURE_RULES).toContain('"\u0642\u0647\u0648\u0629 \u0639\u0631\u0628\u064A\u0629 \u0662\u066B\u0665\u0660\u0660"');
    // The ASCII conversions are not sacrificed to the Arabic ones.
    expect(MENU_STRUCTURE_RULES).toContain('"12,5" and "12.5" both mean 12.5');
    expect(MENU_STRUCTURE_RULES).toContain('"4.500 DT" means 4.5');
    expect(MENU_STRUCTURE_RULES).toContain('"1 200" means 1200');
    // The French section title the real cards print, accent included.
    expect(MENU_STRUCTURE_RULES).toContain('"BOISSONS FROIDES", "PLATS";');
    expect(MENU_STRUCTURE_RULES).toContain('"CAF\u00C9S"');
  });
});
