import { describe, it, expect } from "vitest";
import { assessOcrQuality } from "./ocr-quality";

// ── assessOcrQuality ───────────────────────────────────────────────

describe("assessOcrQuality", () => {
  it("accepts a normal structured menu", () => {
    const q = assessOcrQuality(`# Café Aziz
## Coffees
Espresso 4.5 DT
Cappuccino 5 DT
Latte 6 DT
## Salades
César 12.5`);
    expect(q.ok).toBe(true);
    expect(q.reason).toBeNull();
    expect(q.headings).toBe(3);
    expect(q.items).toBe(4);
    expect(q.priced).toBe(4);
  });

  it("accepts a real small menu (1 category, 2 products)", () => {
    const q = assessOcrQuality(`## Petit Déjeuner
Café 2
Jus 3`);
    expect(q.ok).toBe(true);
    expect(q.items).toBe(2);
  });

  it("accepts a headingless 2-item mini price list", () => {
    const q = assessOcrQuality("Café 2\nJus 3");
    expect(q.ok).toBe(true);
    expect(q.headings).toBe(0);
  });

  it("accepts bullet-style items and separators", () => {
    const q = assessOcrQuality(`## Menu
- Poulet 12
- Poisson 15
=====
Grillades 18`);
    expect(q.ok).toBe(true);
    expect(q.items).toBe(3);
  });

  it("accepts a single heading with a single item", () => {
    const q = assessOcrQuality(`## Boissons
Coca 5`);
    expect(q.ok).toBe(true);
  });

  it("rejects a headingless menu with 3+ item lines (degraded signature)", () => {
    const q = assessOcrQuality("Cappuccino 4.5\nSalade 6\nPizza 12");
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("NO_STRUCTURE");
    expect(q.items).toBe(3);
    expect(q.headings).toBe(0);
  });

  it("rejects empty text", () => {
    const q = assessOcrQuality("");
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("EMPTY_TEXT");
  });

  it("rejects whitespace-only text", () => {
    expect(assessOcrQuality("  \n\n\t  ").reason).toBe("EMPTY_TEXT");
  });

  it("rejects non-string input", () => {
    expect(assessOcrQuality(null).reason).toBe("EMPTY_TEXT");
    expect(assessOcrQuality(undefined).reason).toBe("EMPTY_TEXT");
    expect(assessOcrQuality(42).reason).toBe("EMPTY_TEXT");
  });

  it("rejects a document that is only page markers", () => {
    const q = assessOcrQuality(`<!-- page 1 -->

<!-- page 2 -->`);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("NO_ITEMS");
    expect(q.items).toBe(0);
  });

  it("rejects headings with no items under them", () => {
    const q = assessOcrQuality(`## Coffees

## Desserts`);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("NO_ITEMS");
  });

  it("rejects a document that ends on a heading (looks cut)", () => {
    const q = assessOcrQuality(`## Boissons
Café 2
## Desserts`);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("TRUNCATED");
  });

  it("counts only non-whitespace characters", () => {
    const q = assessOcrQuality("## A\nX\n\ny");
    expect(q.chars).toBe(5);
  });

  it("counts priced lines once even when name and price match", () => {
    const q = assessOcrQuality("Pizza 12\nPasta 10\nSalade");
    expect(q.priced).toBe(2);
  });
});