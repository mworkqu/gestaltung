// Light gamification (Prompt 9 Step E). PURE, tested.
//   XP: awarded once per exercise, on its first pass.
//   Weekly streak: consecutive Qatar weeks (Monday start) with training
//   activity (a graded exercise attempt or a completed lesson).
//   Badges: one per completed level (cc_badges), drawn as inline SVG.
// No public leaderboard.

/** XP for passing an exercise for the first time: 10 at Level 1, +5 per level. */
export function xpForPass(levelNumber: number): number {
  const n = Number.isFinite(levelNumber) ? Math.max(1, Math.min(6, Math.floor(levelNumber))) : 1;
  return 10 + (n - 1) * 5;
}

const QATAR_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Qatar is UTC+3 all year (no DST)
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday (yyyy-mm-dd) of the Qatar calendar week containing `at`. */
export function qatarWeekStart(at: Date | number): string {
  const ms = (typeof at === "number" ? at : at.getTime()) + QATAR_OFFSET_MS;
  const d = new Date(ms);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat in Qatar local time
  const sinceMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function weeksBetween(fromMonday: string, toMonday: string): number {
  const a = Date.parse(`${fromMonday}T00:00:00Z`);
  const b = Date.parse(`${toMonday}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / (7 * DAY_MS));
}

export interface StreakState {
  streakWeeks: number;
  lastActiveWeek: string | null;
}

/** The streak after activity in the week starting `thisWeek`. */
export function nextStreak(prev: StreakState | null, thisWeek: string): StreakState & { changed: boolean } {
  if (!prev || !prev.lastActiveWeek) return { streakWeeks: 1, lastActiveWeek: thisWeek, changed: true };
  const gap = weeksBetween(prev.lastActiveWeek, thisWeek);
  if (gap === 0) return { ...prev, changed: false };
  if (gap === 1) return { streakWeeks: prev.streakWeeks + 1, lastActiveWeek: thisWeek, changed: true };
  if (gap < 0) return { ...prev, changed: false }; // clock skew: keep
  return { streakWeeks: 1, lastActiveWeek: thisWeek, changed: true };
}

/** The streak to show now: broken (0) when last week had no activity either. */
export function displayStreak(state: StreakState | null, now: Date | number = Date.now()): number {
  if (!state?.lastActiveWeek) return 0;
  const gap = weeksBetween(state.lastActiveWeek, qatarWeekStart(now));
  if (!Number.isFinite(gap) || gap > 1) return 0;
  return Math.max(0, state.streakWeeks);
}
