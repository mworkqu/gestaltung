// Restock dashboard logic (Task 20). Pure: scores products from their open
// demand signals, estimates units and revenue, groups a draft order by
// supplier against each supplier's minimum order value, and writes the CSV.

export type RestockWeights = { request: number; bom_unmatched: number; add_to_cart: number; view: number };
export const DEFAULT_WEIGHTS: RestockWeights = { request: 10, bom_unmatched: 8, add_to_cart: 5, view: 1 };

export type SignalCounts = { views: number; carts: number; requests: number; requestedQty: number };

export function cleanWeights(w: Partial<Record<keyof RestockWeights, unknown>> | null | undefined): RestockWeights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof RestockWeights)[]) {
    const n = Number(w?.[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function demandScore(c: SignalCounts, w: RestockWeights): number {
  return c.requests * w.request + c.carts * w.add_to_cart + c.views * w.view;
}

/**
 * Units a restock should cover: what people asked for (the quantities on
 * requests) plus one per add-to-cart. Views don't count as units.
 */
export function estimatedUnits(c: SignalCounts): number {
  return c.requestedQty + c.carts;
}

export type RestockRow = {
  partId: string;
  sku: string;
  name: string;
  counts: SignalCounts;
  score: number;
  price: number;
  landedCost: number | null;
  income: number | null;
  incomePct: number | null;
  leadTimeClass: string | null;
  supplier: { id: string; name: string; minOrderValue: number | null } | null;
  supplierSku: string | null;
  supplierUrl: string | null;
  moq: number;
  units: number;
  estRevenue: number;
};

export function orderQty(row: Pick<RestockRow, "units" | "moq">): number {
  return Math.max(row.moq, row.units, 1);
}

export type DraftLine = { row: RestockRow; qty: number };
export type DraftGroup = {
  supplierId: string | null;
  supplierName: string;
  minOrderValue: number | null;
  lines: DraftLine[];
  /** Landed cost of the lines, QAR; lines with no known cost are counted in `unpriced`. */
  total: number;
  unpriced: number;
  belowMinimum: boolean;
};

export function groupDraft(lines: DraftLine[]): DraftGroup[] {
  const map = new Map<string, DraftGroup>();
  for (const l of lines) {
    const key = l.row.supplier?.id ?? "none";
    const g =
      map.get(key) ??
      ({
        supplierId: l.row.supplier?.id ?? null,
        supplierName: l.row.supplier?.name ?? "",
        minOrderValue: l.row.supplier?.minOrderValue ?? null,
        lines: [],
        total: 0,
        unpriced: 0,
        belowMinimum: false,
      } as DraftGroup);
    g.lines.push(l);
    if (l.row.landedCost === null) g.unpriced++;
    else g.total = Math.round((g.total + l.row.landedCost * l.qty) * 100) / 100;
    map.set(key, g);
  }
  for (const g of map.values()) g.belowMinimum = g.minOrderValue !== null && g.total < g.minOrderValue;
  return [...map.values()].sort((a, b) => b.total - a.total);
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function draftCsv(groups: DraftGroup[]): string {
  const head = ["supplier", "supplier_sku", "our_sku", "product", "quantity", "landed_cost_each_qar", "line_total_qar", "moq", "supplier_link", "demand_score"];
  const lines = [head.join(",")];
  for (const g of groups)
    for (const l of g.lines)
      lines.push(
        [
          g.supplierName || "(no supplier)",
          l.row.supplierSku,
          l.row.sku,
          l.row.name,
          l.qty,
          l.row.landedCost,
          l.row.landedCost === null ? "" : Math.round(l.row.landedCost * l.qty * 100) / 100,
          l.row.moq,
          l.row.supplierUrl,
          l.row.score,
        ]
          .map(cell)
          .join(",")
      );
  return lines.join("\n") + "\n";
}
