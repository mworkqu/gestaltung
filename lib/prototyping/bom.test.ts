import { describe, expect, it } from "vitest";

import {
  activeLines,
  bomCost,
  buyable,
  dedupeLines,
  groupLines,
  mergeBom,
  normaliseFunction,
  replaceLines,
  unstockedLines,
  viewLines,
  type LineMatch,
  type ProjectBom,
  type ProjectLine,
  type ScoredCandidate,
} from "./bom";
import { deriveElectronics } from "./electronics-rules";
import { plantLines, plantNetlist, tKey } from "./plant-monitor.fixture";

const product = (id: string, price: number): ScoredCandidate =>
  ({ id, sku: id.toUpperCase(), name: id, unit_price: price, stock_status: "in_stock", min_order_qty: 1, pack_size: 1, strength: "strong", why: [] }) as unknown as ScoredCandidate;

const match = (lineId: string, status: LineMatch["status"], p: ScoredCandidate | null = null): LineMatch => ({
  lineId,
  status,
  candidates: p ? [p] : [],
  product: p,
  have: null,
});

// The analysis's USB cable (a consumable) — the audit's duplicate.
const analysisUsb: ProjectLine = {
  id: "usb_cable",
  function: "USB Cable",
  spec: "to program the board",
  quantity: 1,
  kind: "consumable",
  critical: true,
  class: "consumable",
  attributes: { class: "consumable", consumable_type: "usb_cable" },
  group: "consumables",
  origin: "analysis",
};
const sealant: ProjectLine = {
  id: "sealant",
  function: "silicone sealant",
  spec: "clear",
  quantity: 1,
  kind: "consumable",
  critical: false,
  origin: "analysis",
};

/** The Plant monitor as built: electronics lines + our rule lines (prototype route). */
function plantBom(extra: ProjectLine[] = []): ProjectBom {
  const r = deriveElectronics({ netlist: plantNetlist(), lines: plantLines, route: "prototype", power: null, t: tKey });
  let bom = mergeBom(null, extra);
  bom = replaceLines(bom, ["electronics"], plantLines);
  return replaceLines(bom, ["rule"], r.lines);
}

describe("normaliseFunction", () => {
  it("ignores case, brackets, punctuation and plurals", () => {
    expect(normaliseFunction("USB Cables (micro-USB)")).toBe("usb cable");
    expect(normaliseFunction(" usb-cable ")).toBe("usb cable");
    expect(normaliseFunction("Glass")).toBe("glass");
  });
});

