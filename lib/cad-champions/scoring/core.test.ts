import { describe, expect, it } from "vitest";

import {
  aspectPoints,
  areaScores,
  attemptOutcome,
  bandFor,
  deltaSinceLast,
  isProvisional,
  levelFor,
  moduleReadiness,
  overallPercent,
  recommendTrainingPath,
  scoreAttempt,
  skillAreaPercent,
  taskScore,
  type AspectInput,
  type ScoreUnit,
  type TaskInput,
  type TaskResultInput,
} from "./core";

const meas = (id: string, task: string, max: number, area = 3, mod: string | null = "M3", partial: unknown = null): AspectInput => ({
  id,
  task_id: task,
  skill_area_id: area,
  competition_module: mod,
  type: "measurement",
  max_points: max,
  partial_rule: partial,
});
const judg = (id: string, task: string, max: number, area = 6, mod: string | null = "M3"): AspectInput => ({
  id,
  task_id: task,
  skill_area_id: area,
  competition_module: mod,
  type: "judgement",
  max_points: max,
});
const unit = (area: number, earned: number, max: number, mod: string | null = null): ScoreUnit => ({
  taskId: "t",
  aspectId: null,
  skillAreaId: area as ScoreUnit["skillAreaId"],
  module: mod as ScoreUnit["module"],
  type: "measurement",
  earned,
  max,
  unscored: false,
});

describe("aspectPoints", () => {
  it("measurement is all-or-nothing", () => {
    expect(aspectPoints(meas("a", "t", 5), { aspect_id: "a", passed: true, judgement_score: null })).toBe(5);
    expect(aspectPoints(meas("a", "t", 5), { aspect_id: "a", passed: false, judgement_score: null })).toBe(0);
    expect(aspectPoints(meas("a", "t", 5), { aspect_id: "a", passed: null, judgement_score: null })).toBe(0);
    // points_awarded is ignored without a partial rule
    expect(aspectPoints(meas("a", "t", 5), { aspect_id: "a", passed: false, judgement_score: null, points_awarded: 3 })).toBe(0);
  });

  it("measurement with a partial rule uses the grader's points (clamped)", () => {
    const a = meas("a", "t", 5, 3, "M3", { type: "steps" });
    expect(aspectPoints(a, { aspect_id: "a", passed: false, judgement_score: null, points_awarded: 2.5 })).toBe(2.5);
    expect(aspectPoints(a, { aspect_id: "a", passed: true, judgement_score: null, points_awarded: 9 })).toBe(5);
    expect(aspectPoints(a, { aspect_id: "a", passed: true, judgement_score: null, points_awarded: null })).toBe(5);
  });

  it("judgement = max x score / 3", () => {
    const a = judg("j", "t", 3);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: 0 })).toBe(0);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: 1 })).toBe(1);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: 2 })).toBe(2);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: 3 })).toBe(3);
    expect(aspectPoints(judg("j", "t", 2), { aspect_id: "j", passed: null, judgement_score: 2 })).toBe(1.33);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: null })).toBe(0);
    expect(aspectPoints(a, { aspect_id: "j", passed: null, judgement_score: 7 })).toBe(3);
  });

  it("no result = 0", () => {
    expect(aspectPoints(meas("a", "t", 5), null)).toBe(0);
  });
});

describe("taskScore", () => {
  const task: TaskInput = { id: "t1", skill_area_id: 3, competition_module: "M3", max_points: 25, grading_mode: "auto_step" };
  const aspects = [meas("v", "t1", 10), meas("a", "t1", 10), meas("s", "t1", 5), meas("other", "t2", 50)];

  it("sums the task's own aspects", () => {
    const r = taskScore(
      task,
      aspects,
      [
        { aspect_id: "v", passed: true, judgement_score: null },
        { aspect_id: "a", passed: false, judgement_score: null },
        { aspect_id: "s", passed: true, judgement_score: null },
      ],
      { task_id: "t1", status: "auto", submission_id: "sub" }
    );
    expect(r.earned).toBe(15);
    expect(r.max).toBe(25);
    expect(r.units).toHaveLength(3);
  });

  it("scores 0 when nothing was uploaded, even with passed aspect rows", () => {
    const r = taskScore(task, aspects, [{ aspect_id: "v", passed: true, judgement_score: null }], { task_id: "t1", status: "final", submission_id: null });
    expect(r.earned).toBe(0);
    expect(r.max).toBe(25);
  });

  it("falls back to the task result score when there are no aspects", () => {
    const r = taskScore(task, [], [], { task_id: "t1", status: "final", submission_id: "s", final_score: 18, auto_score: 10 });
    expect(r.earned).toBe(18);
    expect(r.max).toBe(25);
    const capped = taskScore(task, [], [], { task_id: "t1", status: "final", submission_id: "s", final_score: 40 });
    expect(capped.earned).toBe(25);
  });

  it("marks an unscored judgement aspect only when a file exists", () => {
    const t: TaskInput = { id: "d", skill_area_id: 6, competition_module: "M3", max_points: 10, grading_mode: "ai_drawing" };
    const withFile = taskScore(t, [judg("j", "d", 3)], [], { task_id: "d", status: "ai_pending_review", submission_id: "s" });
    expect(withFile.units[0].unscored).toBe(true);
    const noFile = taskScore(t, [judg("j", "d", 3)], [], { task_id: "d", status: "final", submission_id: null });
    expect(noFile.units[0].unscored).toBe(false);
  });

  it("uses the aspect's own skill area and module", () => {
    const r = taskScore(task, [meas("x", "t1", 4, 6, "M1")], [{ aspect_id: "x", passed: true, judgement_score: null }], {
      task_id: "t1",
      status: "auto",
      submission_id: "s",
    });
    expect(r.units[0].skillAreaId).toBe(6);
    expect(r.units[0].module).toBe("M1");
  });
});

