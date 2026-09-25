// Parts come from two places, and the difference is kept on the row:
//   catalog   — a Store part or a My Inventory item. Orderable today.
//   to_design — something to design and make, with a kind and no price.
//
// partNeeds() is the single answer to "what is this part still missing": the
// parts table's Status column and the readiness requirements both read it.

import { isCompatible, type Discipline } from "./constants";
import { missingDims, type DimensionedPart } from "./dimension-drawing";

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

export type PartNeed = "material" | "process" | "mismatch" | "dimensions" | "confirm" | "scope" | "outOfStock";

/** Needs the client can settle after keeping a concept, so they don't block keeping it. */
export const KEEPABLE_NEEDS: PartNeed[] = ["confirm", "dimensions"];

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

export function partNeeds(p: PartLike): PartNeed[] {
  if (isCatalog(p)) return p.stock_status === "out_of_stock" ? ["outOfStock"] : [];
  const needs: PartNeed[] = [];
  if (disciplineOf(p) === "software") {
    if (!p.description?.trim()) needs.push("scope");
  } else {
    if (!p.material) needs.push("material");
    if (!p.process) needs.push("process");
    if (p.material && p.process && !isCompatible(p.material, p.process)) needs.push("mismatch");
    // A mechanical part is drawn and quoted from real dimensions only.
    if (disciplineOf(p) === "mechanical" && missingDims({ ...p, quantity: p.quantity ?? 1 } as DimensionedPart).length)
      needs.push("dimensions");
  }
  // An analysis suggestion is only a suggestion until the client confirms it.
  if (p.status === "suggested") needs.push("confirm");
  return needs;
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
