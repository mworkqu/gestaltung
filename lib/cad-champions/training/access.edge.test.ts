// Edge cases for training access, hint and solution unlock rules, the level
// ladder and the Qatar week boundary. Complements training.test.ts.
import { describe, expect, it } from "vitest";

import { MAX_HINTS, SOLUTION_AFTER_ATTEMPTS, attemptsUntilSolution, canRevealHint, canSeeSolution, canUseExercise, canWatchLesson, hasFullAccess, hintsAvailable } from "./access";
import { displayStreak, nextStreak, qatarWeekStart, xpForPass } from "./gamification";
import { computeLadder, isExercisePassed, isLevelComplete, moduleProgress, parseUnlockRule, splitMinutes, type LadderLevelInput, type LadderProgress } from "./ladder";

describe("access: combinations", () => {
  it("enrolled staff and staff-only both have full access", () => {
    expect(hasFullAccess({ enrolled: true, staff: true })).toBe(true);
    expect(hasFullAccess({ enrolled: false, staff: true })).toBe(true);
  });
  it("an enrolled user can watch a lesson that is neither free nor orientation", () => {
    expect(canWatchLesson({ enrolled: true, staff: false }, { is_free_preview: false, isOrientation: false })).toBe(true);
  });
  it("a non-enrolled user cannot use a non-sample exercise", () => {
    expect(canUseExercise({ enrolled: false, staff: false }, { is_free_sample: false })).toBe(false);
  });
});

describe("hints", () => {
  it("handles junk counts", () => {
    expect(hintsAvailable(Number.NaN, 3)).toBe(0);
    expect(hintsAvailable(-4, 3)).toBe(0);
    expect(hintsAvailable(2.9, 3)).toBe(2);
    expect(hintsAvailable(5, Number.NaN)).toBe(0);
    expect(hintsAvailable(5, -1)).toBe(0);
    expect(hintsAvailable(Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
  it("never more than MAX_HINTS", () => {
    expect(MAX_HINTS).toBe(3);
    expect(hintsAvailable(100, 100)).toBe(MAX_HINTS);
    expect(canRevealHint(4, 100, 100)).toBe(false);
    expect(canRevealHint(3, 100, 100)).toBe(true);
  });
  it("hint 1 needs one failed attempt and an authored hint", () => {
    expect(canRevealHint(1, 1, 0)).toBe(false);
    expect(canRevealHint(1, 1, 1)).toBe(true);
    expect(canRevealHint(-1, 5, 3)).toBe(false);
    expect(canRevealHint(Number.NaN, 5, 3)).toBe(false);
  });
});

describe("solution unlock", () => {
  it("opens at exactly SOLUTION_AFTER_ATTEMPTS", () => {
    expect(SOLUTION_AFTER_ATTEMPTS).toBe(5);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: SOLUTION_AFTER_ATTEMPTS - 1 })).toBe(false);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: SOLUTION_AFTER_ATTEMPTS })).toBe(true);
  });
  it("staff cannot see a solution that has no video", () => {
    expect(canSeeSolution({ hasVideo: false, passed: false, attempts: 0, staff: true })).toBe(false);
  });
  it("attemptsUntilSolution counts down and never goes negative", () => {
    expect(attemptsUntilSolution(false, 0)).toBe(5);
    expect(attemptsUntilSolution(false, 4)).toBe(1);
    expect(attemptsUntilSolution(false, 5)).toBe(0);
    expect(attemptsUntilSolution(false, 50)).toBe(0);
    expect(attemptsUntilSolution(false, -3)).toBe(5);
    expect(attemptsUntilSolution(false, 2.7)).toBe(3);
  });
});