describe("skill areas and overall", () => {
  it("skillAreaPercent = earned / max of that area", () => {
    const units = [unit(3, 10, 20), unit(3, 5, 10), unit(6, 3, 10)];
    expect(skillAreaPercent(units, 3)).toEqual({ earned: 15, max: 30, percent: 50 });
    expect(skillAreaPercent(units, 6).percent).toBe(30);
    expect(skillAreaPercent(units, 1).percent).toBeNull();
  });

  it("re-normalises the official weights over covered areas", () => {
    // Modelling (30) at 80 %, drawing (30) at 40 % -> 60 %
    const areas = areaScores([unit(3, 8, 10), unit(6, 4, 10)]);
    const r = overallPercent(areas);
    expect(r.percent).toBe(60);
    expect(r.covered).toEqual([3, 6]);
    expect(areas.find((a) => a.skillAreaId === 1)?.assessed).toBe(false);
  });

  it("weights differ: modelling 30 at 100 %, rendering 10 at 0 % -> 75 %", () => {
    const r = overallPercent(areaScores([unit(3, 10, 10), unit(4, 0, 10)]));
    expect(r.percent).toBe(75);
    expect(r.covered).toEqual([3, 4]);
  });

  it("all six areas covered = plain weighted mean (weights sum to 100)", () => {
    const units = [unit(1, 10, 10), unit(2, 10, 10), unit(3, 5, 10), unit(4, 0, 10), unit(5, 10, 10), unit(6, 5, 10)];
    // 10 + 5 + 15 + 0 + 15 + 15 = 60
    expect(overallPercent(areaScores(units)).percent).toBe(60);
  });

  it("uses weights from the database when given", () => {
    const areas = areaScores([unit(3, 10, 10), unit(6, 0, 10)], { 3: 10, 6: 30 });
    expect(overallPercent(areas).percent).toBe(25);
  });

  it("returns null with no covered area", () => {
    expect(overallPercent(areaScores([])).percent).toBeNull();
  });
});

describe("levels and bands", () => {
  it.each([
    [0, 1],
    [19.99, 1],
    [20, 2],
    [39, 2],
    [40, 3],
    [59.9, 3],
    [60, 4],
    [74, 4],
    [75, 5],
    [89.99, 5],
    [90, 6],
    [100, 6],
  ])("level(%s) = L%s", (p, l) => expect(levelFor(p)).toBe(l));

  it.each([
    [0, "beginner"],
    [39.9, "beginner"],
    [40, "developing"],
    [64.9, "developing"],
    [65, "competitive"],
    [84.99, "competitive"],
    [85, "competition_ready"],
    [100, "competition_ready"],
  ])("band(%s) = %s", (p, b) => expect(bandFor(p)).toBe(b));
});