describe("dedupeLines (audit #29)", () => {
  const ruleUsb: ProjectLine = {
    id: "rule_usb_cable",
    function: "rule_usb_name",
    spec: "rule_usb_spec",
    quantity: 1,
    kind: "electronics",
    critical: true,
    class: "power",
    attributes: { class: "power", power_type: "usb_cable" },
    group: "consumables",
    origin: "rule",
  };

  it("merges the analysis's USB cable into the rule's: one line", () => {
    const out = dedupeLines([analysisUsb, ruleUsb]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("rule_usb_cable");
  });

  it("merges by normalised function when a side has no type", () => {
    const plain: ProjectLine = { ...analysisUsb, attributes: undefined, class: undefined, function: "USB cables" };
    const named: ProjectLine = { ...ruleUsb, function: "USB cable" };
    expect(dedupeLines([plain, named]).map((l) => l.id)).toEqual(["rule_usb_cable"]);
  });

  it("keeps the client's choice: the line the client picked a product on survives", () => {
    const out = dedupeLines([ruleUsb, { ...analysisUsb, choice: "p-usb" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("usb_cable");
    expect(out[0].choice).toBe("p-usb");
  });

  it("keeps the larger quantity", () => {
    expect(dedupeLines([analysisUsb, { ...ruleUsb, quantity: 2 }])[0].quantity).toBe(2);
    expect(dedupeLines([{ ...analysisUsb, quantity: 3 }, ruleUsb])[0].quantity).toBe(3);
  });

  it("a bought line wins and is never dropped", () => {
    const bought = { ...analysisUsb, fulfilled: { orderId: "o", at: "t", productId: "p", sku: "S", quantity: 1 } };
    expect(dedupeLines([bought, ruleUsb]).map((l) => l.id)).toEqual(["usb_cable"]);
    const both = { ...ruleUsb, fulfilled: bought.fulfilled };
    expect(dedupeLines([bought, both])).toHaveLength(2);
  });

  it("keeps the line the client removed, so the removal carries", () => {
    const out = dedupeLines([analysisUsb, ruleUsb], { dismissed: ["rule_usb_cable"] });
    expect(out.map((l) => l.id)).toEqual(["rule_usb_cable"]);
  });

  it("never merges lines of the same origin, nor a line with netlist refs, nor a kept id", () => {
    const r1 = { ...ruleUsb, id: "rule_res_330", function: "Resistor", attributes: {}, refs: ["R_LED1"] };
    const r2 = { ...r1, id: "rule_res_10000", refs: ["R_PU1"] };
    expect(dedupeLines([r1, r2])).toHaveLength(2);
    const a = { ...analysisUsb, function: "Resistor", attributes: {}, class: undefined };
    // Two rule twins: ambiguous, nothing merges.
    expect(dedupeLines([a, r1, r2])).toHaveLength(3);
    // One twin with refs: the analysis line goes, the circuit's line stays.
    expect(dedupeLines([a, r1]).map((l) => l.id)).toEqual(["rule_res_330"]);
    // Kept (drawn in the circuit): neither may go.
    expect(dedupeLines([analysisUsb, ruleUsb], { keep: new Set(["usb_cable", "rule_usb_cable"]) })).toHaveLength(2);
  });

  it("never drops an electronics line: the other source's twin goes", () => {
    const eUsb: ProjectLine = { ...ruleUsb, id: "e_cable", origin: "electronics" };
    expect(dedupeLines([{ ...ruleUsb, choice: "p1" }, eUsb]).map((l) => [l.id, l.choice])).toEqual([["e_cable", "p1"]]);
  });
});

describe("the Plant monitor BOM (audit #29)", () => {
  const bom = plantBom([analysisUsb, sealant]);

  it("lists the USB cable once", () => {
    const usb = bom.lines.filter((l) => /usb/i.test(l.function) && l.id !== "e_usb");
    expect(usb).toHaveLength(1);
    expect(activeLines(bom).filter((l) => l.id === "usb_cable")).toHaveLength(0);
  });

  it("a removed line stays removed after re-analysis", () => {
    const removed: ProjectBom = { ...bom, dismissed: ["rule_usb_cable"] };
    const again = mergeBom(removed, [analysisUsb, sealant]);
    // One USB cable line, the removed one: not live, listed under removed.
    expect(again.lines.filter((l) => l.id === "usb_cable" || l.id === "rule_usb_cable").map((l) => l.id)).toEqual([
      "rule_usb_cable",
    ]);
    expect(again.dismissed).toContain("rule_usb_cable");
    expect(activeLines(again).some((l) => /usb/i.test(l.function) && l.id !== "e_usb")).toBe(false);
    expect(viewLines(again, "all").dismissed.map((l) => l.id)).toContain("rule_usb_cable");
  });

  it("a stored BOM from before the fix (removed rule line + live analysis twin) reads as removed", () => {
    const stored: ProjectBom = { ...bom, lines: [...bom.lines, analysisUsb], dismissed: ["rule_usb_cable"] };
    const live = (l: ProjectLine) => l.id === "usb_cable" || l.id === "rule_usb_cable";
    expect(activeLines(stored).filter(live)).toHaveLength(0);
    for (const view of ["all", "electronics"] as const) {
      expect(viewLines(stored, view).lines.filter(live)).toHaveLength(0);
      expect(viewLines(stored, view).dismissed.map((l) => l.id)).toEqual(["rule_usb_cable"]);
    }
  });

  it("stays deduped when the analysis runs again after the build", () => {
    const again = mergeBom(bom, [{ ...analysisUsb, origin: undefined }, sealant]);
    expect(again.lines.filter((l) => l.id === "usb_cable" || l.id === "rule_usb_cable")).toHaveLength(1);
  });

  it("counts Build consumables the same in the Components view and the BOM, via one selector", () => {
    // A stored BOM from before the fix still holds both USB cables.
    const stored: ProjectBom = { ...bom, lines: [...bom.lines, analysisUsb] };
    const count = (view: "all" | "electronics") =>
      groupLines(viewLines(stored, view).lines).find((x) => x.g === "consumables")?.lines.filter((l) => l.id !== "sealant")
        .length;
    expect(count("electronics")).toBe(count("all"));
    // Breadboard, jumper wires, USB cable — prototype route only.
    expect(count("all")).toBe(3);
  });

  it("the electronics view leaves non-electronic consumables to the full BOM", () => {
    expect(viewLines(bom, "electronics").lines.some((l) => l.id === "sealant")).toBe(false);
    expect(viewLines(bom, "all").lines.some((l) => l.id === "sealant")).toBe(true);
  });
});

describe("bomCost (audit #26, #27)", () => {
  const bought = { orderId: "o1", at: "t", productId: "esp", sku: "ESP", quantity: 1 };
  const lines: ProjectLine[] = [
    { id: "a", function: "ESP32", spec: "", quantity: 1, kind: "electronics", critical: true, fulfilled: bought },
    { id: "b", function: "LED", spec: "", quantity: 4, kind: "electronics", critical: true },
    { id: "c", function: "Moisture probe", spec: "", quantity: 1, kind: "electronics", critical: true },
    { id: "d", function: "Custom PCB", spec: "", quantity: 1, kind: "electronics", critical: true, group: "fabrication" },
  ];
  const matches = new Map<string, LineMatch>([
    ["a", match("a", "fulfilled", product("esp", 35))],
    ["b", match("b", "matched", product("led", 0.5))],
    ["c", match("c", "not_stocked")],
    ["d", match("d", "fabrication")],
  ]);

  it("one money figure for what is still to buy; counts kept apart", () => {
    const c = bomCost(lines, matches);
    expect(c.availableNow).toBe(2);
    expect(c.availableLines).toBe(1);
    expect([c.notStocked, c.fabrication, c.bought]).toEqual([1, 1, 1]);
  });

  it("an out-of-stock match is not in To buy now: the figure is what the kit adds", () => {
    const oos = { ...product("led", 0.5), stock_status: "out_of_stock" } as ScoredCandidate;
    const m = new Map(matches).set("b", match("b", "matched", oos));
    const c = bomCost(lines, m);
    expect(c.availableNow).toBe(0);
    expect(c.availableLines).toBe(0);
    expect(lines.filter((l) => buyable(l, m.get(l.id)))).toHaveLength(0);
  });

  it("prices the ordered lines at the store's unit price, apart from the money figure", () => {
    const c = bomCost([lines[0]], matches);
    expect(c.availableNow).toBe(0);
    expect(c.ordered).toBe(35);
    expect(c.orderedPriced).toBe(1);
  });

  it("unstockedLines: only lines we don't stock, never fabrication or bought", () => {
    expect(unstockedLines(lines, matches).map((l) => l.id)).toEqual(["c"]);
  });
});
