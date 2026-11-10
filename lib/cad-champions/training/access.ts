// Training access rules (Prompt 9 Step H). PURE: no I/O, tested in
// access.test.ts. The server (training/server.ts, the video route and the
// hint / solution actions) builds an AccessContext from the session and
// cc_has_active_enrollment(), then asks these functions. Hidden UI is never
// the only gate.
//
//   Not enrolled: the catalog is visible; Orientation and free-preview
//                 lessons (notes + video) are open; free-sample exercises
//                 (Foundations Level 1) can be uploaded and graded.
//   Enrolled (active enrollment) or staff: everything.
//
// Hints and the solution video have their own extra gates (attempt counts),
// checked on the server only.

export interface AccessContext {
  /** cc_has_active_enrollment(user) */
  enrolled: boolean;
  /** instructor or admin (or site super_admin) */
  staff: boolean;
}

export interface LessonAccessInput {
  is_free_preview: boolean;
  /** The lesson's module is the Orientation module (module 0). */
  isOrientation: boolean;
}

export interface ExerciseAccessInput {
  is_free_sample: boolean;
}

/** Full access to every lesson and exercise. */
export function hasFullAccess(ctx: AccessContext): boolean {
  return ctx.staff || ctx.enrolled;
}

/** Can watch the video and read the notes of a lesson. */
export function canWatchLesson(ctx: AccessContext, lesson: LessonAccessInput): boolean {
  return hasFullAccess(ctx) || lesson.is_free_preview || lesson.isOrientation;
}

/** Can upload to (and be graded on) an exercise. */
export function canUseExercise(ctx: AccessContext, exercise: ExerciseAccessInput): boolean {
  return hasFullAccess(ctx) || exercise.is_free_sample;
}

/** Hints are revealed one per failed attempt, at most this many. */
export const MAX_HINTS = 3;

/** How many hints a student may see after `failedAttempts` failed attempts. */
export function hintsAvailable(failedAttempts: number, hintCount: number): number {
  const failed = Number.isFinite(failedAttempts) ? Math.max(0, Math.floor(failedAttempts)) : 0;
  const count = Number.isFinite(hintCount) ? Math.max(0, Math.floor(hintCount)) : 0;
  return Math.min(failed, count, MAX_HINTS);
}

/** Hint number n (1-based) is revealed once the student has failed n times. */
export function canRevealHint(n: number, failedAttempts: number, hintCount: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= hintsAvailable(failedAttempts, hintCount);
}

/** The solution video unlocks after a pass or after this many graded attempts. */
export const SOLUTION_AFTER_ATTEMPTS = 5;

export function canSeeSolution(input: { hasVideo: boolean; passed: boolean; attempts: number; staff?: boolean }): boolean {
  if (!input.hasVideo) return false;
  if (input.staff) return true;
  return input.passed || input.attempts >= SOLUTION_AFTER_ATTEMPTS;
}

/** Attempts left before the solution opens (0 when it is open). */
export function attemptsUntilSolution(passed: boolean, attempts: number): number {
  if (passed) return 0;
  return Math.max(0, SOLUTION_AFTER_ATTEMPTS - Math.max(0, Math.floor(attempts)));
}

/** A level a non-enrolled student may open: Orientation, or one with free content. */
export function levelOpenWithoutEnrollment(level: { isOrientation: boolean; hasFreePreviewLesson: boolean; hasFreeSampleExercise: boolean }): boolean {
  return level.isOrientation || level.hasFreePreviewLesson || level.hasFreeSampleExercise;
}
