// Parts come from two places, and the difference is kept on the row:
//   catalog   — a Store part or a My Inventory item. Orderable today.
//   to_design — something to design and make, with a kind and no price.
//
// partNeeds() is the single answer to "what is this part still missing": the
// parts table's Status column and the readiness requirements both read it.

import { isCompatible, type Discipline } from "./constants";
import { REQUIRED, effectiveShape, missingDims, type Dim, type DimensionedPart } from "./dimension-drawing";
import { ENCLOSURE_MARGIN_MM, type Footprint } from "./footprints";

export type PartSource = "catalog" | "to_design";

export type PartLike = {
  id: string;
  code: string;
  name: string;
  source?: PartSource | null;
  kind?: Discipline | null;
  status: string;
  description?: string | null;
  material: string | null;
  process: string | null;
  stock_status?: string | null;
  quantity?: number;
  shape?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  diameter_mm?: number | null;
  thickness_mm?: number | null;
};

export type PartNeed =
  | "material"
  | "process"
  | "mismatch"
  | "dimensions"
  | "implausible"
  | "tooSmall"
  | "confirm"
  | "scope"
  | "outOfStock";

/**
 * Needs the client can settle after keeping a concept, so they don't block
 * keeping it. A wrong number ("implausible", "tooSmall") is not one of them:
 * it has to be fixed, not carried forward.
 */
export const KEEPABLE_NEEDS: PartNeed[] = ["confirm", "dimensions"];

/** What partNeeds knows about the rest of the project. */
export type PartContext = {
  /** Known boards the project uses (footprints.boardsIn over its lines). */
  boards?: readonly Footprint[];
};

export const isCatalog = (p: { source?: PartSource | null }) => p.source === "catalog";

/** An analysis suggestion to design, not yet kept by the client. */
export const isConcept = (p: { source?: PartSource | null; status: string }) =>
  !isCatalog(p) && p.status === "suggested";

/** A to-design part's discipline. Rows from before 0022 fall back to process. */
export const disciplineOf = (p: PartLike): Discipline | null =>
  isCatalog(p) ? null : p.kind ?? (p.process === "pcb_manufacturing" ? "electronics" : "mechanical");

/** Parts a workshop makes: they need a material and a process. */
export const isMakeable = (p: PartLike) => {
  const d = disciplineOf(p);
  return d === "mechanical" || d === "electronics";
};

export function partNeeds(p: PartLike, ctx: PartContext = {}): PartNeed[] {
  if (isCatalog(p)) return p.stock_status === "out_of_stock" ? ["outOfStock"] : [];
  const needs: PartNeed[] = [];
  if (disciplineOf(p) === "software") {
    if (!p.description?.trim()) needs.push("scope");
  } else {
    if (!p.material) needs.push("material");
    if (!p.process) needs.push("process");
    if (p.material && p.process && !isCompatible(p.material, p.process)) needs.push("mismatch");
    // A mechanical part is drawn and quoted from real dimensions only — and
    // only from numbers that could be real.
    if (disciplineOf(p) === "mechanical") {
      if (missingDims(asDimensioned(p)).length) needs.push("dimensions");
      else if (implausibleDims(p).length) needs.push("implausible");
      else if (enclosureMisfit(p, ctx.boards ?? [])) needs.push("tooSmall");
    }
  }
  // An analysis suggestion is only a suggestion until the client confirms it.
  if (p.status === "suggested") needs.push("confirm");
  return needs;
}

// ── Dimension sanity ────────────────────────────────────────────────────────
// "Ready to make" means the numbers could be real, not merely that there are
// numbers (audit #5).

/** The range a single dimension of a part we make can plausibly have. */
export const DIM_MIN_MM = 1;
export const DIM_MAX_MM = 2000;

const asDimensioned = (p: PartLike) => ({ ...p, quantity: p.quantity ?? 1 }) as DimensionedPart;

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The dimensions the part's drawing uses that cannot be right: outside
 * 1–2000 mm, or a wall thicker than half the smaller side (nothing would be
 * left inside it). Empty when every number is plausible.
 */
export function implausibleDims(p: PartLike): Dim[] {
  const shape = effectiveShape(asDimensioned(p));
  if (!shape) return [];
  const bad = new Set<Dim>();
  for (const d of REQUIRED[shape]) {
    const v = num(p[d]);
    if (v !== null && (v < DIM_MIN_MM || v > DIM_MAX_MM)) bad.add(d);
  }
  const l = num(p.length_mm);
  const w = num(p.width_mm);
  const t = num(p.thickness_mm);
  if (t !== null && l !== null && w !== null && REQUIRED[shape].includes("thickness_mm") && t > Math.min(l, w) / 2)
    bad.add("thickness_mm");
  // A round part: the wall can't be thicker than its radius.
  const dia = num(p.diameter_mm);
  if (shape === "disc" && t !== null && dia !== null && t > dia / 2) bad.add("thickness_mm");
  return [...bad];
}

// ── Enclosure fit ───────────────────────────────────────────────────────────

