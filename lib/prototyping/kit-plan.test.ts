import { describe, expect, it } from "vitest";

import { bomCost, type LineMatch, type ProjectLine, type ScoredCandidate } from "./bom";
import { cartLineIds, kitDiscountQar, kitPlan } from "./kit-plan";

const product = (id: string, price: number, extra: Partial<ScoredCandidate> = {}): ScoredCandidate =>
  ({
    id,
    sku: id.toUpperCase(),
    name: id,
    name_ar: null,
    unit_price: price,
    stock_status: "in_stock",
    min_order_qty: 1,
    pack_size: 1,
    strength: "strong",
    why: [],
    ...extra,
  }) as unknown as ScoredCandidate;

const line = (id: string, quantity = 1, extra: Partial<ProjectLine> = {}): ProjectLine => ({
  id,
  function: id,
  spec: "",
  quantity,
  kind: "electronics",
  critical: false,
  ...extra,
});

const matched = (lineId: string, p: ScoredCandidate): LineMatch => ({ lineId, status: "matched", candidates: [p], product: p, have: null });

const screws = product("screws", 1, { name: "M3 Screws – 5 Pcs" });
const esp32 = product("esp32", 39);
const dkResistor = product("dk-10k", 6, { name: "Resistor 10 kΩ (pack of 10)", pack_size: 10, lead_time_class: "1_2_weeks" });

describe("kitPlan", () => {
  const lines = [
    line("m3_screws", 4, { kind: "mechanical", function: "M3 screws" }),
    line("board"),
    line("res_10k"),
    line("level_shifter", 1, { function: "Logic level shifter" }),
    line("tubing", 1, { function: "Silicone tubing", kind: "consumable" }),
  ];
  const matches = new Map<string, LineMatch>([
    ["m3_screws", matched("m3_screws", screws)],
    ["board", matched("board", esp32)],
    ["res_10k", matched("res_10k", dkResistor)],
    // Only weak candidates: we pick it.
    ["level_shifter", { lineId: "level_shifter", status: "choose", candidates: [product("analyser", 49, { strength: "weak" })], product: null, have: null }],
    // Nothing in the store: we source it.
    ["tubing", { lineId: "tubing", status: "not_stocked", candidates: [], product: null, have: null }],
  ]);

  it("4 screws in packs of 5 add 1 pack", () => {
    const plan = kitPlan(lines, matches);
    const s = plan.add.find((k) => k.lineId === "m3_screws")!;
    expect(s.need).toBe(4);
    expect(s.packSize).toBe(5);
    expect(s.packs).toBe(1);
    expect(plan.rows.find((r) => r.product.id === "screws")!.quantity).toBe(1);
  });

  it("adds every line we sell, a supplier (DigiKey) product included", () => {
    const plan = kitPlan(lines, matches);
    expect(plan.add.map((k) => k.lineId)).toEqual(["m3_screws", "board", "res_10k"]);
  });

  it("lists the lines it cannot add as sourced, never drops them", () => {
    const plan = kitPlan(lines, matches);
    expect(plan.sourced).toEqual([
      { lineId: "level_shifter", name: "Logic level shifter", reason: "we_pick" },
      { lineId: "tubing", name: "Silicone tubing", reason: "we_source" },
    ]);
    // Every live line is accounted for.
    expect(plan.add.length + plan.sourced.length + plan.inCart.length).toBe(lines.length);
  });

  it("an out-of-stock product goes to the sourced list", () => {
    const gone = product("gone", 5, { stock_status: "out_of_stock" });
    const plan = kitPlan([line("x")], new Map([["x", matched("x", gone)]]));
    expect(plan.add).toEqual([]);
    expect(plan.sourced).toEqual([{ lineId: "x", name: "x", reason: "we_source" }]);
  });

  it("a line with no store match at all goes to the sourced list", () => {
    const plan = kitPlan([line("y")], new Map([["y", { lineId: "y", status: "not_stocked", candidates: [], product: null, have: null }]]));
    expect(plan.sourced.map((x) => x.reason)).toEqual(["we_source"]);
  });

  it("the total equals the sum of what is actually added", () => {
    const plan = kitPlan(lines, matches, { discountPct: 5 });
    const written = plan.rows.reduce((s, r) => s + Number(r.product.unit_price) * r.quantity, 0);
    expect(plan.goods).toBe(written);
    expect(plan.goods).toBe(1 + 39 + 6);
    expect(plan.discount).toBe(kitDiscountQar(written, 5));
    expect(plan.total).toBe(Math.round((written - kitDiscountQar(written, 5)) * 100) / 100);
  });

  it("matches the cost summary's To buy now when nothing is in the cart", () => {
    const plan = kitPlan(lines, matches);
    expect(plan.goods).toBe(bomCost(lines, matches).availableNow);
  });

  it("two lines on one product make one cart row with both lines and their packs", () => {
    const ls = [line("r1"), line("r2")];
    const m = new Map([
      ["r1", matched("r1", dkResistor)],
      ["r2", matched("r2", dkResistor)],
    ]);
    const plan = kitPlan(ls, m);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].quantity).toBe(2);
    expect(plan.rows[0].bomLines).toEqual(["r1", "r2"]);
    expect(plan.goods).toBe(12);
  });

  it("skips lines already in the cart, bought, owned or made to order", () => {
    const ls = [
      line("board"),
      line("bought", 1, { fulfilled: { orderId: "o1", at: "", productId: "esp32", sku: "ESP32", quantity: 1 } }),
      line("owned"),
      line("pcb", 1, { group: "fabrication" }),
    ];
    const m = new Map<string, LineMatch>([
      ["board", matched("board", esp32)],
      ["bought", { lineId: "bought", status: "fulfilled", candidates: [], product: esp32, have: null }],
      ["owned", { lineId: "owned", status: "have", candidates: [], product: null, have: { name: "ESP32", quantity: 1 } }],
      ["pcb", { lineId: "pcb", status: "fabrication", candidates: [], product: null, have: null }],
    ]);
    const plan = kitPlan(ls, m, { inCart: new Set(["board"]) });
    expect(plan.add).toEqual([]);
    expect(plan.sourced).toEqual([]);
    expect(plan.inCart).toEqual(["board"]);
    expect(plan.total).toBe(0);
  });
});

describe("cartLineIds", () => {
  it("collects the BOM lines held by this project's cart lines only", () => {
    const ids = cartLineIds(
      [
        { projectId: "p1", bomLines: ["a", "b"] },
        { projectId: "p2", bomLines: ["c"] },
        { projectId: null, bomLines: ["d"] },
        { projectId: "p1" },
      ],
      "p1"
    );
    expect([...ids]).toEqual(["a", "b"]);
  });
});

describe("kitDiscountQar", () => {
  it("rounds to the cent and clamps the percentage", () => {
    expect(kitDiscountQar(199, 5)).toBe(9.95);
    expect(kitDiscountQar(100, 0)).toBe(0);
    expect(kitDiscountQar(100, 200)).toBe(90);
  });
});
