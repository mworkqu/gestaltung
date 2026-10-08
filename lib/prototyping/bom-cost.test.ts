import { describe, expect, it } from "vitest";

import { activeLines, bomCost, dedupeLines, viewLines, type LineMatch, type ProjectBom, type ProjectLine, type ScoredCandidate } from "./bom";
import { costOfLines, costState, projectCost, toBuyNow } from "./bom-cost";

const product = (id: string, price: number, extra: Partial<ScoredCandidate> = {}): ScoredCandidate =>
  ({
    id,
    sku: id.toUpperCase(),
    name: id,
    unit_price: price,
    stock_status: "in_stock",
    min_order_qty: 1,
    pack_size: 1,
    strength: "strong",
    why: [],
    ...extra,
  }) as unknown as ScoredCandidate;

const match = (lineId: string, status: LineMatch["status"], p: ScoredCandidate | null = null): LineMatch => ({
  lineId,
  status,
  candidates: p ? [p] : [],
  product: p,
  have: null,
});

const line = (id: string, over: Partial<ProjectLine> = {}): ProjectLine => ({
  id,
  function: id,
  spec: "",
  quantity: 1,
  kind: "electronics",
  critical: true,
  origin: "electronics",
  ...over,
});

// Fixture: two buyable lines (one sold in packs of 10), one not stocked,
// one removed by the client, one already bought.
const bom: ProjectBom = {
  analysedAt: "2026-10-08T00:00:00Z",
  dismissed: ["removed"],
  lines: [
    line("esp"),
    line("led", { quantity: 3 }),
    line("odd"),
    line("removed"),
    line("bought", { fulfilled: { orderId: "o1", at: "2026-10-01", productId: "p", sku: "P", quantity: 1 } }),
  ],
};
const matches = new Map<string, LineMatch>([
  ["esp", match("esp", "matched", product("esp", 40))],
  ["led", match("led", "matched", product("led", 0.5, { pack_size: 10 }))],
  ["odd", match("odd", "not_stocked")],
  ["removed", match("removed", "matched", product("removed", 999))],
  ["bought", match("bought", "fulfilled", product("bought", 12))],
]);

describe("toBuyNow", () => {
  it("counts whole packs, skips unstocked, removed and bought lines", () => {
    // esp 40 + led: 3 needed, packs of 10 -> one sold unit at 0.5
    expect(toBuyNow(bom, matches)).toBe(40.5);
  });

  it("is the same number the workspace panel, the BOM table and the project page compute", () => {
    // Workspace right panel: CostSummary(lines = activeLines(bom)).
    const panel = bomCost(dedupeLines(activeLines(bom)), matches).availableNow;
    // BOM table: CostSummary(lines = viewLines(bom, "all").lines).
    const table = costOfLines(viewLines(bom, "all").lines, matches).availableNow;
    // Project page: toBuyNow(project.bom, matches).
    const page = toBuyNow(bom, matches);
    expect(panel).toBe(page);
    expect(table).toBe(page);
    expect(projectCost(bom, matches).availableNow).toBe(page);
  });

  it("is 0 for a project with no bill of materials", () => {
    expect(toBuyNow(null, new Map())).toBe(0);
  });
});

describe("costState", () => {
  it("never reports ready (a fake zero) while the first match is pending", () => {
    expect(costState({ lineCount: 4, matchesLoaded: false, matchFailed: false })).toBe("loading");
  });
  it("reports failed when the match failed and nothing loaded", () => {
    expect(costState({ lineCount: 4, matchesLoaded: false, matchFailed: true })).toBe("failed");
  });
  it("is ready once loaded, and when there are no lines at all", () => {
    expect(costState({ lineCount: 4, matchesLoaded: true, matchFailed: false })).toBe("ready");
    expect(costState({ lineCount: 0, matchesLoaded: false, matchFailed: false })).toBe("ready");
  });
});