/** A part that holds the main electronics: its name says enclosure/case/box… */
const ENCLOSURE_NAME = /\b(enclosures?|case|casing|housings?|shell|box|cabinet)\b|علبة|غلاف|صندوق|مبيت|هيكل/i;
/** …unless it is a smaller thing's housing, or only one face of the box. */
const NOT_MAIN_ENCLOSURE =
  /\b(battery|sensor|probe|cable|switch|button|pump|motor|reservoir|tank|bowl|lid|cover|door|hatch|clip|bracket|mount|lens)\b|بطارية|حساس|مستشعر|غطاء|كتيفة/i;

export const isEnclosure = (p: Pick<PartLike, "name">) =>
  ENCLOSURE_NAME.test(p.name) && !NOT_MAIN_ENCLOSURE.test(p.name);

export type EnclosureMisfit = {
  board: Footprint;
  /** Usable inside, largest first (mm). */
  inner: [number, number];
  /** What the board needs with its margin, largest first (mm). */
  needed: [number, number];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The first known board that will not fit inside this enclosure, with the
 * numbers, or null (not an enclosure, no known board, or it fits). Inside is
 * length and width less a wall each side for a sheet or disc; a block's own
 * dimensions are taken as its inside, and the board may lie on any face.
 */
export function enclosureMisfit(p: PartLike, boards: readonly Footprint[]): EnclosureMisfit | null {
  if (!boards.length || !isEnclosure(p)) return null;
  const shape = effectiveShape(asDimensioned(p));
  const t = num(p.thickness_mm) ?? 0;
  let inner: [number, number] | null = null;
  let round = false;
  if (shape === "block") {
    // With a wall thickness given, the inside is the outside less a wall each side.
    const dims = [num(p.length_mm), num(p.width_mm), num(p.height_mm)]
      .filter((x): x is number => x !== null)
      .map((d) => d - 2 * t);
    if (dims.length < 3) return null;
    dims.sort((a, b) => b - a);
    inner = [dims[0], dims[1]];
  } else if (shape === "sheet") {
    const l = num(p.length_mm);
    const w = num(p.width_mm);
    if (l === null || w === null) return null;
    const a = l - 2 * t;
    const b = w - 2 * t;
    inner = a >= b ? [a, b] : [b, a];
  } else if (shape === "disc") {
    const d = num(p.diameter_mm);
    if (d === null) return null;
    inner = [d - 2 * t, d - 2 * t];
    round = true;
  } else return null;

  // The largest board decides; boards sit on each other, not side by side.
  const bySize = [...boards].sort((a, b) => b.length_mm * b.width_mm - a.length_mm * a.width_mm);
  for (const board of bySize) {
    const bl = Math.max(board.length_mm, board.width_mm) + ENCLOSURE_MARGIN_MM;
    const bw = Math.min(board.length_mm, board.width_mm) + ENCLOSURE_MARGIN_MM;
    // In a round case the board's diagonal has to fit across the inside.
    const fits = round ? Math.hypot(bl, bw) <= inner[0] : bl <= inner[0] && bw <= inner[1];
    if (!fits) {
      const needed: [number, number] = round ? [round1(Math.hypot(bl, bw)), round1(Math.hypot(bl, bw))] : [bl, bw];
      return { board, inner: [round1(Math.max(inner[0], 0)), round1(Math.max(inner[1], 0))], needed };
    }
  }
  return null;
}

// ── The Parts list: project_parts + the project's store lines ───────────────
//
// A project holds parts in two tables: project_parts (what prototyping adds —
// catalog picks and parts to design) and project_items (store products added
// on the project page). The Parts list shows both as one table, so its
// "Catalog" filter finds the store lines too (audit #4).
//
// Store lines are display-only here: they are edited on the project page, and
// they are never design requirements — readiness and the tree counts read
// project_parts alone, so nothing below feeds them.

/** A project_items row with its store product, as the Parts list needs it. */
export type StoreLineLike = {
  id: string;
  quantity: number;
  part: { name: string; name_ar?: string | null; sku: string; unit_price: number | string | null } | null;
};

export type PartsListRow<P, I> =
  | { origin: "part"; id: string; part: P }
  | { origin: "store"; id: string; item: I };

export type PartsListFilter = "all" | "catalog" | "to_design";

/** One list: project_parts first (in their own order), then the store lines. */
export function mergePartsForList<P extends { id: string }, I extends StoreLineLike>(
  projectParts: readonly P[],
  projectItems: readonly I[]
): PartsListRow<P, I>[] {
  return [
    ...projectParts.map((part) => ({ origin: "part" as const, id: `part:${part.id}`, part })),
    ...projectItems.map((item) => ({ origin: "store" as const, id: `item:${item.id}`, item })),
  ];
}

/** "Catalog" is everything orderable: catalog project_parts and every store line. */
export function rowMatchesFilter<P extends { source?: PartSource | null }, I>(
  row: PartsListRow<P, I>,
  filter: PartsListFilter
): boolean {
  if (filter === "all") return true;
  const orderable = row.origin === "store" || isCatalog(row.part);
  return filter === "catalog" ? orderable : !orderable;
}
