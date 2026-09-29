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
// Two sources listing the same thing (the analysis's "USB cable" and the
// rule's) are one line (dedupeLines, audit #29): a bought line and the
// client's pick always win.
//
// Pure and client-safe.

import type { Part } from "@/lib/supabase/types";
import { BOM_GROUPS, type BomGroup } from "@/lib/store/attributes";
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
  /** The product is our best match, picked for the client; they can change it. */
  auto?: boolean;
};

/** A line's function as a stable key: survives a re-analysis that renames the id. */
export const functionKey = (f: string) => f.trim().toLowerCase().replace(/\s+/g, " ");

export const originOf = (l: ProjectLine): LineOrigin => l.origin ?? "analysis";

export const groupOf = (l: ProjectLine): BomGroup =>
  (l.group as BomGroup | undefined) ??
  (l.kind === "electronics" ? "boards" : l.kind === "mechanical" ? "hardware" : "consumables");

/**
 * The lines still on the list: one line per item, then not removed by the
 * client. Deduped BEFORE removals are dropped, so a stored BOM holding a
 * removed line and its live twin reads as removed, not live.
 */
export const activeLines = (bom: ProjectBom | null | undefined) => {
  const removed = new Set(bom?.dismissed ?? []);
  return dedupeLines(bom?.lines ?? [], { dismissed: removed }).filter((l) => !removed.has(l.id));
};

/**
 * A line's function as a comparable name across sources: case, brackets,
 * punctuation and plurals ignored ("USB Cables (micro)" = "usb cable").
 */
export function normaliseFunction(f: string): string {
  return f
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

// Build consumables and power items that name one thing whichever source
// listed them (the analysis's consumable "usb_cable" is the rule's power
// "usb_cable"). They also belong to the electronics view.
const ITEM_TYPES = new Set([
  "usb_cable",
  "breadboard",
  "jumper_wires",
  "perfboard",
  "hookup_wire",
  "heat_shrink",
  "solder",
  "adapter",
  "battery_holder",
]);

const itemType = (l: ProjectLine): string | null => {
  const a = l.attributes ?? {};
  const v = String(a.consumable_type ?? a.power_type ?? "");
  return ITEM_TYPES.has(v) ? v : null;
};

/** Two lines buy the same thing: the same named type, else the same normalised function. */
export function sameItem(a: ProjectLine, b: ProjectLine): boolean {
  const ta = itemType(a);
  const tb = itemType(b);
  if (ta && tb) return ta === tb;
  return normaliseFunction(a.function) === normaliseFunction(b.function);
}

const ORIGIN_RANK: Record<LineOrigin, number> = { electronics: 0, rule: 1, analysis: 2 };

/**
 * One line per item across sources (audit #29). Only lines of DIFFERENT
 * origins merge, and only when each is the other's single twin in that origin
 * (four "Resistor" rule lines never swallow anything). The survivor is, in
 * order: the one the client REMOVED (so a removal survives a re-analysis
 * that brings the twin back, and the line stays under "removed"), bought,
 * the client's pick, then electronics > rule > analysis. It keeps the larger quantity and inherits the other's pick.
 * Never dropped: a bought line, an electronics line, a line with netlist refs,
 * an analysis electronics line (older circuits point at those), or an id in
 * `keep` (lines a stored circuit points at).
 */
export function dedupeLines<L extends ProjectLine>(
  lines: L[],
  opts: { dismissed?: Iterable<string>; keep?: ReadonlySet<string> } = {}
): L[] {
  const dismissed = new Set(opts.dismissed ?? []);
  const droppable = (l: L) =>
    !l.fulfilled &&
    originOf(l) !== "electronics" &&
    !(l as { refs?: string[] }).refs?.length &&
    !(originOf(l) === "analysis" && l.kind === "electronics") &&
    !opts.keep?.has(l.id);
  const score = (l: L) => [dismissed.has(l.id) ? 0 : 1, l.fulfilled ? 0 : 1, l.choice ? 0 : 1, ORIGIN_RANK[originOf(l)]];
  const better = (a: L, b: L) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] < sb[i];
    return true;
  };
  const twinsIn = (l: L, origin: LineOrigin, pool: L[]) =>
    pool.filter((x) => x !== l && originOf(x) === origin && sameItem(l, x));

  let out = [...lines];
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    for (const origin of Object.keys(ORIGIN_RANK) as LineOrigin[]) {
      if (origin === originOf(a)) continue;
      const twins = twinsIn(a, origin, out);
      if (twins.length !== 1) continue;
      const b = twins[0];
      if (twinsIn(b, originOf(a), out).length !== 1) continue;
      let [win, lose] = better(a, b) ? [a, b] : [b, a];
      if (!droppable(lose)) [win, lose] = [lose, win];
      if (!droppable(lose)) continue;
      const merged: L = {
        ...win,
        quantity: Math.max(win.quantity, lose.quantity),
        ...(!win.choice && lose.choice ? { choice: lose.choice } : {}),
      };
      out = out.filter((x) => x !== lose).map((x) => (x === win ? merged : x));
      // The list changed: look at the survivor again from its new position.
      i = out.indexOf(merged) - 1;
      break;
    }
  }
  return out;
}