describe("ladder edge cases", () => {
  const level = (n: number, ex: { id: string; passMark?: number; minutes?: number | null }[], lessons: string[], rule: unknown, accessible = true): LadderLevelInput => ({
    id: `L${n}`,
    levelNumber: n,
    unlockRule: rule,
    exercises: ex.map((e) => ({ id: e.id, passMark: e.passMark ?? 80, minutes: e.minutes === undefined ? 10 : e.minutes })),
    lessons: lessons.map((id) => ({ id, minutes: 5 })),
    accessible,
  });
  const progress = (best: Record<string, number> = {}, lessons: string[] = [], unlocks: string[] = []): LadderProgress => ({
    bestPercent: new Map(Object.entries(best)),
    completedLessons: new Set(lessons),
    manualUnlocks: new Set(unlocks),
  });
  const prev = { type: "previous_level_passed", pass_mark: 80 };

  it("parseUnlockRule rejects bad pass marks and shapes", () => {
    expect(parseUnlockRule({ type: "previous_level_passed", pass_mark: 0 })).toEqual({ type: "previous_level_passed", passMark: 80 });
    expect(parseUnlockRule({ type: "previous_level_passed", pass_mark: 101 })).toEqual({ type: "previous_level_passed", passMark: 80 });
    expect(parseUnlockRule({ type: "previous_level_passed", pass_mark: "90" })).toEqual({ type: "previous_level_passed", passMark: 90 });
    expect(parseUnlockRule({ type: "previous_level_passed" })).toEqual({ type: "previous_level_passed", passMark: 80 });
    expect(parseUnlockRule({ type: "open" })).toEqual({ type: "open" });
    expect(parseUnlockRule([])).toEqual({ type: "previous_level_passed", passMark: 80 });
    expect(parseUnlockRule({ type: "bogus" })).toEqual({ type: "previous_level_passed", passMark: 80 });
  });

  it("pass mark is inclusive", () => {
    expect(isExercisePassed(80, 80)).toBe(true);
    expect(isExercisePassed(79.99, 80)).toBe(false);
    expect(isExercisePassed(undefined, 80)).toBe(false);
    expect(isExercisePassed(Number.NaN, 80)).toBe(false);
  });

  it("an empty level is never complete and blocks the next one", () => {
    expect(isLevelComplete({ exercises: [], lessons: [] }, progress())).toBe(false);
    const s = computeLadder([level(1, [], [], { type: "open" }), level(2, [{ id: "e" }], [], prev)], progress());
    expect(s.map((x) => x.status)).toEqual(["unlocked", "locked"]);
    expect(s[1].reason).toEqual({ key: "completePrevious", level: 1 });
  });

  it("a lesson-only level completes with its lessons; exercises take priority when both exist", () => {
    expect(isLevelComplete({ exercises: [], lessons: [{ id: "l", minutes: 1 }] }, progress({}, ["l"]))).toBe(true);
    const mixed = { exercises: [{ id: "e", passMark: 80, minutes: 1 }], lessons: [{ id: "l", minutes: 1 }] };
    expect(isLevelComplete(mixed, progress({ e: 90 }, []))).toBe(true);
    expect(isLevelComplete(mixed, progress({}, ["l"]))).toBe(false);
  });

  it("the pass mark in the lock reason follows the locked level's rule", () => {
    const s = computeLadder([level(1, [{ id: "a" }], [], { type: "open" }), level(2, [{ id: "b" }], [], { type: "previous_level_passed", pass_mark: 65 })], progress());
    expect(s[1].reason).toEqual({ key: "passPrevious", level: 1, passMark: 65 });
  });

  it("an 'open' level after an unfinished one stays unlocked", () => {
    const s = computeLadder([level(1, [{ id: "a" }], [], { type: "open" }), level(2, [{ id: "b" }], [], { type: "open" })], progress());
    expect(s.map((x) => x.status)).toEqual(["unlocked", "unlocked"]);
  });

  it("level numbers with gaps still chain by order", () => {
    const s = computeLadder([level(5, [{ id: "x" }], [], { type: "open" }), level(9, [{ id: "y" }], [], prev)], progress({ x: 100 }));
    expect(s.map((l) => l.status)).toEqual(["completed", "unlocked"]);
  });

  it("a completed level stays completed even without access", () => {
    const s = computeLadder([level(1, [{ id: "a" }], [], { type: "open" }, false)], progress({ a: 100 }));
    expect(s[0]).toMatchObject({ status: "completed", reason: null });
  });

  it("an inaccessible but manually unlocked level still shows 'enroll'", () => {
    const s = computeLadder([level(1, [{ id: "a" }], [], { type: "open" }), level(2, [{ id: "b" }], [], prev, false)], progress({}, [], ["L2"]));
    expect(s[1]).toMatchObject({ status: "locked", reason: { key: "enroll" } });
  });

  it("minutes left ignores null minutes and passed items", () => {
    const s = computeLadder([level(1, [{ id: "a", minutes: null }, { id: "b", minutes: 30 }], ["l1"], { type: "open" })], progress({ b: 90 }));
    expect(s[0].minutesLeft).toBe(5);
  });

  it("module progress of nothing is 0 % and not complete", () => {
    expect(moduleProgress([])).toEqual({ percent: 0, levelsDone: 0, levelsTotal: 0, minutesLeft: 0, complete: false });
  });

  it("splitMinutes handles negatives and rounding", () => {
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
    expect(splitMinutes(59.6)).toEqual({ hours: 1, minutes: 0 });
    expect(splitMinutes(60)).toEqual({ hours: 1, minutes: 0 });
  });
});

