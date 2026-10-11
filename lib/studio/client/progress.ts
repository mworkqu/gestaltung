// W8: honest progress for the parts pick. The route is one model call (no real
// incremental progress), so the line is a staged, time-based guide: it moves
// through PICK_STAGES steps over the usual wait, and it NEVER reaches the last
// step on its own. The list appearing is what finishes it, so the text never
// claims more than is true ("Picking your parts… 3 of 6", never "6 of 6" early).

export const PICK_STAGES = 6;
/** About how long the pick takes (measured 5.4 s on live). */
export const PICK_EXPECTED_MS = 5400;

/** The step to show after `elapsedMs`: 1 at the start, at most PICK_STAGES - 1 while waiting. */
export function pickStep(elapsedMs: number, expectedMs = PICK_EXPECTED_MS, stages = PICK_STAGES): number {
  if (!(elapsedMs > 0)) return 1;
  const per = expectedMs / stages;
  return Math.min(stages - 1, 1 + Math.floor(elapsedMs / per));
}
