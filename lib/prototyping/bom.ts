// The bill of materials: what the product needs to BUY, as functions and specs.
//
// The model proposes a function ("steering servo, standard size, 5V, >= 3
// kg.cm"); the database supplies the product. Nothing in projects.bom is a
// product, a price or a stock level — those are read live from the store every
// time (./bom-match via /api/bom/match), so they can never go stale or be made
// up. The only product reference stored is the client's own choice.
//
// Pure and client-safe.

import type { Part } from "@/lib/supabase/types";
import type { BomKind, BomLine } from "./analysis";

export type { BomKind, BomLine };

/** projects.bom (migration 0023). */
export type ProjectBom = {
  lines: (BomLine & { choice?: string | null })[];
  analysedAt: string;
};

/** How a line stands against the store and the client's inventory. */
export type LineStatus = "matched" | "choose" | "not_stocked" | "have";

/** A store product exactly as public.parts holds it (tags from 0023). */
export type Candidate = Part & { tags?: string[] | null };

export type LineMatch = {
  lineId: string;
  status: LineStatus;
  /** Up to three, in stock first, then cheapest. Straight from public.parts. */
  candidates: Candidate[];
  /** The product this line resolves to, if any (the client's pick, or the one clear match). */
  product: Candidate | null;
  /** Set when the client already owns the product or a matching item. */
  have: { name: string; quantity: number } | null;
};

/** A line's function as a stable key: survives a re-analysis that renames the id. */
export const functionKey = (f: string) => f.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A new analysis replaces the lines, but a client's pick carries over to the
 * line with the same id — or, failing that, the same function.
 */
export function mergeBom(prev: ProjectBom | null | undefined, next: BomLine[]): ProjectBom {
  const byId = new Map((prev?.lines ?? []).map((l) => [l.id, l.choice]));
  const byFn = new Map((prev?.lines ?? []).map((l) => [functionKey(l.function), l.choice]));
  return {
    lines: next.map((l) => {
      const choice = byId.get(l.id) ?? byFn.get(functionKey(l.function)) ?? null;
      return choice ? { ...l, choice } : l;
    }),
    analysedAt: new Date().toISOString(),
  };
}

/** Which tree node a line's rows appear under. */
export const bomNode = (kind: BomKind) =>
  kind === "electronics" ? "electronics.components" : kind === "mechanical" ? "mechanical.parts" : "bom";

/** Money for the running total: only lines resolved to a product we sell and the client lacks. */
export function bomTotal(lines: ProjectBom["lines"], matches: Map<string, LineMatch>): number {
  let sum = 0;
  for (const l of lines) {
    const m = matches.get(l.id);
    if (!m?.product || m.have || m.status === "not_stocked") continue;
    sum += Number(m.product.unit_price) * orderQty(l.quantity, m.product.min_order_qty);
  }
  return Math.round(sum * 100) / 100;
}

/** What goes in the cart: the line's quantity, raised to the product's minimum order. */
export const orderQty = (quantity: number, minOrder: number) => Math.max(quantity, minOrder || 1);
