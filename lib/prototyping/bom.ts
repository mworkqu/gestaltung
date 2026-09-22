// The bill of materials: what the product needs to BUY, as functions and specs.
//
// The model proposes a function ("steering servo, standard size, 5V, >= 3
// kg.cm"); the database supplies the product. Nothing in projects.bom is a
// product, a price or a stock level — those are read live from the store every
// time (./bom-match via /api/bom/match). The only product references stored
// are the client's own choice and, once bought, what fulfilled the line.
//
// Lines come from three places (`origin`):
//   analysis     the brief analysis: mechanical hardware and consumables
//   electronics  the electronics builder: boards, modules, sensors, actuators
//   rule         our own rules: passives derived from the circuit, level
//                shifters, build consumables, fabrication — each with a reason
// Each source only ever replaces its own lines. A bought (fulfilled) line is
// never replaced or re-added, and a line the client removed stays removed.
//
// Pure and client-safe.

import type { Part } from "@/lib/supabase/types";
import type { BomGroup } from "@/lib/store/attributes";
import type { BomKind, BomLine } from "./analysis";

export type { BomKind, BomLine };

export type LineOrigin = "analysis" | "electronics" | "rule";

export type Fulfilled = { orderId: string; at: string; productId: string; sku: string; quantity: number };

export type ProjectLine = BomLine & {
  choice?: string | null;
  origin?: LineOrigin;
  /** Why a rule added this line ("current limit for LED1"). */
  reason?: string;
  fulfilled?: Fulfilled | null;
};

/** projects.bom (migrations 0023, 0025). */
export type ProjectBom = {
  lines: ProjectLine[];
  analysedAt: string;
  /** Line ids the client removed; rules and re-analysis never add them back. */
  dismissed?: string[];
  electronicsBuiltAt?: string;
  /** The build route the electronics lines were built for. */
  route?: "prototype" | "custom_pcb";
  /** From our rules at build time: logic-level crossings, and assumptions made. */
  levelFlags?: import("./electronics-rules").LevelFlag[];
  assumptions?: string[];
};

/** How a line stands against the store and the client's inventory. */
export type LineStatus = "matched" | "choose" | "not_stocked" | "have" | "fabrication" | "fulfilled";

/** A store product exactly as public.parts holds it (tags 0023, attributes + pack size 0025). */
export type Candidate = Part & {
  tags?: string[] | null;
  attributes?: Record<string, unknown> | null;
  pack_size?: number | null;
};

/** strong = attributes checked and all agree; weak = text only, or attributes missing. */
export type Strength = "strong" | "weak";

export type ScoredCandidate = Candidate & { strength: Strength; why: string[] };

export type LineMatch = {
  lineId: string;
  status: LineStatus;
  /** Up to three: strong first, then in stock, then cheapest. Straight from public.parts. */
  candidates: ScoredCandidate[];
  /** The product this line resolves to: the client's pick, or the one clear strong match. */
  product: ScoredCandidate | null;
  /** Set when the client already owns the product or a matching item. */
  have: { name: string; quantity: number } | null;
};

/** A line's function as a stable key: survives a re-analysis that renames the id. */
export const functionKey = (f: string) => f.trim().toLowerCase().replace(/\s+/g, " ");

export const originOf = (l: ProjectLine): LineOrigin => l.origin ?? "analysis";

export const groupOf = (l: ProjectLine): BomGroup =>
  (l.group as BomGroup | undefined) ??
  (l.kind === "electronics" ? "boards" : l.kind === "mechanical" ? "hardware" : "consumables");

export const activeLines = (bom: ProjectBom | null | undefined) =>
  (bom?.lines ?? []).filter((l) => !(bom?.dismissed ?? []).includes(l.id));

/**
 * Replace the lines of one origin with a new set. Picks carry over by id, else
 * by function; bought lines are kept even if the new set no longer has them,
 * and removed lines stay removed.
 */
