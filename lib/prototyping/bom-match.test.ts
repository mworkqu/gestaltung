import { describe, expect, it } from "vitest";

import type { Candidate, LineMatch, ProjectLine } from "./bom";
import { matchLine, packExceedsNeed, packLineCount, weakSuggestion } from "./bom-match";

let n = 0;
function part(over: Partial<Candidate>): Candidate {
  n += 1;
  return {
    id: `p${n}`,
    sku: `GR-${String(n).padStart(3, "0")}`,
    name: "Part",
    name_ar: null,
    description: null,
    description_ar: null,
    category: "Diodes",
    material: null,
    standard: null,
    unit_price: 1,
    min_order_qty: 1,
    stock_status: "in_stock",
    image_url: null,
    is_published: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    attributes: null,
    pack_size: 1,
    ...over,
  };
}

const flyback: ProjectLine = {
  id: "d1",
  function: "Flyback diode",
  spec: "rectifier, 1 A, 400 V+",
  quantity: 1,
  kind: "electronics",
  critical: false,
  class: "diode",
  attributes: { diode_type: "rectifier", current_a: 1, voltage_v: 400 },
};

const match = (line: ProjectLine, catalogue: Candidate[]) => matchLine(line, catalogue, [], new Map());

describe("matchLine — diodes (audit #2)", () => {
  const untyped4148 = part({ name: "Diode 1N4148", unit_price: 30, pack_size: 100 });
  const rectifier4007 = part({
    name: "Diode 1N4007",
    attributes: { class: "diode", diode_type: "rectifier", current_a: 1, voltage_v: 1000 },
  });
  const signal4148 = part({
    name: "Diode 1N4148",
    attributes: { class: "diode", diode_type: "signal", current_a: 0.2, voltage_v: 100 },
  });

  it("an untyped 1N4148 is weak, and is picked as our best match (auto) until the client changes it", () => {
    const m = match(flyback, [untyped4148]);
    expect(m.candidates.map((c) => [c.id, c.strength])).toEqual([[untyped4148.id, "weak"]]);
    expect(m.product?.id).toBe(untyped4148.id);
    expect(m.auto).toBe(true);
    expect(m.status).toBe("matched");
    expect(weakSuggestion(m)).toBeNull();
  });

  it("a typed rectifier 1N4007, 1 A 1000 V, is a strong match and resolves the line", () => {
    const m = match(flyback, [rectifier4007, untyped4148]);
    expect(m.product?.id).toBe(rectifier4007.id);
    expect(m.product?.strength).toBe("strong");
    expect(m.status).toBe("matched");
    expect(weakSuggestion(m)).toBeNull();
  });

  it("a typed signal 1N4148 is excluded", () => {
    const m = match(flyback, [signal4148]);
    expect(m.candidates).toEqual([]);
    expect(m.status).toBe("not_stocked");
  });

  it("a rectifier rated below the line's current or voltage is excluded", () => {
    const small = part({ attributes: { class: "diode", diode_type: "rectifier", current_a: 0.2, voltage_v: 1000 } });
    const lowV = part({ attributes: { class: "diode", diode_type: "rectifier", current_a: 1, voltage_v: 100 } });
    expect(match(flyback, [small, lowV]).candidates).toEqual([]);
  });

  it("a rectifier with no ratings on the product is weak, not strong", () => {
    const bare = part({ attributes: { class: "diode", diode_type: "rectifier" } });
    const m = match(flyback, [bare]);
    expect(m.candidates[0]?.strength).toBe("weak");
    expect(m.auto).toBe(true);
  });

  it("the client's explicit pick of the suggestion resolves the line", () => {
    const m = match({ ...flyback, choice: untyped4148.id }, [untyped4148]);
    expect(m.product?.id).toBe(untyped4148.id);
    expect(m.auto).toBeUndefined();
    expect(m.status).toBe("matched");
    expect(weakSuggestion(m)).toBeNull();
  });
});

describe("pack sizes", () => {
  it("packExceedsNeed: need 1 of a pack of 100 is over; exact packs or single units are not", () => {
    expect(packExceedsNeed(1, { pack_size: 100, min_order_qty: 1 })).toBe(true);
    expect(packExceedsNeed(100, { pack_size: 100, min_order_qty: 1 })).toBe(false);
    expect(packExceedsNeed(3, { pack_size: 1, min_order_qty: 1 })).toBe(false);
    expect(packExceedsNeed(12, { pack_size: 10, min_order_qty: 1 })).toBe(true);
  });

  it("packLineCount counts only lines in 'to buy now'", () => {
    const pack = { ...part({ pack_size: 100 }), strength: "strong" as const, why: [] };
    const lines: ProjectLine[] = [
      { ...flyback, id: "a" },
      { ...flyback, id: "b", fulfilled: { orderId: "o", at: "", productId: pack.id, sku: pack.sku, quantity: 1 } },
      { ...flyback, id: "c" },
      { ...flyback, id: "d" },
    ];
    const m = (lineId: string, over: Partial<LineMatch>): [string, LineMatch] => [
      lineId,
      { lineId, status: "matched", candidates: [pack], product: pack, have: null, ...over },
    ];
    const matches = new Map([
      m("a", {}),
      m("b", { status: "fulfilled" }),
      m("c", { have: { name: "x", quantity: 5 }, status: "have" }),
      m("d", { status: "choose", product: null }),
    ]);
    expect(packLineCount(lines, matches)).toBe(1);
  });
});
