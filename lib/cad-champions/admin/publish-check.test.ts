import { describe, expect, it } from "vitest";

import { defaultRubric } from "../drawing/rubric";
import { exercisePublishChecks, publishChecks, type CheckTask } from "./publish-check";

const REF = { volume_mm3: 1000, area_mm2: 600, principal_moments_mm5: [1, 2, 3] };

function task(over: Partial<CheckTask> = {}): CheckTask {
  return {
    id: "t1",
    position: 1,
    title_en: "Plate",
    title_ar: "لوح",
    brief_en: "Model it",
    brief_ar: "صممه",
    max_points: 10,
    grading_mode: "auto_step",
    expected_upload: "step",
    reference_data: REF,
    rubric: null,
    ...over,
  };
}

const test = { title_en: "Diagnostic", title_ar: "تشخيصي", upload_mode: "per_task", package_expectations: {} };
const codes = (r: { blocking: { code: string }[] }) => r.blocking.map((i) => i.code);

describe("publishChecks", () => {
  it("passes a complete test", () => {
    const r = publishChecks({ test, tasks: [task()], aspects: [{ task_id: "t1", type: "measurement", max_points: 10 }] });
    expect(r.canPublish).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.split.measurement).toBe(10);
  });

  it("blocks a test without tasks or titles", () => {
    const r = publishChecks({ test: { ...test, title_ar: " " }, tasks: [], aspects: [] });
    expect(r.canPublish).toBe(false);
    expect(codes(r)).toEqual(["title_ar", "no_tasks"]);
  });

  it("lists every missing task field with its number", () => {
    const r = publishChecks({
      test,
      tasks: [task(), task({ id: "t2", position: 2, title_ar: "", brief_en: null, max_points: 0, reference_data: { volume_mm3: 5 } })],
      aspects: [{ task_id: "t1", type: "measurement", max_points: 10 }],
    });
    expect(r.blocking).toEqual([
      { code: "task_title_ar", task: 2, taskId: "t2" },
      { code: "task_brief_en", task: 2, taskId: "t2" },
      { code: "task_no_points", task: 2, taskId: "t2" },
      { code: "task_no_reference", task: 2, taskId: "t2" },
    ]);
    expect(r.warnings.map((w) => w.code)).toEqual(["task_no_aspects"]);
  });

  it("needs a rubric or aspects for drawing tasks", () => {
    const bare = publishChecks({ test, tasks: [task({ grading_mode: "ai_drawing", expected_upload: "pdf", reference_data: null })], aspects: [] });
    expect(codes(bare)).toEqual(["task_no_rubric"]);
    const rubric = defaultRubric("part");
    const ok = publishChecks({ test, tasks: [task({ grading_mode: "ai_drawing", reference_data: null, rubric, max_points: 25 })], aspects: [] });
    expect(codes(ok)).toEqual([]);
  });

  it("blocks when aspect points differ from the task points", () => {
    const r = publishChecks({ test, tasks: [task()], aspects: [{ task_id: "t1", type: "measurement", max_points: 8 }] });
    expect(r.blocking).toEqual([{ code: "aspects_points_mismatch", task: 1, taskId: "t1", params: { sum: 8, max: 10 } }]);
  });

  it("warns (never blocks) when judgement is above 20 %", () => {
    const r = publishChecks({
      test,
      tasks: [task()],
      aspects: [
        { task_id: "t1", type: "measurement", max_points: 7 },
        { task_id: "t1", type: "judgement", max_points: 3 },
      ],
    });
    expect(r.canPublish).toBe(true);
    expect(r.warnings).toEqual([{ code: "judgement_high", task: null, taskId: null, params: { percent: 30 } }]);
  });

  it("needs package expectations for module_package tests", () => {
    const pkg = { ...test, upload_mode: "module_package" };
    const none = publishChecks({ test: pkg, tasks: [task()], aspects: [{ task_id: "t1", type: "measurement", max_points: 10 }] });
    expect(codes(none)).toEqual(["no_expectations"]);
    const partial = publishChecks({
      test: { ...pkg, package_expectations: { tasks: { t1: { files: ["Parts and Assemblies/Part_01.*"] } } } },
      tasks: [task(), task({ id: "t2", position: 2 })],
      aspects: [
        { task_id: "t1", type: "measurement", max_points: 10 },
        { task_id: "t2", type: "measurement", max_points: 10 },
      ],
    });
    expect(partial.blocking).toEqual([{ code: "task_no_expectation", task: 2, taskId: "t2" }]);
    const bad = publishChecks({
      test: { ...pkg, package_expectations: { t1: ["Models/Part_01.*"] } },
      tasks: [task()],
      aspects: [{ task_id: "t1", type: "measurement", max_points: 10 }],
    });
    expect(bad.blocking).toEqual([{ code: "bad_expectation", task: 1, taskId: "t1", params: { pattern: "Models/Part_01.*" } }]);
  });
});

describe("exercisePublishChecks", () => {
  const ex = { ...task(), level_id: "l1", pass_mark: 80 };
  it("passes a complete exercise", () => {
    expect(exercisePublishChecks({ exercise: ex, aspects: [] }).canPublish).toBe(true);
  });
  it("blocks a missing level, bad pass mark and missing reference", () => {
    const r = exercisePublishChecks({ exercise: { ...ex, level_id: null, pass_mark: 150, reference_data: null }, aspects: [] });
    expect(codes(r)).toEqual(["no_level", "pass_mark", "task_no_reference"]);
  });
});
