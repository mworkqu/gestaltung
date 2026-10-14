// Level ladder and module progress (Prompt 9 Step E). PURE, tested.
//
// A level is COMPLETED when every exercise in it is passed at its pass mark
// (best percent so far); a level without exercises is completed when every
// lesson is completed; an empty level is never completed.
// A level is UNLOCKED when its rule is "open", an admin unlocked it for the
// student (cc_level_unlocks), or its rule is "previous_level_passed" and the
// level before it (next lower level number in the module) is completed.
// Access (enrollment) is applied on top: a level the student may not open
// without enrolling shows the reason "enroll".

export type LevelStatus = "locked" | "unlocked" | "completed";

export type UnlockRule = { type: "open" } | { type: "previous_level_passed"; passMark: number };

export type LockReason =
  | { key: "passPrevious"; level: number; passMark: number }
  | { key: "completePrevious"; level: number }
  | { key: "enroll" };

export interface LadderLevelInput {
  id: string;
  levelNumber: number;
  unlockRule: unknown;
  exercises: { id: string; passMark: number; minutes: number | null }[];
  lessons: { id: string; minutes: number | null }[];
  /** False when the student needs an enrollment to open this level. */
  accessible: boolean;
}

export interface LadderProgress {
  /** Best percent per exercise id. */
  bestPercent: ReadonlyMap<string, number>;
  completedLessons: ReadonlySet<string>;
  manualUnlocks: ReadonlySet<string>;
}

export interface LevelState {
  id: string;
  levelNumber: number;
  status: LevelStatus;
  reason: LockReason | null;
  exercisesPassed: number;
  exercisesTotal: number;
  lessonsDone: number;
  lessonsTotal: number;
  /** Planned minutes still to do (unfinished lessons + unpassed exercises). */
  minutesLeft: number;
}

export function parseUnlockRule(raw: unknown): UnlockRule {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r.type === "open") return { type: "open" };
    if (r.type === "previous_level_passed") {
      const pm = Number(r.pass_mark);
      return { type: "previous_level_passed", passMark: Number.isFinite(pm) && pm > 0 && pm <= 100 ? pm : 80 };
    }
  }
  return { type: "previous_level_passed", passMark: 80 };
}

export function isExercisePassed(best: number | undefined, passMark: number): boolean {
  return typeof best === "number" && Number.isFinite(best) && best >= passMark;
}

function counts(level: LadderLevelInput, p: LadderProgress) {
  const exercisesPassed = level.exercises.filter((e) => isExercisePassed(p.bestPercent.get(e.id), e.passMark)).length;
  const lessonsDone = level.lessons.filter((l) => p.completedLessons.has(l.id)).length;
  const minutesLeft =
    level.exercises.filter((e) => !isExercisePassed(p.bestPercent.get(e.id), e.passMark)).reduce((s, e) => s + (e.minutes ?? 0), 0) +
    level.lessons.filter((l) => !p.completedLessons.has(l.id)).reduce((s, l) => s + (l.minutes ?? 0), 0);
  return { exercisesPassed, lessonsDone, minutesLeft };
}

export function isLevelComplete(level: Pick<LadderLevelInput, "exercises" | "lessons">, p: LadderProgress): boolean {
  if (level.exercises.length > 0) return level.exercises.every((e) => isExercisePassed(p.bestPercent.get(e.id), e.passMark));
  if (level.lessons.length > 0) return level.lessons.every((l) => p.completedLessons.has(l.id));
  return false;
}

/** States for the levels of ONE module (any order in; sorted by level number out). */
export function computeLadder(levels: readonly LadderLevelInput[], p: LadderProgress): LevelState[] {
  const sorted = [...levels].sort((a, b) => a.levelNumber - b.levelNumber);
  const out: LevelState[] = [];
  let previous: { level: LadderLevelInput; complete: boolean } | null = null;
  for (const level of sorted) {
    const complete = isLevelComplete(level, p);
    const rule = parseUnlockRule(level.unlockRule);
    const c = counts(level, p);
    let status: LevelStatus;
    let reason: LockReason | null = null;
    if (complete) status = "completed";
    else if (rule.type === "open" || p.manualUnlocks.has(level.id) || !previous || previous.complete) status = "unlocked";
    else {
      status = "locked";
      reason =
        previous.level.exercises.length > 0
          ? { key: "passPrevious", level: previous.level.levelNumber, passMark: rule.type === "previous_level_passed" ? rule.passMark : 80 }
          : { key: "completePrevious", level: previous.level.levelNumber };
    }
    if (!level.accessible && status !== "completed") {
      status = "locked";
      reason = { key: "enroll" };
    }
    out.push({
      id: level.id,
      levelNumber: level.levelNumber,
      status,
      reason,
      exercisesPassed: c.exercisesPassed,
      exercisesTotal: level.exercises.length,
      lessonsDone: c.lessonsDone,
      lessonsTotal: level.lessons.length,
      minutesLeft: c.minutesLeft,
    });
    previous = { level, complete };
  }
  return out;
}

export interface ModuleProgress {
  /** 0-100 over lessons + exercises. */
  percent: number;
  levelsDone: number;
  levelsTotal: number;
  minutesLeft: number;
  /** Every level completed (certificate). */
  complete: boolean;
}

export function moduleProgress(states: readonly LevelState[]): ModuleProgress {
  const items = states.reduce((s, l) => s + l.exercisesTotal + l.lessonsTotal, 0);
  const done = states.reduce((s, l) => s + l.exercisesPassed + l.lessonsDone, 0);
  const levelsDone = states.filter((l) => l.status === "completed").length;
  return {
    percent: items > 0 ? Math.round((done / items) * 100) : 0,
    levelsDone,
    levelsTotal: states.length,
    minutesLeft: states.reduce((s, l) => s + l.minutesLeft, 0),
    complete: states.length > 0 && levelsDone === states.length,
  };
}

/** Hours and minutes for a time estimate. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.round(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}