describe("attempt outcome / provisional", () => {
  const tasks: TaskInput[] = [
    { id: "a", skill_area_id: 3, competition_module: "M3", max_points: 25, grading_mode: "auto_step" },
    { id: "d", skill_area_id: 6, competition_module: "M3", max_points: 25, grading_mode: "ai_drawing" },
  ];
  const r = (task_id: string, status: string, file = true, extra: Partial<TaskResultInput> = {}): TaskResultInput => ({
    task_id,
    status,
    submission_id: file ? `s-${task_id}` : null,
    ...extra,
  });

  it("no files at all", () => {
    expect(attemptOutcome(tasks, [r("a", "pending", false), r("d", "pending", false)])).toBe("no_files");
  });
  it("auto task still pending = grading", () => {
    expect(attemptOutcome(tasks, [r("a", "pending"), r("d", "final")])).toBe("grading");
  });
  it("drawing waiting for a trainer = provisional", () => {
    expect(isProvisional(tasks, [r("a", "auto"), r("d", "ai_pending_review")])).toBe(true);
    expect(attemptOutcome(tasks, [r("a", "auto"), r("d", "pending")])).toBe("provisional");
  });
  it("error checked by hand = provisional; student error = graded", () => {
    expect(attemptOutcome(tasks, [r("a", "error", true, { needs_manual_review: true }), r("d", "final")])).toBe("provisional");
    expect(attemptOutcome(tasks, [r("a", "error"), r("d", "final")])).toBe("graded");
  });
  it("unscored judgement aspect = provisional", () => {
    const u = { ...unit(6, 0, 3), unscored: true };
    expect(attemptOutcome(tasks, [r("a", "auto"), r("d", "final")], [u])).toBe("provisional");
  });
  it("everything final = graded", () => {
    expect(attemptOutcome(tasks, [r("a", "auto"), r("d", "final")])).toBe("graded");
    expect(attemptOutcome(tasks, [r("a", "auto"), r("d", "pending", false)])).toBe("graded");
  });
});

describe("scoreAttempt (diagnostic-like)", () => {
  it("combines tasks, areas, overall and band", () => {
    const tasks: TaskInput[] = [
      { id: "t1", skill_area_id: 3, competition_module: "M3", max_points: 25, grading_mode: "auto_step" },
      { id: "t2", skill_area_id: 6, competition_module: "M3", max_points: 25, grading_mode: "ai_drawing" },
    ];
    const aspects = [meas("v", "t1", 15), meas("a", "t1", 10), meas("tb", "t2", 10, 6), judg("pres", "t2", 15)];
    const res = scoreAttempt({
      tasks,
      aspects,
      aspectResults: [
        { aspect_id: "v", passed: true, judgement_score: null },
        { aspect_id: "a", passed: true, judgement_score: null },
        { aspect_id: "tb", passed: false, judgement_score: null },
        { aspect_id: "pres", passed: null, judgement_score: 1 },
      ],
      results: [
        { task_id: "t1", status: "auto", submission_id: "s1" },
        { task_id: "t2", status: "final", submission_id: "s2" },
      ],
    });
    expect(res.totalEarned).toBe(30);
    expect(res.totalMax).toBe(50);
    // modelling 100 %, drawing 5/25 = 20 % -> (30*100 + 30*20) / 60 = 60
    expect(res.overall).toBe(60);
    expect(res.band).toBe("developing");
    expect(res.outcome).toBe("graded");
    expect(res.areas.find((a) => a.skillAreaId === 6)?.level).toBe(2);
  });
});

describe("module readiness", () => {
  it("groups by module in M1-M4 order", () => {
    const r = moduleReadiness([unit(3, 5, 10, "M3"), unit(6, 10, 10, "M3"), unit(5, 1, 10, "M4"), unit(3, 9, 10, null)]);
    expect(r.map((m) => m.module)).toEqual(["M3", "M4"]);
    expect(r[0]).toMatchObject({ percent: 75, level: 5 });
    expect(r[1]).toMatchObject({ percent: 10, level: 1 });
  });
  it("is empty when no module is tagged", () => {
    expect(moduleReadiness([unit(3, 5, 10)])).toEqual([]);
  });
});

describe("training path", () => {
  it("ranks assessed areas by weight x (100 - percent)", () => {
    const path = recommendTrainingPath([
      { skillAreaId: 3, weight: 30, percent: 80, assessed: true }, // 600
      { skillAreaId: 6, weight: 30, percent: 35, assessed: true }, // 1950
      { skillAreaId: 4, weight: 10, percent: 0, assessed: true }, // 1000
      { skillAreaId: 5, weight: 15, percent: null, assessed: false },
    ]);
    expect(path.map((p) => p.skillAreaId)).toEqual([6, 4, 3]);
    expect(path[0]).toMatchObject({ priority: 1950, reasonKey: "first" });
    expect(path[1].reasonKey).toBe("next");
  });
  it("calls a high score 'strong'", () => {
    const path = recommendTrainingPath([
      { skillAreaId: 3, weight: 30, percent: 95, assessed: true },
      { skillAreaId: 6, weight: 30, percent: 90, assessed: true },
    ]);
    expect(path.every((p) => p.reasonKey === "strong")).toBe(true);
  });
});

describe("deltaSinceLast", () => {
  it("is the change between the last two scored attempts", () => {
    expect(deltaSinceLast([25, null, 55])).toBe(30);
    expect(deltaSinceLast([88, 55])).toBe(-33);
    expect(deltaSinceLast([55])).toBeNull();
  });
});
