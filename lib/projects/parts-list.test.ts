import { describe, expect, it } from "vitest";

import type { LineMatch, ProjectBom, ProjectLine, ScoredCandidate } from "@/lib/prototyping/bom";
import { cartProductsByLine, lineStatus, projectCartTotal, projectPartsList, statusCounts } from "./parts-list";

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

const line = (id: string, extra: Partial<ProjectLine> = {}): ProjectLine => ({
  id,
  function: id,
  spec: "",
  quantity: 1,
  kind: "electronics",
  critical: false,
  ...extra,
});

const bought = (orderId: string) => ({ orderId, at: "2026-10-10", productId: "p", sku: "P", quantity: 1 });
const none = { inCart: new Set<string>(), orderStatuses: new Map<string, string>() };

describe("lineStatus", () => {
  it("to buy: no cart line, no order", () => {
    expect(lineStatus(line("a"), undefined, none)).toBe("to_buy");
  });

  it("in your cart: a cart line of this project holds it", () => {
    expect(lineStatus(line("a"), undefined, { ...none, inCart: new Set(["a"]) })).toBe("in_cart");
  });

  it("ordered: an open order carries it, whatever the cart says", () => {
    const l = line("a", { fulfilled: bought("o1") });
    expect(lineStatus(l, undefined, { inCart: new Set(["a"]), orderStatuses: new Map([["o1", "shipped"]]) })).toBe("ordered");
    // Old status values read through normaliseOrderStatus.
    expect(lineStatus(l, undefined, { ...none, orderStatuses: new Map([["o1", "processing"]]) })).toBe("ordered");
  });

  it("delivered: its order is delivered", () => {
    const l = line("a", { fulfilled: bought("o1") });
    expect(lineStatus(l, undefined, { ...none, orderStatuses: new Map([["o1", "delivered"]]) })).toBe("delivered");
  });

  it("a cancelled order counts as never placed", () => {
    const l = line("a", { fulfilled: bought("o1") });
    const cancelled = new Map([["o1", "cancelled"]]);
    expect(lineStatus(l, undefined, { inCart: new Set(), orderStatuses: cancelled })).toBe("to_buy");
    expect(lineStatus(l, undefined, { inCart: new Set(["a"]), orderStatuses: cancelled })).toBe("in_cart");
  });

  it("a bought line whose order can't be read stays ordered (never a guess at delivered)", () => {
    expect(lineStatus(line("a", { fulfilled: bought("o1") }), undefined, { ...none, orderStatuses: null })).toBe("ordered");
  });

  it("you have it: the client already owns it", () => {
    const m: LineMatch = { lineId: "a", status: "have", candidates: [], product: null, have: { name: "ESP32", quantity: 1 } };
    expect(lineStatus(line("a"), m, none)).toBe("have");
  });
});

describe("projectPartsList", () => {
  const screws = product("screws", 1, { name: "M3 Screws – 5 Pcs" });
  const bom: ProjectBom = {
    analysedAt: "2026-10-10",
    lines: [
      line("m3", { function: "M3 screws", quantity: 4, kind: "mechanical" }),
      line("shifter", { function: "Logic level shifter" }),
      line("tubing", { function: "Silicone tubing", kind: "consumable" }),
      line("board", { function: "Development board", fulfilled: bought("o1") }),
      line("gone", { function: "Removed line" }),
    ],
    dismissed: ["gone"],
  };
  const matches = new Map<string, LineMatch>([
    ["m3", { lineId: "m3", status: "matched", candidates: [screws], product: screws, have: null }],
    ["shifter", { lineId: "shifter", status: "choose", candidates: [product("x", 9, { strength: "weak" })], product: null, have: null }],
    ["tubing", { lineId: "tubing", status: "not_stocked", candidates: [], product: null, have: null }],
    ["board", { lineId: "board", status: "fulfilled", candidates: [], product: product("esp32", 39), have: null }],
  ]);

  const list = projectPartsList(bom, matches, { inCart: new Set(["m3"]), orderStatuses: new Map([["o1", "delivered"]]) });

  it("is the workspace list: the same live lines, removed ones left out", () => {
    expect(list.map((l) => l.lineId)).toEqual(["m3", "shifter", "tubing", "board"]);
  });

  it("gives each line one status from the cart and orders", () => {
    expect(list.map((l) => l.status)).toEqual(["in_cart", "to_buy", "to_buy", "delivered"]);
    expect(statusCounts(list)).toEqual({ to_buy: 2, in_cart: 1, ordered: 0, delivered: 1, have: 0 });
  });

  it("says in plain words what we do for lines the store can't sell", () => {
    expect(list.map((l) => l.source)).toEqual(["store", "we_pick", "we_source", "store"]);
    expect(list[1].product).toBeNull();
  });

  it("carries the pack maths: need 4 · 1 pack of 5", () => {
    expect(list[0]).toMatchObject({ need: 4, packSize: 5, packs: 1 });
  });

  it("shows no product before the store match is back", () => {
    const early = projectPartsList(bom, new Map(), none);
    expect(early.slice(0, 3).map((l) => l.source)).toEqual([null, null, null]);
  });

  it("an empty bill of materials is an empty list", () => {
    expect(projectPartsList(null, matches, none)).toEqual([]);
  });
});

describe("projectCartTotal", () => {
  it("prices this project's lines the way the cart does: kits less the kit discount", () => {
    const items = [
      { projectId: "p1", kitId: "k1", unitPrice: 39, quantity: 1 },
      { projectId: "p1", kitId: "k1", unitPrice: 1, quantity: 1 },
      { projectId: "p1", kitId: null, unitPrice: 20, quantity: 2 },
      { projectId: "p2", kitId: null, unitPrice: 100, quantity: 1 },
      { projectId: null, kitId: null, unitPrice: 5, quantity: 1 },
    ];
    expect(projectCartTotal(items, "p1", 0)).toBe(80);
    expect(projectCartTotal(items, "p1", 10)).toBe(76);
  });
});

describe("cartProductsByLine", () => {
  it("an in-cart line names the product its cart line really holds", () => {
    const items = [
      { projectId: "p1", bomLines: ["pir"], partId: "ls", sku: "LS", name: "Limit Switch Module", nameAr: null, unitPrice: 4 },
      { projectId: "p2", bomLines: ["pir"], partId: "x", sku: "X", name: "Other project", nameAr: null, unitPrice: 1 },
    ];
    const cartProducts = cartProductsByLine(items, "p1");
    const pir = product("am312", 11, { name: "AM312 PIR" });
    const bom: ProjectBom = { analysedAt: "", lines: [line("pir")] };
    const m = new Map<string, LineMatch>([["pir", { lineId: "pir", status: "matched", candidates: [pir], product: pir, have: null }]]);
    const [row] = projectPartsList(bom, m, { inCart: new Set(["pir"]), orderStatuses: null, cartProducts });
    expect(row.status).toBe("in_cart");
    expect(row.product?.name).toBe("Limit Switch Module");
  });
});
