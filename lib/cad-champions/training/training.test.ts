import { describe, expect, it } from "vitest";

import {
  attemptsUntilSolution,
  canRevealHint,
  canSeeSolution,
  canUseExercise,
  canWatchLesson,
  hasFullAccess,
  hintsAvailable,
  levelOpenWithoutEnrollment,
} from "./access";
import { buildCertificateHtml, generateCertificateCode, normaliseCertificateCode } from "./certificate";
import { MODULE_FOR_SKILL_AREA, exercisePrefix } from "./catalog";
import { displayStreak, nextStreak, qatarWeekStart, xpForPass } from "./gamification";
import { computeLadder, moduleProgress, parseUnlockRule, splitMinutes, type LadderLevelInput, type LadderProgress } from "./ladder";
import { isNeutralLesson, lessonVideos, pickVideoSlot, recordedTracks, trackNoteFor } from "./video-pick";

const NOT_ENROLLED = { enrolled: false, staff: false };
const ENROLLED = { enrolled: true, staff: false };
const STAFF = { enrolled: false, staff: true };

describe("access", () => {
  it("opens orientation and free-preview lessons to everyone", () => {
    expect(canWatchLesson(NOT_ENROLLED, { is_free_preview: false, isOrientation: true })).toBe(true);
    expect(canWatchLesson(NOT_ENROLLED, { is_free_preview: true, isOrientation: false })).toBe(true);
    expect(canWatchLesson(NOT_ENROLLED, { is_free_preview: false, isOrientation: false })).toBe(false);
    expect(canWatchLesson(ENROLLED, { is_free_preview: false, isOrientation: false })).toBe(true);
    expect(canWatchLesson(STAFF, { is_free_preview: false, isOrientation: false })).toBe(true);
  });

  it("lets non-enrolled students use only free-sample exercises", () => {
    expect(canUseExercise(NOT_ENROLLED, { is_free_sample: true })).toBe(true);
    expect(canUseExercise(NOT_ENROLLED, { is_free_sample: false })).toBe(false);
    expect(canUseExercise(ENROLLED, { is_free_sample: false })).toBe(true);
    expect(hasFullAccess(STAFF)).toBe(true);
    expect(hasFullAccess(NOT_ENROLLED)).toBe(false);
  });

  it("reveals hint N only after N failed attempts", () => {
    expect(hintsAvailable(0, 3)).toBe(0);
    expect(hintsAvailable(2, 3)).toBe(2);
    expect(hintsAvailable(9, 2)).toBe(2);
    expect(hintsAvailable(9, 5)).toBe(3);
    expect(canRevealHint(1, 0, 3)).toBe(false);
    expect(canRevealHint(1, 1, 3)).toBe(true);
    expect(canRevealHint(2, 1, 3)).toBe(false);
    expect(canRevealHint(3, 3, 2)).toBe(false);
    expect(canRevealHint(1.5, 3, 3)).toBe(false);
    expect(canRevealHint(0, 3, 3)).toBe(false);
  });

  it("opens the solution after a pass or 5 attempts", () => {
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 4 })).toBe(false);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 5 })).toBe(true);
    expect(canSeeSolution({ hasVideo: true, passed: true, attempts: 1 })).toBe(true);
    expect(canSeeSolution({ hasVideo: false, passed: true, attempts: 9 })).toBe(false);
    expect(canSeeSolution({ hasVideo: true, passed: false, attempts: 0, staff: true })).toBe(true);
    expect(attemptsUntilSolution(false, 2)).toBe(3);
    expect(attemptsUntilSolution(true, 0)).toBe(0);
  });

  it("knows which levels need an enrollment", () => {
    expect(levelOpenWithoutEnrollment({ isOrientation: true, hasFreePreviewLesson: false, hasFreeSampleExercise: false })).toBe(true);
    expect(levelOpenWithoutEnrollment({ isOrientation: false, hasFreePreviewLesson: false, hasFreeSampleExercise: true })).toBe(true);
    expect(levelOpenWithoutEnrollment({ isOrientation: false, hasFreePreviewLesson: false, hasFreeSampleExercise: false })).toBe(false);
  });
});

