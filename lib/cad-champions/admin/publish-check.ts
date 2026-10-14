// What blocks publishing a test or an exercise (Prompt 11 Step B: "Publishing
// is blocked with a clear list of what's missing"). PURE; tested in
// publish-check.test.ts. The server action re-runs it before publishing.

import { parseRubric } from "../drawing/rubric";
import { isReferenceComplete } from "../grader/mapping";
import { aspectSplit, pointsMatch, sumAspectPoints, type AspectSplit } from "./aspects";
import { invalidStoredPatterns, tasksWithExpectations } from "./package-expectations";

export type PublishIssueCode =
  | "no_tasks"
  | "title_en"
  | "title_ar"
  | "task_title_en"
  | "task_title_ar"
  | "task_brief_en"
  | "task_brief_ar"
  | "task_no_points"
  | "task_no_reference"
  | "task_no_rubric"
  | "aspects_points_mismatch"
  | "no_expectations"
  | "task_no_expectation"
  | "bad_expectation"
  | "judgement_high"
  | "task_no_aspects"
  | "no_level"
  | "pass_mark";

export interface PublishIssue {
  code: PublishIssueCode;
  /** 1-based task number in test order (null for test-level issues). */
  task: number | null;
  taskId: string | null;
  params?: Record<string, string | number>;
}

export interface CheckTask {
  id: string;
  position: number;
  title_en: string | null;
  title_ar: string | null;
  brief_en: string | null;
  brief_ar: string | null;
  max_points: number | string | null;
  grading_mode: string;
  expected_upload: string;
  reference_data: unknown;
  rubric: unknown;
}

export interface CheckAspect {
  task_id: string | null;
  type: string;
  max_points: number | string | null;
}

export interface CheckTest {
  title_en: string | null;
  title_ar: string | null;
  upload_mode: string;
  package_expectations: unknown;
}

export interface PublishCheckResult {
  canPublish: boolean;
  blocking: PublishIssue[];
  warnings: PublishIssue[];
  split: AspectSplit;
}

const blank = (s: string | null | undefined) => !s || !String(s).trim();

function rubricItemCount(json: unknown): number {
  return parseRubric(json)?.items.length ?? 0;
}

/** Checks shared by test tasks and exercises. */
function gradableIssues(t: CheckTask, aspects: readonly CheckAspect[], task: number | null, taskId: string | null, out: { blocking: PublishIssue[]; warnings: PublishIssue[] }) {
  const at = (code: PublishIssueCode, params?: PublishIssue["params"]): PublishIssue => ({ code, task, taskId, ...(params ? { params } : {}) });
  if (blank(t.title_en)) out.blocking.push(at("task_title_en"));
  if (blank(t.title_ar)) out.blocking.push(at("task_title_ar"));
  if (blank(t.brief_en)) out.blocking.push(at("task_brief_en"));
  if (blank(t.brief_ar)) out.blocking.push(at("task_brief_ar"));
  const max = Number(t.max_points) || 0;
  if (max <= 0) out.blocking.push(at("task_no_points"));
  if (t.grading_mode === "auto_step" && !isReferenceComplete(t.reference_data)) out.blocking.push(at("task_no_reference"));
  if (t.grading_mode === "ai_drawing" && rubricItemCount(t.rubric) === 0 && aspects.length === 0) out.blocking.push(at("task_no_rubric"));
  if (aspects.length > 0 && max > 0 && !pointsMatch(aspects, max)) {
    out.blocking.push(at("aspects_points_mismatch", { sum: sumAspectPoints(aspects), max: Math.round(max * 100) / 100 }));
  }
  if (aspects.length === 0 && t.grading_mode !== "manual" && t.grading_mode !== "ai_drawing") out.warnings.push(at("task_no_aspects"));
}

export function publishChecks(input: { test: CheckTest; tasks: readonly CheckTask[]; aspects: readonly CheckAspect[] }): PublishCheckResult {
  const out = { blocking: [] as PublishIssue[], warnings: [] as PublishIssue[] };
  const { test } = input;
  if (blank(test.title_en)) out.blocking.push({ code: "title_en", task: null, taskId: null });
  if (blank(test.title_ar)) out.blocking.push({ code: "title_ar", task: null, taskId: null });

  const tasks = [...input.tasks].sort((a, b) => a.position - b.position);
  if (tasks.length === 0) out.blocking.push({ code: "no_tasks", task: null, taskId: null });

  const byTask = new Map<string, CheckAspect[]>();
  for (const a of input.aspects) {
    if (!a.task_id) continue;
    const list = byTask.get(a.task_id) ?? [];
    list.push(a);
    byTask.set(a.task_id, list);
  }

  tasks.forEach((t, i) => gradableIssues(t, byTask.get(t.id) ?? [], i + 1, t.id, out));

  if (test.upload_mode === "module_package") {
    const withExp = tasksWithExpectations(test.package_expectations);
    const known = new Set(tasks.map((t) => t.id));
    if (![...withExp].some((id) => known.has(id))) {
      out.blocking.push({ code: "no_expectations", task: null, taskId: null });
    } else {
      tasks.forEach((t, i) => {
        if (t.expected_upload !== "none" && t.grading_mode !== "manual" && !withExp.has(t.id)) out.blocking.push({ code: "task_no_expectation", task: i + 1, taskId: t.id });
      });
    }
    const number = new Map(tasks.map((t, i) => [t.id, i + 1]));
    for (const bad of invalidStoredPatterns(test.package_expectations)) {
      if (!known.has(bad.taskId)) continue;
      out.blocking.push({ code: "bad_expectation", task: number.get(bad.taskId) ?? null, taskId: bad.taskId, params: { pattern: bad.pattern } });
    }
  }

  const relevant = input.aspects.filter((a) => a.task_id && byTask.has(a.task_id) && tasks.some((t) => t.id === a.task_id));
  const split = aspectSplit(relevant);
  if (split.judgementTooHigh) out.warnings.push({ code: "judgement_high", task: null, taskId: null, params: { percent: split.judgementPercent } });

  return { canPublish: out.blocking.length === 0, blocking: out.blocking, warnings: out.warnings, split };
}

export interface CheckExercise extends Omit<CheckTask, "position"> {
  level_id: string | null;
  pass_mark: number | string | null;
}

export function exercisePublishChecks(input: { exercise: CheckExercise; aspects: readonly Omit<CheckAspect, "task_id">[] }): PublishCheckResult {
  const out = { blocking: [] as PublishIssue[], warnings: [] as PublishIssue[] };
  const ex = input.exercise;
  if (!ex.level_id) out.blocking.push({ code: "no_level", task: null, taskId: null });
  const pm = Number(ex.pass_mark);
  if (!Number.isFinite(pm) || pm < 0 || pm > 100) out.blocking.push({ code: "pass_mark", task: null, taskId: null });
  const aspects = input.aspects.map((a) => ({ ...a, task_id: ex.id }));
  gradableIssues({ ...ex, position: 1 }, aspects, null, null, out);
  const split = aspectSplit(aspects);
  if (split.judgementTooHigh) out.warnings.push({ code: "judgement_high", task: null, taskId: null, params: { percent: split.judgementPercent } });
  return { canPublish: out.blocking.length === 0, blocking: out.blocking, warnings: out.warnings, split };
}