export function replaceLines(
  prev: ProjectBom | null | undefined,
  origins: LineOrigin[],
  next: ProjectLine[]
): ProjectBom {
  const old = (prev?.lines ?? []).filter((l) => origins.includes(originOf(l)));
  const byId = new Map(old.map((l) => [l.id, l]));
  const byFn = new Map(old.map((l) => [functionKey(l.function), l]));
  const merged = next.map((l) => {
    const was = byId.get(l.id) ?? byFn.get(functionKey(l.function));
    return {
      ...l,
      ...(was?.choice ? { choice: was.choice } : {}),
      ...(was?.fulfilled ? { fulfilled: was.fulfilled } : {}),
    };
  });
  const keptBought = old.filter(
    (l) => l.fulfilled && !merged.some((m) => m.id === l.id || functionKey(m.function) === functionKey(l.function))
  );
  return {
    lines: [...(prev?.lines ?? []).filter((l) => !origins.includes(originOf(l))), ...merged, ...keptBought],
    analysedAt: new Date().toISOString(),
    dismissed: prev?.dismissed ?? [],
    ...(prev?.electronicsBuiltAt ? { electronicsBuiltAt: prev.electronicsBuiltAt } : {}),
    ...(prev?.route ? { route: prev.route } : {}),
    ...(prev?.levelFlags ? { levelFlags: prev.levelFlags } : {}),
    ...(prev?.assumptions ? { assumptions: prev.assumptions } : {}),
  };
}

/** The analysis only ever supplies its own lines (hardware and consumables). */
export const mergeBom = (prev: ProjectBom | null | undefined, next: BomLine[]) =>
  replaceLines(prev, ["analysis"], next.map((l) => ({ ...l, origin: "analysis" as const })));

/** Which tree node a line's rows appear under. */
export const bomNode = (kind: BomKind) =>
  kind === "electronics" ? "electronics.components" : kind === "mechanical" ? "mechanical.parts" : "bom";

/** Units per sold unit ("sold in packs of 10"). */
export const packOf = (p: Pick<Candidate, "pack_size"> | null | undefined) => Math.max(1, Number(p?.pack_size) || 1);

/**
 * How many sold units to put in the cart for `needed` pieces: whole packs,
 * never below the product's minimum order.
 */
export const orderQty = (needed: number, p: Pick<Candidate, "pack_size" | "min_order_qty">) =>
  Math.max(Math.ceil(needed / packOf(p)), p.min_order_qty || 1);

/** A line the client can still buy: resolved to a product, not owned, not bought, in stock. */
export function buyable(l: ProjectLine, m: LineMatch | undefined): ScoredCandidate | null {
  if (!m?.product || m.have || l.fulfilled) return null;
  if (m.status !== "matched") return null;
  if (m.product.stock_status === "out_of_stock") return null;
  return m.product;
}

/**
 * The project cost summary, as separate figures that are never blended:
 * what can be bought now (a price), what we don't stock (a count), and what
 * needs fabrication (a count, priced by quote).
 */
export function bomCost(lines: ProjectLine[], matches: Map<string, LineMatch>) {
  let availableNow = 0;
  let availableLines = 0;
  let notStocked = 0;
  let fabrication = 0;
  let toChoose = 0;
  let have = 0;
  let bought = 0;
  for (const l of lines) {
    if (l.fulfilled) {
      bought += 1;
      continue;
    }
    if (groupOf(l) === "fabrication") {
      fabrication += 1;
      continue;
    }
    const m = matches.get(l.id);
    if (!m) continue;
    if (m.have) have += 1;
    else if (m.status === "not_stocked") notStocked += 1;
    else if (m.status === "choose") toChoose += 1;
    else if (m.product) {
      availableNow += Number(m.product.unit_price) * orderQty(l.quantity, m.product);
      availableLines += 1;
    }
  }
  return {
    availableNow: Math.round(availableNow * 100) / 100,
    availableLines,
    notStocked,
    fabrication,
    toChoose,
    have,
    bought,
  };
}
