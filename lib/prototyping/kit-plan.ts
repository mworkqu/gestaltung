// The project kit plan (P5-02): what "Add the list to cart" will put in the
// cart, worked out ONCE so the button's words, its total and the rows written
// are the same numbers.
//
//   add       every line we can sell now (bom.ts buyable(): resolved to a
//             store product, not owned, not bought, not out of stock), with its
//             packs = ceil(need ÷ pack size) (lib/store/pack)
//   rows      the cart rows for `add`, one per product (the cart's unique key
//             is user + product + project + kit): two lines on one product add
//             their packs and both line ids
//   sourced   lines still to buy that the cart cannot take — no store product
//             ("we'll source this"), no confident product ("we'll pick it"),
//             out of stock. Never dropped silently: the UI lists them.
//   inCart    lines already in the cart for this project (not added twice)
//   goods / discount / total   QAR: Σ unit_price × packs, the kit discount
//             (kitDiscountQar, the cart's own rounding) and what the cart will
//             show for the kit
//
// Bought, owned and made-to-order lines are none of these: nothing to add.
// Pure and client-safe.

import { buyable, groupOf, orderQty, packOf, type LineMatch, type ProjectLine, type ScoredCandidate } from "./bom";

export type KitLine = {
  lineId: string;
  /** The line's own words ("M3 screws"). */
  name: string;
  /** Pieces the line needs. */
  need: number;
  product: ScoredCandidate;
  /** Pieces in one listing. */
  packSize: number;
  /** Listings to buy: ceil(need ÷ packSize), at least the minimum order. */
  packs: number;
  /** unit_price × packs, QAR. */
  lineTotal: number;
};

export type KitRow = { product: ScoredCandidate; quantity: number; bomLines: string[] };

export type SourcedReason = "we_pick" | "we_source";

export type SourcedLine = { lineId: string; name: string; reason: SourcedReason };

export type KitPlan = {
  add: KitLine[];
  rows: KitRow[];
  sourced: SourcedLine[];
  inCart: string[];
  goods: number;
  discount: number;
  total: number;
};

const money = (n: number) => Math.round(n * 100) / 100;

/** The kit discount in QAR for a goods sum, rounded the way the cart rounds it. */
export function kitDiscountQar(goods: number, pct: number): number {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 90);
  return money((goods * p) / 100);
}

/** A line's packs and money for one product (the same maths as the cost summary). */
export function kitLine(l: ProjectLine, p: ScoredCandidate): KitLine {
  const packs = orderQty(l.quantity, p);
  return {
    lineId: l.id,
    name: l.function,
    need: Math.max(1, Math.ceil(Number(l.quantity) || 1)),
    product: p,
    packSize: packOf(p),
    packs,
    lineTotal: money(Number(p.unit_price) * packs),
  };
}

export function kitPlan(
  lines: ProjectLine[],
  matches: Map<string, LineMatch>,
  opts: { inCart?: ReadonlySet<string>; discountPct?: number } = {}
): KitPlan {
  const add: KitLine[] = [];
  const sourced: SourcedLine[] = [];
  const inCart: string[] = [];
  for (const l of lines) {
    if (l.fulfilled || groupOf(l) === "fabrication") continue;
    const m = matches.get(l.id);
    if (!m || m.have) continue;
    if (opts.inCart?.has(l.id)) {
      inCart.push(l.id);
      continue;
    }
    const p = buyable(l, m);
    if (p) add.push(kitLine(l, p));
    else
      sourced.push({
        lineId: l.id,
        name: l.function,
        // No store product at all (or the one we have is out of stock): we source it.
        reason: m.status === "choose" ? "we_pick" : "we_source",
      });
  }

  const byProduct = new Map<string, KitRow>();
  for (const k of add) {
    const row = byProduct.get(k.product.id);
    if (row) {
      row.quantity += k.packs;
      row.bomLines.push(k.lineId);
    } else byProduct.set(k.product.id, { product: k.product, quantity: k.packs, bomLines: [k.lineId] });
  }
  const rows = [...byProduct.values()];

  // From the rows, so the total is exactly what is written to the cart.
  const goods = money(rows.reduce((s, r) => s + Number(r.product.unit_price) * r.quantity, 0));
  const discount = kitDiscountQar(goods, opts.discountPct ?? 0);
  return { add, rows, sourced, inCart, goods, discount, total: money(goods - discount) };
}

/** Line ids held by this project's cart lines (kit or loose). */
export function cartLineIds(items: ReadonlyArray<{ projectId?: string | null; bomLines?: string[] }>, projectId: string): Set<string> {
  const ids = new Set<string>();
  for (const i of items) if (i.projectId === projectId) for (const id of i.bomLines ?? []) ids.add(id);
  return ids;
}
