// Scoring math (Prompt 7 Step A, COMPETITION_ALIGNMENT section D). PURE: no
// I/O, no dates. Tested in core.test.ts. computeAttemptScores (server.ts)
// feeds it the rows of one attempt; the results page and the report reuse the
// level / band / readiness / training-path helpers.
//
// Marking by ASPECTS:
//   - measurement: full marks when passed, else 0. Only when the aspect has a
//     partial_rule does the grader's points_awarded count (clamped 0..max).
//   - judgement: trainer score 0-3 -> points = max x score / 3.
// A task without aspects falls back to its task-result score (final, else
// manual, else ai, else auto) out of the task's max points.
// Skill-area totals and the overall percent use the 6 official weights,
// re-normalised over the areas the attempt covered.

import type { CcBand, CcCompetitionModuleCode, CcSkillAreaId } from "../db/types";
import { BAND_THRESHOLDS, JUDGEMENT_MAX, LEVEL_THRESHOLDS, OFFICIAL_WEIGHTS, SKILL_AREA_IDS, type CcLevel } from "./config";

// ─── inputs ────────────────────────────────────────────────────────────────

export interface AspectInput {
  id: string;
  task_id: string | null;
  skill_area_id: number;
  competition_module: string | null;
  type: "measurement" | "judgement" | string;
  max_points: number | string | null;
  /** Staff-only rule; any non-null value means "partial marks allowed". */
  partial_rule?: unknown;
}

export interface AspectResultInput {
  aspect_id: string;
  passed: boolean | null;
  judgement_score: number | null;
  points_awarded?: number | string | null;
}

export interface TaskInput {
  id: string;
  skill_area_id: number;
  competition_module: string | null;
  max_points: number | string | null;
  grading_mode: "auto_step" | "ai_drawing" | "manual" | string;
}

export interface TaskResultInput {
  task_id: string;
  status: "pending" | "auto" | "ai_pending_review" | "final" | "error" | string;
  submission_id: string | null;
  final_score?: number | string | null;
  manual_score?: number | string | null;
  ai_score?: number | string | null;
  auto_score?: number | string | null;
  needs_manual_review?: boolean | null;
}

// ─── helpers ───────────────────────────────────────────────────────────────

export function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function isAreaId(n: number): n is CcSkillAreaId {
  return Number.isInteger(n) && n >= 1 && n <= 6;
}

function isModule(m: unknown): m is CcCompetitionModuleCode {
  return m === "M1" || m === "M2" || m === "M3" || m === "M4";
}

// ─── aspects and tasks ─────────────────────────────────────────────────────

/** Points one aspect earns from its result (0 when there is no result yet). */
export function aspectPoints(aspect: Pick<AspectInput, "type" | "max_points" | "partial_rule">, result: AspectResultInput | null | undefined): number {
  const max = Math.max(0, num(aspect.max_points));
  if (!result || max === 0) return 0;
  if (aspect.type === "judgement") {
    if (result.judgement_score == null) return 0;
    const s = clamp(Math.round(num(result.judgement_score)), 0, JUDGEMENT_MAX);
    return round2((max * s) / JUDGEMENT_MAX);
  }
  // measurement
  const hasPartial = aspect.partial_rule != null;
  if (hasPartial && result.points_awarded != null && Number.isFinite(Number(result.points_awarded))) {
    return round2(clamp(num(result.points_awarded), 0, max));
  }
  return result.passed === true ? max : 0;
}

/** One marked unit: an aspect, or a whole task when it has no aspects. */
export interface ScoreUnit {
  taskId: string;
  aspectId: string | null;
  skillAreaId: CcSkillAreaId;
  module: CcCompetitionModuleCode | null;
  type: "measurement" | "judgement" | "task";
  earned: number;
  max: number;
  /** Judgement aspect still waiting for the trainer's 0-3 score (task has a file). */
  unscored: boolean;
}

export interface TaskScore {
  taskId: string;
  earned: number;
  max: number;
  units: ScoreUnit[];
}

