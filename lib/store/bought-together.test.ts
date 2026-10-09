import { describe, expect, it } from "vitest";

import type { StoreCardPart } from "@/lib/store/catalog";
import {
  categoriesOf,
  inSkuOrder,
  mergeBoughtTogether,
  parseCoPurchased,
  pickAlsoUseful,
  rankInStockFirst,
} from "@/lib/store/bought-together";

const card = (sku: string, extra: Partial<StoreCardPart> = {}): StoreCardPart => ({
  id: `id-${sku}`,
  sku,
  name: sku,
  name_ar: null,
  unit_price: 10,
  image_url: "https://cdn.example/x.jpg",
  category: "Sensors",
  min_order_qty: 1,
  lead_time_class: "in_stock",
  ...extra,
});

const skus = (ps: readonly StoreCardPart[]) => ps.map((p) => p.sku);

describe("parseCoPurchased", () => {
  it("keeps the RPC order and drops junk", () => {
    expect(
      parseCoPurchased([
        { sku: "B", orders: 5 },
        { sku: "A", orders: 2 },
        { sku: "", orders: 9 },
        { sku: "Z", orders: 0 },
        { orders: 3 },
        null,
        "C",
        { sku: "B", orders: 1 },
      ])
    ).toEqual(["B", "A"]);
  });

  it("reads anything that is not an array (function missing before 0057, error body) as none", () => {
    expect(parseCoPurchased(null)).toEqual([]);
    expect(parseCoPurchased({ code: "PGRST202" })).toEqual([]);
    expect(parseCoPurchased(undefined)).toEqual([]);
  });
});

describe("inSkuOrder", () => {
  it("restores the ranked order and drops SKUs that have no row (unpublished)", () => {
    expect(skus(inSkuOrder([card("A"), card("C"), card("B")], ["B", "X", "A"]))).toEqual(["B", "A"]);
  });
});

describe("rankInStockFirst", () => {
  it("puts in stock first, then the shorter delivery class, then with a photo; ties stay stable", () => {
    const ranked = rankInStockFirst([
      card("slow", { lead_time_class: "2_4_weeks" }),
      card("onreq", { lead_time_class: null }),
      card("nophoto", { image_url: null }),
      card("week", { lead_time_class: "1_2_weeks" }),
      card("stock1"),
      card("stock2"),
    ]);
    expect(skus(ranked)).toEqual(["stock1", "stock2", "nophoto", "week", "slow", "onreq"]);
  });
});

describe("mergeBoughtTogether", () => {
  it("is 'together' when three co-purchased products exist", () => {
    const r = mergeBoughtTogether({
      together: [card("A"), card("B"), card("C"), card("D")],
      fallback: [card("F1")],
      currentSku: "X",
    });
    expect(skus(r.parts)).toEqual(["A", "B", "C"]);
    expect(r.source).toBe("together");
  });

  it("falls back to the category, in stock first, when the RPC gave nothing (0057 not run)", () => {
    const r = mergeBoughtTogether({
      together: [],
      fallback: [card("late", { lead_time_class: "2_4_weeks" }), card("X"), card("S1"), card("S2")],
      currentSku: "X",
    });
    expect(skus(r.parts)).toEqual(["S1", "S2", "late"]);
    expect(r.source).toBe("category");
  });

  it("tops up fewer than three co-purchased products and then says 'category' (honest heading)", () => {
    const r = mergeBoughtTogether({
      together: [card("A")],
      fallback: [card("A"), card("F1"), card("F2"), card("F3")],
      currentSku: "X",
    });
    expect(skus(r.parts)).toEqual(["A", "F1", "F2"]);
    expect(r.source).toBe("category");
  });

  it("keeps 'together' when fewer than three were bought together and nothing else is available", () => {
    const r = mergeBoughtTogether({ together: [card("A"), card("B")], fallback: [card("X")], currentSku: "X" });
    expect(skus(r.parts)).toEqual(["A", "B"]);
    expect(r.source).toBe("together");
  });

  it("never shows the current product or a duplicate", () => {
    const r = mergeBoughtTogether({
      together: [card("X"), card("A"), card("A")],
      fallback: [card("X"), card("A"), card("B")],
      currentSku: "X",
    });
    expect(skus(r.parts)).toEqual(["A", "B"]);
  });

  it("returns an empty list when there is nothing at all", () => {
    expect(mergeBoughtTogether({ together: [], fallback: [], currentSku: "X" })).toEqual({ parts: [], source: "category" });
  });
});

describe("categoriesOf / pickAlsoUseful", () => {
  it("collects distinct store categories of the BOM's products", () => {
    expect(categoriesOf([card("A"), null, card("B", { category: "Motors" }), card("C"), { category: " " }])).toEqual([
      "Sensors",
      "Motors",
    ]);
  });

  it("leaves out SKUs already on the BOM and ranks in stock first", () => {
    const picked = pickAlsoUseful({
      pool: [card("onBom"), card("slow", { lead_time_class: "1_2_weeks" }), card("P1"), card("P2"), card("P3")],
      excludeSkus: ["onBom"],
    });
    expect(skus(picked)).toEqual(["P1", "P2", "P3"]);
  });
});