describe("video pick", () => {
  const all = lessonVideos({ video_inventor_en: "a", video_inventor_ar: "b", video_fusion_en: "c", video_solidworks_ar: " ", video_neutral_en: null });

  it("reads only filled slots", () => {
    expect(all).toEqual({ inventor_en: "a", inventor_ar: "b", fusion_en: "c" });
    expect(recordedTracks(all)).toEqual(["inventor", "fusion"]);
    expect(isNeutralLesson(all)).toBe(false);
  });

  it("follows track + language, then other language, then Inventor, then any", () => {
    expect(pickVideoSlot(all, "inventor", "ar")).toMatchObject({ slot: "inventor_ar", note: null });
    expect(pickVideoSlot(all, "fusion", "en")).toMatchObject({ slot: "fusion_en", note: null });
    expect(pickVideoSlot(all, "fusion", "ar")).toMatchObject({ slot: "fusion_en", note: "other_language" });
    expect(pickVideoSlot(all, "solidworks", "ar")).toMatchObject({ slot: "inventor_ar", note: "inventor_fallback" });
    expect(pickVideoSlot({ fusion_ar: "x" }, "solidworks", "en")).toMatchObject({ slot: "fusion_ar", note: "any_fallback" });
    expect(pickVideoSlot({}, "inventor", "en")).toMatchObject({ slot: null, value: null });
    expect(pickVideoSlot(all, null, "en")).toMatchObject({ slot: "inventor_en" });
  });

  it("prefers the shared neutral pair", () => {
    const n = { neutral_ar: "n", inventor_en: "a" };
    expect(pickVideoSlot(n, "inventor", "ar")).toMatchObject({ slot: "neutral_ar", note: null });
    expect(pickVideoSlot(n, "inventor", "en")).toMatchObject({ slot: "neutral_ar", note: "other_language" });
    expect(isNeutralLesson(n)).toBe(true);
  });

  it("reads track notes", () => {
    const notes = { fusion: "inventor_only", solidworks: { en: "Use weldments.", ar: "استخدم اللحامات." } };
    expect(trackNoteFor(notes, "inventor")).toBeNull();
    expect(trackNoteFor(notes, "fusion")).toEqual({ kind: "inventor_only" });
    expect(trackNoteFor(notes, "solidworks")).toEqual({ kind: "equivalent", en: "Use weldments.", ar: "استخدم اللحامات." });
    expect(trackNoteFor({}, "fusion")).toBeNull();
    expect(trackNoteFor("x", "fusion")).toBeNull();
  });
});

describe("ladder", () => {
  const level = (n: number, ex: string[], lessons: string[], rule: unknown, accessible = true): LadderLevelInput => ({
    id: `L${n}`,
    levelNumber: n,
    unlockRule: rule,
    exercises: ex.map((id) => ({ id, passMark: 80, minutes: 20 })),
    lessons: lessons.map((id) => ({ id, minutes: 10 })),
    accessible,
  });
  const levels = [
    level(2, ["e2a", "e2b"], ["l2"], { type: "previous_level_passed", pass_mark: 80 }),
    level(1, ["e1a"], ["l1"], { type: "open" }),
    level(3, [], ["l3"], { type: "previous_level_passed", pass_mark: 80 }),
    level(4, ["e4"], [], { type: "previous_level_passed", pass_mark: 80 }),
  ];
  const progress = (best: Record<string, number>, lessons: string[] = [], unlocks: string[] = []): LadderProgress => ({
    bestPercent: new Map(Object.entries(best)),
    completedLessons: new Set(lessons),
    manualUnlocks: new Set(unlocks),
  });

  it("starts with level 1 open and the rest locked with a reason", () => {
    const s = computeLadder(levels, progress({}));
    expect(s.map((x) => x.status)).toEqual(["unlocked", "locked", "locked", "locked"]);
    expect(s[1].reason).toEqual({ key: "passPrevious", level: 1, passMark: 80 });
  });

  it("unlocks the next level when every exercise is passed at the pass mark", () => {
    const s = computeLadder(levels, progress({ e1a: 85, e2a: 90, e2b: 79 }));
    expect(s.map((x) => x.status)).toEqual(["completed", "unlocked", "locked", "locked"]);
    const s2 = computeLadder(levels, progress({ e1a: 85, e2a: 90, e2b: 80 }));
    expect(s2.map((x) => x.status)).toEqual(["completed", "completed", "unlocked", "locked"]);
    expect(s2[3].reason).toEqual({ key: "completePrevious", level: 3 });
  });

  it("respects admin manual unlocks and enrollment", () => {
    expect(computeLadder(levels, progress({}, [], ["L3"]))[2].status).toBe("unlocked");
    const gated = computeLadder([level(1, ["e1a"], [], { type: "open" }), level(2, ["e2a"], [], { type: "open" }, false)], progress({}));
    expect(gated[1]).toMatchObject({ status: "locked", reason: { key: "enroll" } });
  });

  it("computes module progress and time left", () => {
    const s = computeLadder(levels, progress({ e1a: 85 }, ["l1"]));
    const p = moduleProgress(s);
    expect(p.levelsDone).toBe(1);
    expect(p.levelsTotal).toBe(4);
    expect(p.percent).toBe(Math.round((2 / 7) * 100));
    expect(p.minutesLeft).toBe(20 * 3 + 10 * 2);
    expect(p.complete).toBe(false);
    expect(moduleProgress(computeLadder(levels, progress({ e1a: 85, e2a: 90, e2b: 90, e4: 100 }, ["l3"]))).complete).toBe(true);
    expect(splitMinutes(135)).toEqual({ hours: 2, minutes: 15 });
  });

  it("falls back to a safe rule", () => {
    expect(parseUnlockRule(null)).toEqual({ type: "previous_level_passed", passMark: 80 });
    expect(parseUnlockRule({ type: "previous_level_passed", pass_mark: 70 })).toEqual({ type: "previous_level_passed", passMark: 70 });
  });
});

