// The ONE place "To buy now" is worked out (P0-07 / audit #59, #38 leftovers).
//
// The workspace cost panel, the BOM table's summary, the payment card and the
// project page all read the same figure from the same inputs — a project's
// stored bill of materials (projects.bom) and the live store matches
// (/api/bom/match) — through these helpers, so two pages can never show two
// different "To buy now" numbers. Pure and client-safe.

import {
  activeLines,
  bomCost,
  dedupeLines,
  type LineMatch,
  type ProjectBom,
  type ProjectLine,
} from "./bom";

/** The cost breakdown (money + counts) of a set of lines: one line per item. */
export function costOfLines(lines: ProjectLine[], matches: Map<string, LineMatch>) {
  return bomCost(dedupeLines(lines), matches);
}

/** The cost breakdown of a whole project: its live lines (not removed), one per item. */
export function projectCost(bom: ProjectBom | null | undefined, matches: Map<string, LineMatch>) {
  return costOfLines(activeLines(bom), matches);
}

/** "To buy now": what the client would pay for the lines still to buy (whole packs), in QAR. */
export function toBuyNow(bom: ProjectBom | null | undefined, matches: Map<string, LineMatch>): number {
  return projectCost(bom, matches).availableNow;
}

/**
 * Whether the cost figures can be shown yet. Until the first store match for a
 * project's lines arrives there are no prices, and a cost of QAR 0.00 / 0 / 0
 * would be a lie — callers show a skeleton instead (audit #59).
 *   loading  lines exist, the first match has not come back
 *   failed   the match request failed (no prices will arrive on their own)
 *   ready    show the figures
 */
export type CostState = "loading" | "failed" | "ready";

export function costState(opts: { lineCount: number; matchesLoaded: boolean; matchFailed: boolean }): CostState {
  if (opts.lineCount === 0) return "ready";
  if (opts.matchesLoaded) return "ready";
  return opts.matchFailed ? "failed" : "loading";
}
