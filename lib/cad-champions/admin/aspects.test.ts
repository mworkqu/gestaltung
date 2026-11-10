import { describe, expect, it } from "vitest";

import { defaultRubric } from "../drawing/rubric";
import {
  aspectSplit,
  isValidCheckKey,
  JUDGEMENT_WARN_PERCENT,
  parsePartialRule,
  planRubricAspectSync,
  pointsMatch,
  standardAutoPoints,
  sumAspectPoints,
  validateAspect,
} from "./aspects";

describe("aspectSplit", () => {
  it("splits measurement and judgement points with percentages", () => {
    const s = aspectSplit([
      { type: "measurement", max_points: 93 },
      { type: "judgement", max_points: 7 },
    ]);
    expect(s).toMatchObject({ measurement: 93, judgement: 7, total: 100, measurementPercent: 93, judgementPercent: 7, judgementTooHigh: false });
  });

  it("flags judgement above 20 % but not exactly 20 %", () => {
    expect(aspectSplit([{ type: "measurement", max_points: 80 }, { type: "judgement", max_points: 20 }]).judgementTooHigh).toBe(false);
    expect(aspectSplit([{ type: "measurement", max_points: 79 }, { type: "judgement", max_points: 21 }]).judgementTooHigh).toBe(true);
    expect(JUDGEMENT_WARN_PERCENT).toBe(20);
  });

  it("handles string numbers, negatives and an empty list", () => {
    expect(aspectSplit([])).toMatchObject({ total: 0, judgementPercent: 0, measurementPercent: 0, judgementTooHigh: false });
    const s = aspectSplit([{ type: "measurement", max_points: "2.5" }, { type: "judgement", max_points: -3 }, { type: "measurement", max_points: null }]);
    expect(s.measurement).toBe(2.5);
    expect(s.judgement).toBe(0);
  });

  it("rounds percentages to one decimal and keeps them summing to 100", () => {
    const s = aspectSplit([{ type: "measurement", max_points: 23 }, { type: "judgement", max_points: 2 }]);
    expect(s.judgementPercent).toBe(8);
    expect(s.measurementPercent + s.judgementPercent).toBe(100);
    const t = aspectSplit([{ type: "measurement", max_points: 2 }, { type: "judgement", max_points: 1 }]);
    expect(t.judgementPercent).toBe(33.3);
    expect(t.measurementPercent).toBe(66.7);
  });
});

describe("points helpers", () => {
  it("sums and compares with the task max points", () => {
    const a = [{ max_points: 10 }, { max_points: "2.5" }, { max_points: 12.5 }];
    expect(sumAspectPoints(a)).toBe(25);
    expect(pointsMatch(a, 25)).toBe(true);
    expect(pointsMatch(a, "25.00")).toBe(true);
    expect(pointsMatch(a, 24)).toBe(false);
  });

  it("splits standard STEP points so they add up exactly", () => {
    const p = standardAutoPoints(25);
    expect(p.map((x) => x.key)).toEqual(["volume", "area", "inertia", "solids"]);
    expect(p.reduce((s, x) => s + x.points, 0)).toBeCloseTo(25, 5);
    const q = standardAutoPoints(7);
    expect(Math.round(q.reduce((s, x) => s + x.points, 0) * 100) / 100).toBe(7);
  });
});

describe("check keys", () => {
  it("accepts grader keys, part and rubric keys", () => {
    for (const k of ["volume", "area", "inertia", "solids", "parts_count", "assembly_position", "part:Bracket 2", "rubric:title_block"]) expect(isValidCheckKey(k)).toBe(true);
    for (const k of ["", "Volume", "rubric:Bad Id", "part:", "drop table"]) expect(isValidCheckKey(k)).toBe(false);
  });
});

