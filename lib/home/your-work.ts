// Selection logic for the signed-in "Your work" strip on the v2 home (P3-05).
//
// Pure and client-safe: the component (components/home/your-work-strip.tsx)
// reads the rows with the browser client and hands them here. Nothing in this
// file talks to the network, and nothing here reads a cost or margin.

import { activeLines, groupOf, type ProjectBom } from "@/lib/prototyping/bom";
import { normaliseOrderStatus } from "@/lib/orders/status";

/** How many projects the strip shows. */
export const YOUR_WORK_PROJECTS = 3;

export type WorkProjectRow = {
  id: string;
  name: string | null;
  /** projects.status (0042): 'active' | 'archived'. Absent before 0042 = active. */
  status?: string | null;
  updated_at: string;
  bom?: ProjectBom | null;
};

export type WorkOrderRow = { id: string; status: string; created_at: string };

/** Newest first. A malformed date sorts last rather than throwing. */
const time = (iso: string | null | undefined) => {
  const n = Date.parse(iso ?? "");
  return Number.isFinite(n) ? n : -Infinity;
};

/** The caller's most recently touched ACTIVE projects (archived ones never show). */
export function pickActiveProjects<T extends Pick<WorkProjectRow, "status" | "updated_at">>(
  rows: readonly T[],
  limit: number = YOUR_WORK_PROJECTS
): T[] {
  return rows
    .filter((p) => p.status !== "archived")
    .sort((a, b) => time(b.updated_at) - time(a.updated_at))
    .slice(0, Math.max(0, limit));
}

/** The newest order, whatever its status. */
export function pickLastOrder<T extends Pick<WorkOrderRow, "created_at">>(rows: readonly T[]): T | null {
  return [...rows].sort((a, b) => time(b.created_at) - time(a.created_at))[0] ?? null;
}

/** The newest DELIVERED order (legacy values are read through normaliseOrderStatus). */
export function pickLastDelivered<T extends Pick<WorkOrderRow, "status" | "created_at">>(rows: readonly T[]): T | null {
  return pickLastOrder(rows.filter((o) => normaliseOrderStatus(o.status) === "delivered"));
}

/**
 * BOM lines still to buy on one project: the live lines (not removed, one per
 * item) that were not bought through an order and are not made in-house
 * (fabrication). Read straight from projects.bom; it does NOT know about parts
 * the client already owns (that needs the store match), so it can only be an
 * upper bound and the UI words it as "still to buy", never as a price.
 */
export function countOpenBomLines(bom: ProjectBom | null | undefined): number {
  return activeLines(bom).filter((l) => !l.fulfilled && groupOf(l) !== "fabrication").length;
}

export type PartsToBuy =
  /** No project has a bill of materials yet: nothing honest to count. */
  | { kind: "unknown" }
  /** Every listed line has been bought (or is made in-house). */
  | { kind: "none" }
  | { kind: "count"; count: number };

/** "Parts to buy now" across the projects shown. */
export function partsToBuy(projects: readonly Pick<WorkProjectRow, "bom">[]): PartsToBuy {
  let hasBom = false;
  let total = 0;
  for (const p of projects) {
    if (activeLines(p.bom).length > 0) hasBom = true;
    total += countOpenBomLines(p.bom);
  }
  if (!hasBom) return { kind: "unknown" };
  return total > 0 ? { kind: "count", count: total } : { kind: "none" };
}

// ── Reorder ─────────────────────────────────────────────────────────────────

/** A line of the earlier order: the snapshot columns of part_order_items. */
export type OrderedLine = { part_sku: string; part_name: string; quantity: number };

/** The safe public columns of a published product (no cost, no margin). */
export type ReorderPart = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  min_order_qty: number;
  is_published?: boolean | null;
  merged_into?: string | null;
};

/** Columns read from public.parts for a reorder. Keep in step with ReorderPart. */
export const REORDER_PART_COLUMNS = "id, sku, name, name_ar, min_order_qty, is_published, merged_into";

export type ReorderPlan = {
  /** Plain lines for the cart: one per product, quantities summed. */
  add: { part: ReorderPart; quantity: number }[];
  /** Names (as ordered) of items no longer sold. */
  unavailable: string[];
};

/**
 * What to put back in the cart for an earlier order. A product still sold is
 * added as a plain line (no kit, no project); the cart's own rules then raise
 * the quantity to its minimum. A sku that is missing, unpublished or merged
 * into another product counts as no longer sold. Lines for the same sku are
 * summed; nothing is added twice.
 */
export function buildReorderPlan(lines: readonly OrderedLine[], parts: readonly ReorderPart[]): ReorderPlan {
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const add = new Map<string, { part: ReorderPart; quantity: number }>();
  const unavailable: string[] = [];
  const seenMissing = new Set<string>();

  for (const l of lines) {
    const qty = Math.trunc(Number(l.quantity));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const part = bySku.get(l.part_sku);
    const sold = part && part.is_published !== false && !part.merged_into;
    if (!part || !sold) {
      if (!seenMissing.has(l.part_sku)) {
        seenMissing.add(l.part_sku);
        unavailable.push(l.part_name);
      }
      continue;
    }
    const hit = add.get(part.sku);
    if (hit) hit.quantity += qty;
    else add.set(part.sku, { part, quantity: qty });
  }
  return { add: [...add.values()], unavailable };
}