/** A task result's score when the task has no aspects: final > manual > ai > auto. */
function resultScore(r: TaskResultInput | undefined): number | null {
  if (!r) return null;
  for (const v of [r.final_score, r.manual_score, r.ai_score, r.auto_score]) {
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Score of one task from its aspects (or its task result when it has none). */
export function taskScore(
  task: TaskInput,
  aspects: readonly AspectInput[],
  aspectResults: ReadonlyMap<string, AspectResultInput> | readonly AspectResultInput[],
  result?: TaskResultInput
): TaskScore {
  const byAspect = Array.isArray(aspectResults)
    ? new Map((aspectResults as readonly AspectResultInput[]).map((r) => [r.aspect_id, r]))
    : (aspectResults as ReadonlyMap<string, AspectResultInput>);
  const hasFile = !!result?.submission_id;
  const own = aspects.filter((a) => a.task_id === task.id);
  const taskArea = isAreaId(Number(task.skill_area_id)) ? (Number(task.skill_area_id) as CcSkillAreaId) : 3;
  const taskModule = isModule(task.competition_module) ? task.competition_module : null;

  if (own.length === 0) {
    const max = Math.max(0, num(task.max_points));
    const raw = hasFile ? resultScore(result) : 0;
    const earned = round2(clamp(raw ?? 0, 0, max));
    return {
      taskId: task.id,
      earned,
      max,
      units: [{ taskId: task.id, aspectId: null, skillAreaId: taskArea, module: taskModule, type: "task", earned, max, unscored: false }],
    };
  }

  const units: ScoreUnit[] = own.map((a) => {
    const r = hasFile ? byAspect.get(a.id) : undefined;
    const area = isAreaId(Number(a.skill_area_id)) ? (Number(a.skill_area_id) as CcSkillAreaId) : taskArea;
    const mod = isModule(a.competition_module) ? a.competition_module : taskModule;
    const isJudgement = a.type === "judgement";
    return {
      taskId: task.id,
      aspectId: a.id,
      skillAreaId: area,
      module: mod,
      type: isJudgement ? "judgement" : "measurement",
      earned: aspectPoints(a, r),
      max: Math.max(0, num(a.max_points)),
      unscored: isJudgement && hasFile && (r == null || r.judgement_score == null),
    };
  });
  return {
    taskId: task.id,
    earned: round2(units.reduce((s, u) => s + u.earned, 0)),
    max: round2(units.reduce((s, u) => s + u.max, 0)),
    units,
  };
}

// ─── skill areas and overall ───────────────────────────────────────────────

export interface AreaScore {
  skillAreaId: CcSkillAreaId;
  weight: number;
  earned: number;
  max: number;
  /** null when not assessed. */
  percent: number | null;
  level: CcLevel | null;
  assessed: boolean;
}

/** Earned / max per area over the attempt's units (percent null when the area has no marks). */
export function skillAreaPercent(units: readonly ScoreUnit[], areaId: CcSkillAreaId): { earned: number; max: number; percent: number | null } {
  let earned = 0;
  let max = 0;
  for (const u of units) {
    if (u.skillAreaId !== areaId) continue;
    earned += u.earned;
    max += u.max;
  }
  earned = round2(earned);
  max = round2(max);
  return { earned, max, percent: max > 0 ? round2(clamp((earned / max) * 100, 0, 100)) : null };
}

/** All six areas, in id order, with level and assessed flag. */
export function areaScores(units: readonly ScoreUnit[], weights: Partial<Record<number, number>> = OFFICIAL_WEIGHTS): AreaScore[] {
  return SKILL_AREA_IDS.map((id) => {
    const { earned, max, percent } = skillAreaPercent(units, id);
    const weight = num(weights[id] ?? OFFICIAL_WEIGHTS[id]);
    return { skillAreaId: id, weight, earned, max, percent, level: percent == null ? null : levelFor(percent), assessed: percent != null };
  });
}

/**
 * Overall percent: official weights re-normalised over the covered areas
 * (sum(w x p) / sum(w) for areas with marks). Returns the covered area ids.
 */
export function overallPercent(areas: readonly Pick<AreaScore, "skillAreaId" | "weight" | "percent">[]): { percent: number | null; covered: CcSkillAreaId[] } {
  let wSum = 0;
  let acc = 0;
  const covered: CcSkillAreaId[] = [];
  for (const a of areas) {
    if (a.percent == null || !(a.weight > 0)) continue;
    covered.push(a.skillAreaId);
    wSum += a.weight;
    acc += a.weight * a.percent;
  }
  if (wSum === 0) {
    // Covered areas all have weight 0: fall back to an unweighted mean.
    const plain = areas.filter((a) => a.percent != null);
    if (plain.length === 0) return { percent: null, covered: [] };
    return {
      percent: round2(plain.reduce((s, a) => s + (a.percent as number), 0) / plain.length),
      covered: plain.map((a) => a.skillAreaId),
    };
  }
  return { percent: round2(acc / wSum), covered };
}

export function levelFor(percent: number): CcLevel {
  const p = Number.isFinite(percent) ? percent : 0;
  let level: CcLevel = 1;
  for (const t of LEVEL_THRESHOLDS) if (p >= t.min) level = t.level;
  return level;
}

export function bandFor(percent: number): CcBand {
  const p = Number.isFinite(percent) ? percent : 0;
  let band: CcBand = "beginner";
  for (const t of BAND_THRESHOLDS) if (p >= t.min) band = t.band;
  return band;
}

// ─── attempt outcome ───────────────────────────────────────────────────────

export type AttemptOutcome = "grading" | "provisional" | "graded" | "no_files";

/**
 * Where an attempt stands:
 *  - no_files: nothing was uploaded at all;
 *  - grading: an auto-checked file is still waiting for the grader;
 *  - provisional: a trainer still has to confirm something (AI drawing check
 *    waiting for review, a manual task with a file, an unscored judgement
 *    aspect, or a grading error a trainer is checking by hand);
 *  - graded: everything is final.
 */
export function attemptOutcome(tasks: readonly TaskInput[], results: readonly TaskResultInput[], units: readonly ScoreUnit[] = []): AttemptOutcome {
  const byTask = new Map(results.map((r) => [r.task_id, r]));
  const anyFile = results.some((r) => !!r.submission_id);
  if (!anyFile) return "no_files";
  let provisional = false;
  for (const t of tasks) {
    const r = byTask.get(t.id);
    if (!r || !r.submission_id) continue; // no file: 0, final
    if (r.status === "pending") {
      if (t.grading_mode === "auto_step") return "grading";
      provisional = true; // ai_drawing / manual: a trainer confirms
    } else if (r.status === "ai_pending_review") {
      provisional = true;
    } else if (r.status === "error" && r.needs_manual_review) {
      provisional = true;
    }
  }
  if (units.some((u) => u.unscored)) provisional = true;
  return provisional ? "provisional" : "graded";
}

/** True while any task waits for a trainer (Prompt 7: "Provisional"). */
export function isProvisional(tasks: readonly TaskInput[], results: readonly TaskResultInput[], units: readonly ScoreUnit[] = []): boolean {
  return attemptOutcome(tasks, results, units) === "provisional";
}

// ─── whole attempt ─────────────────────────────────────────────────────────

export interface AttemptScores {
  tasks: TaskScore[];
  units: ScoreUnit[];
  areas: AreaScore[];
  overall: number | null;
  covered: CcSkillAreaId[];
  band: CcBand | null;
  totalEarned: number;
  totalMax: number;
  outcome: AttemptOutcome;
}

export function scoreAttempt(input: {
  tasks: readonly TaskInput[];
  aspects: readonly AspectInput[];
  aspectResults: readonly (AspectResultInput & { task_result_task_id?: string })[];
  results: readonly TaskResultInput[];
  weights?: Partial<Record<number, number>>;
}): AttemptScores {
  const byTask = new Map(input.results.map((r) => [r.task_id, r]));
  const byAspect = new Map(input.aspectResults.map((r) => [r.aspect_id, r]));
  const tasks = input.tasks.map((t) => taskScore(t, input.aspects, byAspect, byTask.get(t.id)));
  const units = tasks.flatMap((t) => t.units);
  const areas = areaScores(units, input.weights);
  const { percent, covered } = overallPercent(areas);
  return {
    tasks,
    units,
    areas,
    overall: percent,
    covered,
    band: percent == null ? null : bandFor(percent),
    totalEarned: round2(tasks.reduce((s, t) => s + t.earned, 0)),
    totalMax: round2(tasks.reduce((s, t) => s + t.max, 0)),
    outcome: attemptOutcome(input.tasks, input.results, units),
  };
}

// ─── competition module readiness ──────────────────────────────────────────

export interface ModuleReadiness {
  module: CcCompetitionModuleCode;
  earned: number;
  max: number;
  percent: number;
  level: CcLevel;
}

/** Per competition module the attempt covered (M1-M4 order): percent + level. */
export function moduleReadiness(units: readonly ScoreUnit[]): ModuleReadiness[] {
  const acc = new Map<CcCompetitionModuleCode, { earned: number; max: number }>();
  for (const u of units) {
    if (!u.module || !(u.max > 0)) continue;
    const cur = acc.get(u.module) ?? { earned: 0, max: 0 };
    cur.earned += u.earned;
    cur.max += u.max;
    acc.set(u.module, cur);
  }
  return (["M1", "M2", "M3", "M4"] as const)
    .filter((m) => acc.has(m))
    .map((m) => {
      const { earned, max } = acc.get(m)!;
      const percent = round2(clamp((earned / max) * 100, 0, 100));
      return { module: m, earned: round2(earned), max: round2(max), percent, level: levelFor(percent) };
    });
}

// ─── training path ─────────────────────────────────────────────────────────

export type PathReason = "first" | "next" | "strong";

export interface PathStep {
  skillAreaId: CcSkillAreaId;
  weight: number;
  percent: number;
  /** weight x (100 - percent): bigger = more marks to gain. */
  priority: number;
  /** Message key under CC.results.path.reason (values: area, weight, percent). */
  reasonKey: PathReason;
}

/** Assessed areas ranked by weight x (100 - percent), with a reason sentence key. */
export function recommendTrainingPath(areas: readonly Pick<AreaScore, "skillAreaId" | "weight" | "percent" | "assessed">[]): PathStep[] {
  const ranked = areas
    .filter((a) => a.assessed && a.percent != null)
    .map((a) => ({
      skillAreaId: a.skillAreaId,
      weight: a.weight,
      percent: a.percent as number,
      priority: round2(a.weight * (100 - (a.percent as number))),
    }))
    .sort((x, y) => y.priority - x.priority || y.weight - x.weight || x.skillAreaId - y.skillAreaId);
  return ranked.map((s, i) => ({
    ...s,
    reasonKey: s.percent >= 85 ? "strong" : i === 0 ? "first" : "next",
  }));
}

/** Progress chart: change since the previous scored attempt (null when fewer than two). */
export function deltaSinceLast(percents: readonly (number | null)[]): number | null {
  const scored = percents.filter((p): p is number => p != null && Number.isFinite(p));
  if (scored.length < 2) return null;
  return round2(scored[scored.length - 1] - scored[scored.length - 2]);
}
