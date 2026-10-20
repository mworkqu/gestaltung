import { describe, expect, it } from "vitest";

import { classPartsPlan, classPartsSummary, type ClassTeamDoc, type ClassPartsProduct } from "./class-parts";
import { emptyStudioDoc, type LibraryPart, type StudioComponent, type StudioDoc } from "@/lib/studio/schema";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Only the fields classPartsPlan reads (name, storeSkus) matter, so the parts
// are cast rather than built in full: the real library is validated elsewhere.

function part(id: string, en: string, skus: string[]): LibraryPart {
  return { id, name: { en, ar: `${en} (ar)` }, storeSkus: skus } as unknown as LibraryPart;
}

const LIBRARY = new Map<string, LibraryPart>([
  ["led", part("led", "LED", ["VLT-LED"])],
  ["resistor", part("resistor", "Resistor", ["VLT-RES"])],
  // In the library, but we do not sell it.
  ["pump_5v", part("pump_5v", "Water pump", ["VLT-PUMP"])],
  // No store product at all.
  ["tubing", part("tubing", "Silicone tubing", [])],
]);

const getPart = (id: string) => LIBRARY.get(id);

function doc(parts: [string, number][]): StudioDoc {
  const components: StudioComponent[] = [];
  for (const [partId, n] of parts)
    for (let i = 1; i <= n; i++) components.push({ partId, instanceId: `${partId}_${i}`, label: partId });
  return { ...emptyStudioDoc(), components };
}

function team(teamId: string, parts: [string, number][] | null): ClassTeamDoc {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    projectId: `p_${teamId}`,
    doc: parts === null ? null : doc(parts),
  };
}

const PRICES = new Map<string, number>([
  ["VLT-LED", 3],
  ["VLT-RES", 1],
]);

// A 10-piece LED pack; the resistor is sold one at a time.
const PRODUCTS = new Map<string, ClassPartsProduct>([
  ["VLT-LED", { sku: "VLT-LED", pack_size: 10, min_order_qty: 1 }],
  ["VLT-RES", { sku: "VLT-RES", pack_size: 1, min_order_qty: 1 }],
]);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("classPartsPlan", () => {
  it("shares one line and one pack calculation across teams", () => {
    const plan = classPartsPlan(
      [team("a", [["led", 4]]), team("b", [["led", 4]])],
      PRICES,
      { getPart, products: PRODUCTS },
    );
    const led = plan.lines.find((l) => l.sku === "VLT-LED");
    expect(plan.lines).toHaveLength(1);
    // 4 + 4 = 8 pieces -> ONE pack of 10, not two.
    expect(led?.pieces).toBe(8);
    expect(led?.packSize).toBe(10);
    expect(led?.packs).toBe(1);
    expect(led?.lineTotalQar).toBe(3);
    expect(led?.teams.map((t) => t.pieces)).toEqual([4, 4]);
  });

  it("buys a second pack only when the summed need needs one", () => {
    const plan = classPartsPlan(
      [team("a", [["led", 6]]), team("b", [["led", 6]])],
      PRICES,
      { getPart, products: PRODUCTS },
    );
    expect(plan.lines[0].pieces).toBe(12);
    expect(plan.lines[0].packs).toBe(2);
    expect(plan.goodsQar).toBe(6);
  });

  it("contributes nothing for a team with an empty document", () => {
    const plan = classPartsPlan(
      [team("a", [["resistor", 2]]), team("b", []), team("c", null)],
      PRICES,
      { getPart, products: PRODUCTS },
    );
    expect(plan.teams.map((t) => t.teamId)).toEqual(["a"]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].pieces).toBe(2);
    expect(classPartsSummary(plan).teamCount).toBe(1);
  });

  it("reports a part with no store product instead of dropping it", () => {
    const plan = classPartsPlan([team("a", [["tubing", 1], ["resistor", 1]])], PRICES, {
      getPart,
      products: PRODUCTS,
    });
    expect(plan.lines.map((l) => l.sku)).toEqual(["VLT-RES"]);
    expect(plan.weSource).toHaveLength(1);
    expect(plan.weSource[0]).toMatchObject({ partId: "tubing", reason: "no_sku", pieces: 1 });
    expect(plan.weSource[0].name).toBe("Silicone tubing");
  });

  it("reports a linked product we do not list (no price) as we_source", () => {
    const plan = classPartsPlan([team("a", [["pump_5v", 1]])], PRICES, { getPart, products: PRODUCTS });
    expect(plan.lines).toHaveLength(0);
    expect(plan.weSource[0]).toMatchObject({ partId: "pump_5v", reason: "not_listed" });
    expect(plan.goodsQar).toBe(0);
  });

  it("computes the total from the lines actually produced", () => {
    const plan = classPartsPlan(
      [team("a", [["led", 4], ["resistor", 4], ["tubing", 2]]), team("b", [["led", 4], ["resistor", 4]])],
      PRICES,
      { getPart, products: PRODUCTS },
    );
    const sum = plan.lines.reduce((s, l) => s + l.unitPriceQar * l.packs, 0);
    // 1 LED pack (QAR 3) + 8 resistors (QAR 8) = 11; the tubing is not priced.
    expect(plan.goodsQar).toBe(sum);
    expect(plan.goodsQar).toBe(11);
    const summary = classPartsSummary(plan);
    expect(summary).toEqual({ teamCount: 2, lineCount: 2, partCount: 16, goodsQar: 11 });
  });

  it("defaults the pack size to one piece when the listing is unknown", () => {
    const plan = classPartsPlan([team("a", [["led", 3]])], PRICES, { getPart });
    expect(plan.lines[0].packSize).toBe(1);
    expect(plan.lines[0].packs).toBe(3);
    expect(plan.lines[0].lineTotalQar).toBe(9);
  });

  it("reads part names in the page language and keeps a per-team share", () => {
    const plan = classPartsPlan([team("a", [["led", 2]])], PRICES, {
      getPart,
      products: PRODUCTS,
      locale: "ar",
    });
    expect(plan.lines[0].name).toBe("LED (ar)");
    // Per team: price x PIECES, never pack-rounded.
    expect(plan.teams[0].goodsQar).toBe(6);
    expect(plan.teams[0].partCount).toBe(2);
  });
});