describe("Qatar week and streak at midnight boundaries", () => {
  it("Monday 00:00 Qatar starts the new week; 1 ms before is still the old week", () => {
    const mondayMidnightQatar = Date.UTC(2026, 9, 11, 21, 0, 0); // Sun 21:00Z = Mon 00:00 Qatar
    expect(qatarWeekStart(mondayMidnightQatar)).toBe("2026-10-12");
    expect(qatarWeekStart(mondayMidnightQatar - 1)).toBe("2026-10-05");
  });
  it("Sunday 23:59 Qatar belongs to the week of the previous Monday", () => {
    expect(qatarWeekStart(Date.UTC(2026, 9, 18, 20, 59, 59, 999))).toBe("2026-10-12");
    expect(qatarWeekStart(Date.UTC(2026, 9, 18, 21, 0, 0))).toBe("2026-10-19");
  });
  it("crosses a year boundary", () => {
    expect(qatarWeekStart(Date.UTC(2027, 0, 1, 12))).toBe("2026-12-28");
    expect(qatarWeekStart(Date.UTC(2026, 11, 31, 21, 0))).toBe("2026-12-28"); // 1 Jan 00:00 Qatar (Friday)
  });
  it("accepts a Date; leap day", () => {
    expect(qatarWeekStart(new Date("2028-02-29T10:00:00Z"))).toBe("2028-02-28");
    expect(qatarWeekStart(new Date("2026-10-14T21:00:00Z"))).toBe(qatarWeekStart(Date.parse("2026-10-14T21:00:00Z")));
  });
  it("streak: a missed week resets, clock skew into the past keeps", () => {
    expect(nextStreak({ streakWeeks: 4, lastActiveWeek: "2026-10-05" }, "2026-10-19")).toMatchObject({ streakWeeks: 1, changed: true });
    expect(nextStreak({ streakWeeks: 4, lastActiveWeek: "2026-10-19" }, "2026-10-12")).toMatchObject({ streakWeeks: 4, lastActiveWeek: "2026-10-19", changed: false });
    expect(nextStreak({ streakWeeks: 4, lastActiveWeek: null }, "2026-10-12")).toMatchObject({ streakWeeks: 1, changed: true });
  });
  it("streak spans a year boundary", () => {
    expect(nextStreak({ streakWeeks: 2, lastActiveWeek: "2026-12-28" }, "2027-01-04")).toMatchObject({ streakWeeks: 3 });
  });
  it("displayStreak is alive until Sunday 23:59 Qatar of the next week and dies at Monday 00:00 after", () => {
    const state = { streakWeeks: 3, lastActiveWeek: "2026-10-05" };
    expect(displayStreak(state, Date.UTC(2026, 9, 18, 20, 59, 59))).toBe(3);
    expect(displayStreak(state, Date.UTC(2026, 9, 18, 21, 0, 0))).toBe(0);
  });
  it("xpForPass floors fractions and clamps to level 1..6", () => {
    expect(xpForPass(2.9)).toBe(15);
    expect(xpForPass(Number.NaN)).toBe(10);
    expect(xpForPass(0)).toBe(10);
    expect(xpForPass(-4)).toBe(10);
  });
});