/** Which lines a table shows: every line, or one branch's. */
export type BomView = "all" | "electronics" | "mechanical";

const inView = (l: ProjectLine, view: BomView) =>
  view === "all" ||
  (view === "electronics"
    ? l.kind === "electronics" || (groupOf(l) === "consumables" && (itemType(l) !== null || l.class === "power"))
    : l.kind === view);

/**
 * The ONE selector for a table's lines, shared by the project BOM and the
 * branch tables (Electronics > Components, Mechanical), so a group reads the
 * same count everywhere (audit #29): the view's live lines, one per item, and
 * the ones the client removed.
 */
export function viewLines(bom: ProjectBom | null | undefined, view: BomView, keep?: ReadonlySet<string>) {
  const removed = new Set(bom?.dismissed ?? []);
  // Deduped before removals are split off: a removed twin keeps its twin removed.
  const lines = dedupeLines(
    (bom?.lines ?? []).filter((l) => inView(l, view)),
    { dismissed: removed, keep }
  );
  return {
    lines: lines.filter((l) => !removed.has(l.id)),
    dismissed: lines.filter((l) => removed.has(l.id)),
  };
}

/** Lines by display group, in display order; empty groups left out. */
export const groupLines = <L extends ProjectLine>(lines: L[]) =>
  BOM_GROUPS.map((g) => ({ g, lines: lines.filter((l) => groupOf(l) === g) })).filter((x) => x.lines.length > 0);

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
    lines: dedupeLines([...(prev?.lines ?? []).filter((l) => !origins.includes(originOf(l))), ...merged, ...keptBought], {
      dismissed: prev?.dismissed ?? [],
    }),
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

/** Lines we don't stock: no store product, not owned, not bought, not made to order. */
export const unstockedLines = <L extends ProjectLine>(lines: L[], matches: Map<string, LineMatch>) =>
  lines.filter((l) => !l.fulfilled && groupOf(l) !== "fabrication" && matches.get(l.id)?.status === "not_stocked");

/**
 * The project cost summary. ONE money figure: what the client would pay now
 * for the lines still to buy (whole packs) — exactly the buyable() lines the
 * kit adds, so an out-of-stock product never counts. Counts are never blended with it:
 * not stocked, fabrication (priced by quote), to choose, have, bought.
 * `ordered` is what the bought lines cost at the store's unit price — shown
 * per group, never added to the money figure — and `orderedPriced` how many
 * bought lines had a known price.
 */
export function bomCost(lines: ProjectLine[], matches: Map<string, LineMatch>) {
  let availableNow = 0;
  let availableLines = 0;
  let notStocked = 0;
  let fabrication = 0;
  let toChoose = 0;
  let have = 0;
  let bought = 0;
  let ordered = 0;
  let orderedPriced = 0;
  for (const l of lines) {
    if (l.fulfilled) {
      bought += 1;
      const p = matches.get(l.id)?.product;
      const price = Number(p?.unit_price);
      if (p && Number.isFinite(price)) {
        ordered += price * Math.max(1, Number(l.fulfilled.quantity) || 1);
        orderedPriced += 1;
      }
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
    else {
      const p = buyable(l, m);
      if (p) {
        availableNow += Number(p.unit_price) * orderQty(l.quantity, p);
        availableLines += 1;
      }
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
    ordered: Math.round(ordered * 100) / 100,
    orderedPriced,
  };
}
