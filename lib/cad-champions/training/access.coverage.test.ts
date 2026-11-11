import { describe, expect, it } from "vitest";

import { MAX_HINTS, SOLUTION_AFTER_ATTEMPTS, attemptsUntilSolution, canRevealHint, canSeeSolution, canUseExercise, canWatchLesson, hintsAvailable, levelOpenWithoutEnrollment } from "./access";

const none = { enrolled: false, staff: false };

describe("access matrix", () => {
  it.each([
    [false, false, false, false, false],
    [false, false, true, false, true],
    [false, false, false, true, true],
    [true, false, false, false, true],
    [false, true, false, false, true],
  ])("enrolled=%s staff=%s preview=%s orientation=%s -> lesson %s", (enrolled, staff, is_free_preview, isOrientation, ok) => {
    expect(canWatchLesson({ enrolled, staff }, { is_free_preview, isOrientation })).toBe(ok);
  });
  it("exercise: sample open to all, others need enrollment or staff", () => {
    expect(canUseExercise(none, { is_free_sample: true })).toBe(true);
    expect(canUseExercise(none, { is_free_sample: false })).toBe(false);
    expect(canUseExercise({ enrolled: true, staff: false }, { is_free_sample: false })).toBe(true);
    expect(canUseExercise({ enrolled: false, staff: true }, { is_free_sample: false })).toBe(true);
  });
  it("levelOpenWithoutEnrollment truth table", () => {
    const l = (isOrientation: boolean, hasFreePreviewLesson: boolean, hasFreeSampleExercise: boolean) =>
      levelOpenWithoutEnrollment({ isOrientation, hasFreePreviewLesson, hasFreeSampleExercise });
    expect(l(false, false, false)).toBe(false);
    expect(l(true, false, false)).toBe(true);
    expect(l(false, true, false)).toBe(true);
    expect(l(false, false, true)).toBe(true);
  });
});

describe("hints", () => {
  it("MAX_HINTS is 3 and caps even with many hints and failures", () => {
    expect(MAX_HINTS).toBe(3);
    expect(hintsAvailable(10, 10)).toBe(3);
    expect(hintsAvailable(2, 10)).toBe(2);
    expect(hintsAvailable(10, 1)).toBe(1);
  });
  it("negative, NaN, Infinity and fractional inputs", () => {
    expect(hintsAvailable(-4, 3)).toBe(0);
    expect(hintsAvailable(3, -1)).toBe(0);
    expect(hintsAvailable(Number.NaN, 3)).toBe(0);
    expect(hintsAvailable(3, Number.NaN)).toBe(0);
    expect(hintsAvailable(Infinity, 3)).toBe(0);
    expect(hintsAvailable(2.9, 3)).toBe(2);
  });
  it("canRevealHint rejects 0, negative, fractional, NaN and beyond-available", () => {
    expect(canRevealHint(1, 1, 3)).toBe(true);
    expect(canRevealHint(2, 1, 3)).toBe(false);
    expect(canRevealHint(3, 3, 3)).toBe(true);
    expect(canRevealHint(4, 99, 99)).toBe(false);
    for (const n of [0, -1, 1.5, Number.NaN]) expect(canRevealHint(n, 3, 3)).toBe(false);
    expect(canRevealHint(1, 5, 0)).toBe(false);
  });
});

describe("solution", () => {
  it("threshold is 5; pass opens early; no video never opens", () => {
    expect(SOLUTION_AFTER_ATTEMPTS).toBe(5);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 4 })).toBe(false);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 5 })).toBe(true);
    expect(canSeeSolution({ hasVideo: true, passed: true, attempts: 0 })).toBe(true);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 0, staff: true })).toBe(true);
    expect(canSeeSolution({ hasVideo: false, passed: true, attempts: 9, staff: true })).toBe(false);
  });
  it("attemptsUntilSolution: counts down, passed gives 0, negative attempts clamp", () => {
    expect(attemptsUntilSolution(false, 0)).toBe(5);
    expect(attemptsUntilSolution(false, 4)).toBe(1);
    expect(attemptsUntilSolution(false, 5)).toBe(0);
    expect(attemptsUntilSolution(false, -3)).toBe(5);
    expect(attemptsUntilSolution(false, 2.7)).toBe(3);
    expect(attemptsUntilSolution(true, 0)).toBe(0);
  });
});
