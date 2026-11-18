// Supplementary scoring cases (literal expectations, independent of config tables).
import { describe, expect, it } from "vitest";

import { areaScores, aspectPoints, bandFor, deltaSinceLast, levelFor, overallPercent, recommendTrainingPath, type ScoreUnit } from "./core";

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
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe("level / band literal boundaries", () => {
  it.each([
    [0, 1], [19.99, 1], [20, 2], [39.99, 2], [40, 3], [59.99, 3], [60, 4], [74.99, 4],
    [75, 5], [89.99, 5], [90, 6], [100, 6], [101, 6], [-0.01, 1], [Infinity, 1], [-Infinity, 1],
  ])("levelFor(%s) = %s", (p, l) => expect(levelFor(p)).toBe(l));
  it.each([
    [0, "beginner"], [39.99, "beginner"], [40, "developing"], [64.99, "developing"],
    [65, "competitive"], [84.99, "competitive"], [85, "competition_ready"], [100, "competition_ready"],
    [-3, "beginner"], [Number.NaN, "beginner"],
  ] as const)("bandFor(%s) = %s", (p, b) => expect(bandFor(p)).toBe(b));
});

describe("overall percent renormalisation (literal numbers)", () => {
  it("areas 1 (w10) 100% and 3 (w30) 0% -> 25", () => {
    expect(overallPercent(areaScores([unit(1, 10, 10), unit(3, 0, 10)])).percent).toBe(25);
  });
  it("covered ids are listed in area order and exclude unassessed", () => {
    const r = overallPercent(areaScores([unit(6, 5, 10), unit(2, 10, 10)]));
    expect(r.covered).toEqual([2, 6]);
    expect(r.percent).toBe(round((5 * 100 + 30 * 50) / 35));
  });
  it("an area with max 0 is not assessed", () => {
    const a = areaScores([unit(3, 0, 0), unit(4, 5, 10)]);
    expect(a.find((x) => x.skillAreaId === 3)).toMatchObject({ assessed: false, percent: null, level: null });
    expect(overallPercent(a)).toEqual({ percent: 50, covered: [4] });
  });
  it("none assessed -> null and empty covered", () => {
    expect(overallPercent(areaScores([]))).toEqual({ percent: null, covered: [] });
  });
  it("DB weights override official ones", () => {
    const a = areaScores([unit(3, 10, 10), unit(4, 0, 10)], { 3: 50 });
    expect(overallPercent(a).percent).toBe(round((50 * 100 + 10 * 0) / 60));
  });
});

describe("judgement 0-3 points", () => {
  const j = { type: "judgement", max_points: 6 } as const;
  const res = (s: number | null) => ({ aspect_id: "a", passed: null, judgement_score: s });
  it.each([[0, 0], [1, 2], [2, 4], [3, 6], [4, 6], [99, 6], [-1, 0]])("score %s -> %s of 6", (s, p) => expect(aspectPoints(j, res(s))).toBe(p));
  it("null score gives 0; NaN score counts as 0", () => {
    expect(aspectPoints(j, res(null))).toBe(0);
    expect(aspectPoints(j, res(Number.NaN))).toBe(0);
  });
  it("max not divisible by 3 is rounded to 2 decimals", () => {
    expect(aspectPoints({ type: "judgement", max_points: 5 }, res(1))).toBe(1.67);
    expect(aspectPoints({ type: "judgement", max_points: 5 }, res(2))).toBe(3.33);
  });
});

describe("recommendTrainingPath", () => {
  const a = (id: number, weight: number, percent: number | null) => ({ skillAreaId: id as 1, weight, percent, assessed: percent != null });
  it("excludes unassessed and ranks by weight x gap", () => {
    const p = recommendTrainingPath([a(1, 10, 0), a(3, 30, 50), a(6, 30, null)]);
    expect(p.map((s) => s.skillAreaId)).toEqual([3, 1]);
    expect(p.map((s) => s.priority)).toEqual([1500, 1000]);
  });
  it("ties broken by weight desc then area id asc", () => {
    // equal priority 1000: higher weight first
    expect(recommendTrainingPath([a(1, 10, 0), a(5, 20, 50)]).map((s) => s.skillAreaId)).toEqual([5, 1]);
    // equal priority and weight: lower area id first
    expect(recommendTrainingPath([a(2, 10, 50), a(1, 10, 50)]).map((s) => s.skillAreaId)).toEqual([1, 2]);
  });
  it("reasonKey: strong from 85 %, otherwise first then next", () => {
    const p = recommendTrainingPath([a(3, 30, 85), a(1, 10, 84.99), a(6, 30, 10)]);
    const byId = Object.fromEntries(p.map((s) => [s.skillAreaId, s.reasonKey]));
    expect(byId[3]).toBe("strong");
    expect(byId[6]).toBe("first");
    expect(byId[1]).toBe("next");
  });
  it("empty / nothing assessed -> []", () => {
    expect(recommendTrainingPath([])).toEqual([]);
    expect(recommendTrainingPath([a(1, 10, null)])).toEqual([]);
  });
});

describe("deltaSinceLast", () => {
  it("uses the last two scored attempts, skipping nulls", () => {
    expect(deltaSinceLast([10, null, 40, null, 55])).toBe(15);
    expect(deltaSinceLast([50, 40])).toBe(-10);
  });
  it("null with fewer than two scored", () => {
    expect(deltaSinceLast([])).toBeNull();
    expect(deltaSinceLast([null, 5])).toBeNull();
  });
});
