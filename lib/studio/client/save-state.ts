// Autosave decisions of the Design Studio, kept pure so they can be tested (D4).
// StudioShell holds the refs/timers; the rules live here.

import type { StudioDoc } from "../schema";
import type { SaveResult } from "./api";
import { withLastStep, type FlowStep } from "./steps";

/** What the header indicator shows: all saved, a save pending or in flight, or the last save failed. */
export type SaveStatus = "saved" | "saving" | "failed";

/**
 * Moving to `step`: the doc remembers the step (W1), and when that changes anything the doc
 * must be saved. `save` is false when the doc is not there yet or already names this step.
 */
export function stepChangeSave(doc: StudioDoc | null, step: FlowStep): { doc: StudioDoc | null; save: boolean } {
  if (!doc) return { doc, save: false };
  const next = withLastStep(doc, step);
  return { doc: next, save: next !== doc };
}

/** The status to show. Unsaved work (dirty or in flight) is "saving" until a save fails. */
export function saveStatus(s: { dirty: boolean; inFlight: boolean; failed: boolean }): SaveStatus {
  if (s.failed) return "failed";
  return s.dirty || s.inFlight ? "saving" : "saved";
}

/** Ask before the tab closes only when there is something unsaved that a save could still keep. */
export function shouldWarnOnLeave(status: SaveStatus, persist: boolean): boolean {
  return persist && status !== "saved";
}

/**
 * One save with one conflict retry. A 409 carries the server's current version;
 * a PUT that raced our own earlier save (or a route that wrote the doc itself)
 * conflicts only because our version number is stale, so we re-apply our doc
 * on top of that version once instead of dropping it. A second conflict is a
 * real concurrent writer (another tab): the caller then adopts theirs.
 */
export async function saveWithConflictRetry(
  save: (doc: StudioDoc, version: number) => Promise<SaveResult>,
  doc: StudioDoc,
  version: number,
): Promise<SaveResult> {
  const first = await save(doc, version);
  if (first.ok || first.error !== "conflict") return first;
  return save(doc, first.version);
}
