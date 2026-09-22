// Parts come from two places, and the difference is kept on the row:
//   catalog   — a Store part or a My Inventory item. Orderable today.
//   to_design — something to design and make, with a kind and no price.
//
// partNeeds() is the single answer to "what is this part still missing": the
// parts table's Status column and the readiness requirements both read it.

import { isCompatible, type Discipline } from "./constants";

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
};

export type PartNeed = "material" | "process" | "mismatch" | "confirm" | "scope" | "outOfStock";

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
  }
  // An analysis suggestion is only a suggestion until the client confirms it.
  if (p.status === "suggested") needs.push("confirm");
  return needs;
}
