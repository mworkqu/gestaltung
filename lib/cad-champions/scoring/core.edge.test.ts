// Extra edge cases for the scoring maths (complements core.test.ts).
import { describe, expect, it } from "vitest";

import { BAND_THRESHOLDS, JUDGEMENT_MAX, LEVEL_THRESHOLDS, OFFICIAL_WEIGHTS } from "./config";
import { areaScores, aspectPoints, bandFor, levelFor, overallPercent, scoreAttempt, taskScore, type AspectInput, type ScoreUnit, type TaskInput } from "./core";

const unit = (area: number, earned: number, max: number): ScoreUnit => ({
  taskId: "t",
  aspectId: null,
  skillAreaId: area as ScoreUnit["skillAreaId"],
  module: null,
  type: "measurement",
  earned,
  max,
  unscored: false,
});

describe("config", () => {
  it("official weights sum to 100 and judgement max is 3", () => {
    expect(Object.values(OFFICIAL_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
    expect(JUDGEMENT_MAX).toBe(3);
  });
  it("thresholds are ascending from 0", () => {
    for (const list of [LEVEL_THRESHOLDS.map((t) => t.min), BAND_THRESHOLDS.map((t) => t.min)]) {
      expect(list[0]).toBe(0);
      expect([...list].sort((a, b) => a - b)).toEqual(list);
    }
  });
});

describe("aspectPoints edge cases", () => {
  type A = Pick<AspectInput, "type" | "max_points" | "partial_rule">;
  const m = (max: number | string | null, partial: unknown = null): A => ({ type: "measurement", max_points: max, partial_rule: partial });
  const j = (max: number | string | null): A => ({ type: "judgement", max_points: max });

  it("accepts max_points as a numeric string (Postgres numeric)", () => {
    expect(aspectPoints(m("4.5"), { aspect_id: "a", passed: true, judgement_score: null })).toBe(4.5);
    expect(aspectPoints(j("6"), { aspect_id: "a", passed: null, judgement_score: 2 })).toBe(4);
  });
  it("zero, null or negative max gives 0", () => {
    expect(aspectPoints(m(0), { aspect_id: "a", passed: true, judgement_score: null })).toBe(0);
    expect(aspectPoints(m(null), { aspect_id: "a", passed: true, judgement_score: null })).toBe(0);
    expect(aspectPoints(m(-3), { aspect_id: "a", passed: true, judgement_score: null })).toBe(0);
  });
  it("partial rule: negative points clamp to 0, string points parse, junk falls back to passed", () => {
    const rule = { type: "steps" };
    expect(aspectPoints(m(5, rule), { aspect_id: "a", passed: true, judgement_score: null, points_awarded: -2 })).toBe(0);
    expect(aspectPoints(m(5, rule), { aspect_id: "a", passed: false, judgement_score: null, points_awarded: "3.25" })).toBe(3.25);
    expect(aspectPoints(m(5, rule), { aspect_id: "a", passed: true, judgement_score: null, points_awarded: "abc" })).toBe(5);
    expect(aspectPoints(m(5, rule), { aspect_id: "a", passed: false, judgement_score: null, points_awarded: "abc" })).toBe(0);
  });
  it("partial rule with 0 points awarded stays 0 even if passed is true", () => {
    expect(aspectPoints(m(5, { type: "steps" }), { aspect_id: "a", passed: true, judgement_score: null, points_awarded: 0 })).toBe(0);
  });
  it("judgement: negative clamps to 0, fractions round to a whole score, 1.5 rounds up", () => {
    expect(aspectPoints(j(3), { aspect_id: "a", passed: null, judgement_score: -1 })).toBe(0);
    expect(aspectPoints(j(3), { aspect_id: "a", passed: null, judgement_score: 1.4 })).toBe(1);
    expect(aspectPoints(j(3), { aspect_id: "a", passed: null, judgement_score: 1.5 })).toBe(2);
  });
  it("judgement ignores passed; measurement ignores judgement_score", () => {
    expect(aspectPoints(j(6), { aspect_id: "a", passed: true, judgement_score: 0 })).toBe(0);
    expect(aspectPoints(m(6), { aspect_id: "a", passed: false, judgement_score: 3 })).toBe(0);
  });
  it("judgement points are rounded to 2 decimals", () => {
    expect(aspectPoints(j(5), { aspect_id: "a", passed: null, judgement_score: 1 })).toBe(1.67);
    expect(aspectPoints(j(5), { aspect_id: "a", passed: null, judgement_score: 2 })).toBe(3.33);
  });
});

describe("taskScore fallback order", () => {
  const task: TaskInput = { id: "t", skill_area_id: 3, competition_module: "M3", max_points: 20, grading_mode: "manual" };
  const base = { task_id: "t", status: "final", submission_id: "s" };
  it("final > manual > ai > auto", () => {
    expect(taskScore(task, [], [], { ...base, final_score: 1, manual_score: 2, ai_score: 3, auto_score: 4 }).earned).toBe(1);
    expect(taskScore(task, [], [], { ...base, final_score: null, manual_score: 2, ai_score: 3, auto_score: 4 }).earned).toBe(2);
    expect(taskScore(task, [], [], { ...base, final_score: null, manual_score: null, ai_score: 3, auto_score: 4 }).earned).toBe(3);
    expect(taskScore(task, [], [], { ...base, final_score: null, manual_score: null, ai_score: null, auto_score: 4 }).earned).toBe(4);
    expect(taskScore(task, [], [], { ...base, final_score: "7.5" }).earned).toBe(7.5);
  });
  it("final score 0 wins over a higher manual score", () => {
    expect(taskScore(task, [], [], { ...base, final_score: 0, manual_score: 9 }).earned).toBe(0);
  });
  it("no result, negative score and unknown area fall back safely", () => {
    expect(taskScore(task, [], []).earned).toBe(0);
    expect(taskScore(task, [], [], { ...base, final_score: -5 }).earned).toBe(0);
    const odd = taskScore({ ...task, skill_area_id: 99 }, [], [], { ...base, final_score: 5 });
    expect(odd.units[0].skillAreaId).toBe(3);
  });
});

describe("overall percent edge cases", () => {
  it("one covered area equals that area's percent", () => {
    expect(overallPercent(areaScores([unit(2, 3, 4)])).percent).toBe(75);
  });
  it("zero-weight covered areas fall back to the plain mean", () => {
    const areas = areaScores([unit(3, 10, 10), unit(6, 0, 10)], { 3: 0, 6: 0 });
    expect(overallPercent(areas).percent).toBe(50);
  });
  it("an uncovered heavy area does not drag the overall down", () => {
    expect(overallPercent(areaScores([unit(1, 10, 10)])).percent).toBe(100);
  });
  it("percent is clamped to 100 when earned exceeds max", () => {
    expect(areaScores([unit(3, 15, 10)]).find((a) => a.skillAreaId === 3)?.percent).toBe(100);
  });
  it("assessed areas get a level, unassessed none", () => {
    const areas = areaScores([unit(3, 9, 10)]);
    expect(areas.find((a) => a.skillAreaId === 3)).toMatchObject({ assessed: true, level: 6 });
    expect(areas.find((a) => a.skillAreaId === 1)).toMatchObject({ assessed: false, level: null, percent: null });
  });
});

describe("levels and bands: odd input", () => {
  it("negative, NaN and very large input", () => {
    expect(levelFor(-5)).toBe(1);
    expect(levelFor(Number.NaN)).toBe(1);
    expect(bandFor(Number.NaN)).toBe("beginner");
    expect(levelFor(1000)).toBe(6);
    expect(bandFor(1000)).toBe("competition_ready");
  });
});

describe("scoreAttempt with nothing", () => {
  it("returns a null overall and band for an empty attempt", () => {
    const r = scoreAttempt({ tasks: [], aspects: [], aspectResults: [], results: [] });
    expect(r).toMatchObject({ overall: null, band: null, totalEarned: 0, totalMax: 0, outcome: "no_files" });
  });
});
