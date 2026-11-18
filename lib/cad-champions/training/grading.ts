// Exercise grading helpers (pure, tested). Exercises are practice: the
// grader's partial credit counts ("practice score", 0-100) and the exercise
// is passed at its pass mark (default 80). In aspects mode (assemblies) the
// percent is points / max points.

export interface GradeLike {
  practiceScore: number | null;
  score: number;
  maxPoints: number;
}

export function exercisePercent(r: GradeLike): number {
  if (typeof r.practiceScore === "number" && Number.isFinite(r.practiceScore)) return clamp(r.practiceScore);
  if (!(r.maxPoints > 0)) return 0;
  return clamp((r.score / r.maxPoints) * 100);
}

function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
}

export function exercisePassed(percent: number, passMark: number): boolean {
  return Number.isFinite(percent) && percent >= (Number.isFinite(passMark) && passMark > 0 ? passMark : 80);
}

/** What the exercise page shows after an upload. */
export type ExerciseOutcome =
  | "passed"
  | "failed"
  /** Drawing / manual exercise: saved for a trainer. */
  | "review"
  /** Saved, but the automatic check is not set up yet (grader off or answer data missing). */
  | "saved";