describe("gamification", () => {
  it("gives more XP on higher levels", () => {
    expect(xpForPass(1)).toBe(10);
    expect(xpForPass(6)).toBe(35);
    expect(xpForPass(99)).toBe(35);
  });

  it("finds the Qatar week start (Monday)", () => {
    // Sunday 2026-10-11 22:30 UTC = Monday 01:30 in Qatar
    expect(qatarWeekStart(Date.UTC(2026, 9, 11, 22, 30))).toBe("2026-10-12");
    expect(qatarWeekStart(Date.UTC(2026, 9, 14, 9))).toBe("2026-10-12");
    expect(qatarWeekStart(Date.UTC(2026, 9, 11, 9))).toBe("2026-10-05");
  });

  it("counts consecutive weeks", () => {
    expect(nextStreak(null, "2026-10-12")).toEqual({ streakWeeks: 1, lastActiveWeek: "2026-10-12", changed: true });
    expect(nextStreak({ streakWeeks: 2, lastActiveWeek: "2026-10-05" }, "2026-10-12")).toMatchObject({ streakWeeks: 3, changed: true });
    expect(nextStreak({ streakWeeks: 2, lastActiveWeek: "2026-10-12" }, "2026-10-12")).toMatchObject({ streakWeeks: 2, changed: false });
    expect(nextStreak({ streakWeeks: 5, lastActiveWeek: "2026-09-21" }, "2026-10-12")).toMatchObject({ streakWeeks: 1 });
    expect(displayStreak({ streakWeeks: 3, lastActiveWeek: "2026-10-05" }, Date.UTC(2026, 9, 14))).toBe(3);
    expect(displayStreak({ streakWeeks: 3, lastActiveWeek: "2026-09-28" }, Date.UTC(2026, 9, 14))).toBe(0);
    expect(displayStreak(null)).toBe(0);
  });
});

describe("certificates", () => {
  it("makes readable codes and normalises input", () => {
    const code = generateCertificateCode((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(code).toMatch(/^CC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(code).not.toMatch(/[01OIL]/);
    expect(normaliseCertificateCode(" cc-abcd-2345 ")).toBe("CC-ABCD-2345");
    expect(normaliseCertificateCode("CC-ABCD")).toBeNull();
    expect(normaliseCertificateCode(42)).toBeNull();
  });

  it("builds an escaped printable page in both directions", () => {
    const strings = {
      heading: "Certificate",
      awardedTo: "Awarded to",
      forCompleting: "for completing",
      issued: "Issued",
      code: "Code",
      verifyAt: "Verify at",
      disclaimer: "Training completion only.",
      brand: "Gestaltung360",
      print: "Print",
      htmlNote: "Print it.",
    };
    const html = buildCertificateHtml(
      { lang: "ar", studentName: "<b>Sara</b>", moduleTitle: "Foundations", dateText: "14 Oct 2026", code: "CC-ABCD-2345", verifyUrl: "x/verify/CC-ABCD-2345" },
      strings,
      { fallbackNote: true }
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;b&gt;Sara&lt;/b&gt;");
    expect(html).toContain("Training completion only.");
    expect(html).toContain("window.print()");
  });
});

describe("catalog", () => {
  it("maps every skill area to a module and builds own-folder prefixes", () => {
    for (const id of [1, 2, 3, 4, 5, 6] as const) expect(MODULE_FOR_SKILL_AREA[id].module.length).toBeGreaterThan(0);
    expect(exercisePrefix("u1", "e1")).toBe("u1/exercises/e1/");
  });
});