describe("parsePartialRule", () => {
  it("reads empty as all-or-nothing and requires an object", () => {
    expect(parsePartialRule("")).toEqual({ ok: true, value: null });
    expect(parsePartialRule("null")).toEqual({ ok: true, value: null });
    expect(parsePartialRule('{"kind":"grader"}')).toEqual({ ok: true, value: { kind: "grader" } });
    expect(parsePartialRule("[1]").ok).toBe(false);
    expect(parsePartialRule("{bad").ok).toBe(false);
    expect(parsePartialRule(5).ok).toBe(false);
  });
});

describe("validateAspect", () => {
  const base = {
    description_en: "Volume within 0.5 %",
    description_ar: "الحجم ضمن 0.5 %",
    skill_area_id: "3",
    competition_module: "M3",
    type: "measurement",
    max_points: "10",
    method: "auto_step",
    partial_rule: "",
    check_key: "volume",
    student_hint_en: "",
    student_hint_ar: "",
  };

  it("cleans a valid aspect", () => {
    const r = validateAspect(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ skill_area_id: 3, competition_module: "M3", max_points: 10, check_key: "volume", partial_rule: null, student_hint_en: null });
  });

  it("requires both languages, a skill area and points", () => {
    const r = validateAspect({ ...base, description_ar: " ", skill_area_id: "9", max_points: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(["description_ar", "skill_area", "points"]));
  });

  it("forces judgement aspects to the trainer and drops a partial rule", () => {
    const bad = validateAspect({ ...base, type: "judgement", method: "auto_step" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toContain("judgement_method");
    const ok = validateAspect({ ...base, type: "judgement", method: "trainer", check_key: "", partial_rule: '{"x":1}' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.partial_rule).toBeNull();
  });

  it("needs a grader check key for auto_step", () => {
    const r = validateAspect({ ...base, check_key: "rubric:views" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("auto_check_key");
  });

  it("accepts no module", () => {
    const r = validateAspect({ ...base, competition_module: "" });
    expect(r.ok && r.value.competition_module).toBeNull();
    expect(validateAspect({ ...base, competition_module: "M9" }).ok).toBe(false);
  });
});

describe("planRubricAspectSync", () => {
  const ctx = { skill_area_id: 4 as const, competition_module: "M2" as const };

  it("inserts one aspect per item with the SQL method rule", () => {
    const rubric = defaultRubric("part");
    const plan = planRubricAspectSync(rubric, [], ctx);
    expect(plan.inserts).toHaveLength(rubric.items.length);
    expect(plan.updates).toHaveLength(0);
    const title = plan.inserts.find((r) => r.check_key === "rubric:title_block")!;
    expect(title).toMatchObject({ method: "ai_drawing", type: "measurement", position: 1, skill_area_id: 4, competition_module: "M2" });
    expect(plan.inserts.find((r) => r.check_key === "rubric:key_dimensions")!.method).toBe("trainer");
    expect(plan.inserts.find((r) => r.check_key === "rubric:presentation")!).toMatchObject({ type: "judgement", method: "trainer" });
  });

  it("updates matched rows, deletes removed rubric rows and keeps other aspects", () => {
    const rubric = { version: 1 as const, kind: "part" as const, items: defaultRubric("part").items.slice(0, 2) };
    const existing = [
      { id: "a1", check_key: "rubric:title_block" },
      { id: "a2", check_key: "rubric:gone" },
      { id: "a3", check_key: "volume" },
      { id: "a4", check_key: null },
    ];
    const plan = planRubricAspectSync(rubric, existing, ctx);
    expect(plan.updates.map((u) => u.id)).toEqual(["a1"]);
    expect(plan.inserts.map((r) => r.check_key)).toEqual(["rubric:projection"]);
    expect(plan.deleteIds).toEqual(["a2"]);
  });

  it("deletes every rubric aspect when the rubric is empty", () => {
    const plan = planRubricAspectSync(null, [{ id: "a1", check_key: "rubric:x" }, { id: "a2", check_key: "area" }], ctx);
    expect(plan.deleteIds).toEqual(["a1"]);
    expect(plan.inserts).toEqual([]);
  });
});
