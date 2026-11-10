// Admin insights: pure aggregations (Prompt 11 Step E). No I/O, no names:
// everything here works on numbers and short labels, so the same data can
// feed the admin page and the anonymised pilot report. Tested in
// insights.test.ts. The database reads are insights-server.ts.

import { graderErrorInfo, isGraderErrorCode } from "../grader/error-codes";
import type { FunnelResult, GetReadyStop } from "./funnel";

// ─── small helpers ────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
}

// ─── skills ───────────────────────────────────────────────────────────────

export interface SkillAverage {
  skillAreaId: number;
  /** Average percent (0-100, one decimal) or null when nobody was assessed. */
  average: number | null;
  samples: number;
  /** The lowest average (only marked when at least two areas have data). */
  weakest: boolean;
}

export function skillAverages(
  rows: readonly { skill_area_id: number; percent: number | string | null; assessed?: boolean | null }[],
  areaIds: readonly number[] = [1, 2, 3, 4, 5, 6],
): SkillAverage[] {
  const acc = new Map<number, number[]>(areaIds.map((id) => [id, []]));
  for (const r of rows) {
    if (r.assessed === false) continue;
    const p = num(r.percent);
    const list = acc.get(Number(r.skill_area_id));
    if (p != null && list) list.push(Math.min(100, Math.max(0, p)));
  }
  const out: SkillAverage[] = areaIds.map((id) => {
    const xs = acc.get(id) ?? [];
    const m = mean(xs);
    return { skillAreaId: id, average: m == null ? null : round1(m), samples: xs.length, weakest: false };
  });
  const withData = out.filter((s) => s.average != null);
  if (withData.length >= 2) {
    const low = withData.reduce((a, b) => ((b.average as number) < (a.average as number) ? b : a));
    low.weakest = true;
  }
  return out;
}

// ─── competition module readiness ─────────────────────────────────────────

export interface ModuleAverage {
  module: "M1" | "M2" | "M3" | "M4";
  /** Attempts that had marks in this module. */
  attempts: number;
  /** Average of the per-attempt percents (0-100, one decimal), null with no attempts. */
  average: number | null;
  /** Points earned / available, summed over the attempts. */
  earned: number;
  max: number;
}

const MODULES = ["M1", "M2", "M3", "M4"] as const;

/** Averages the per-attempt moduleReadiness() output (scoring/core.ts) over many attempts. */
export function moduleAverages(perAttempt: readonly (readonly { module: string; earned: number; max: number; percent: number }[])[]): ModuleAverage[] {
  return MODULES.map((m) => {
    const hits = perAttempt.flatMap((a) => a.filter((x) => x.module === m && x.max > 0));
    const avg = mean(hits.map((h) => h.percent));
    return {
      module: m,
      attempts: hits.length,
      average: avg == null ? null : round1(avg),
      earned: round1(hits.reduce((s, h) => s + h.earned, 0)),
      max: round1(hits.reduce((s, h) => s + h.max, 0)),
    };
  });
}

// ─── improvement ──────────────────────────────────────────────────────────

export interface ImprovementStats {
  /** Students with 2+ graded attempts. */
  students: number;
  /** Of those, how many scored higher the latest time. */
  improved: number;
  averageFirst: number | null;
  averageLatest: number | null;
  /** latest - first, in percentage points (one decimal), may be negative. */
  averageGain: number | null;
}

export function improvementStats(attempts: readonly { userId: string; percent: number | string | null; at: string }[]): ImprovementStats {
  const byUser = new Map<string, { percent: number; at: number }[]>();
  for (const a of attempts) {
    const p = num(a.percent);
    const t = new Date(a.at).getTime();
    if (p == null || Number.isNaN(t)) continue;
    const list = byUser.get(a.userId) ?? [];
    list.push({ percent: p, at: t });
    byUser.set(a.userId, list);
  }
  const firsts: number[] = [];
  const lasts: number[] = [];
  let improved = 0;
  for (const list of byUser.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at - b.at);
    const first = list[0].percent;
    const last = list[list.length - 1].percent;
    firsts.push(first);
    lasts.push(last);
    if (last > first) improved += 1;
  }
  const f = mean(firsts);
  const l = mean(lasts);
  return {
    students: firsts.length,
    improved,
    averageFirst: f == null ? null : round1(f),
    averageLatest: l == null ? null : round1(l),
    averageGain: f == null || l == null ? null : round1(l - f),
  };
}

// ─── students per institution / study level ──────────────────────────────

export interface Distribution {
  /** Largest first. */
  items: { label: string; count: number }[];
  /** Students with no value. */
  unknown: number;
  total: number;
}

/** Counts values case-insensitively (the first spelling seen is the label). */
export function distribution(values: readonly (string | null | undefined)[]): Distribution {
  const map = new Map<string, { label: string; count: number }>();
  let unknown = 0;
  for (const v of values) {
    const label = (v ?? "").trim().replace(/\s+/g, " ");
    if (!label) {
      unknown += 1;
      continue;
    }
    const key = label.toLowerCase();
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { label, count: 1 });
  }
  const items = [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { items, unknown, total: values.length };
}

// ─── grading health ───────────────────────────────────────────────────────

export interface ErrorRate {
  code: string;
  count: number;
  /** % of all grader runs in the range (0-100, one decimal). */
  ratePct: number | null;
  /** Help Center article that explains the fix, when the code is known. */
  helpSlug: string | null;
}

export interface GradingSummary {
  /** Grader runs (kind "step") that finished without an error. */
  autoGraded: number;
  /** Grader runs that ended in an error. */
  failed: number;
  totalRuns: number;
  /** Average duration of finished runs, in milliseconds. */
  avgDurationMs: number | null;
  errors: ErrorRate[];
}

export function summariseGrading(
  stepLogs: readonly { duration_ms: number | string | null; error_code?: string | null; error?: string | null }[],
): GradingSummary {
  let ok = 0;
  const durations: number[] = [];
  const codes = new Map<string, number>();
  for (const l of stepLogs) {
    const code = (l.error_code ?? "").trim();
    const failed = !!code || !!(l.error ?? "").trim();
    if (failed) {
      const key = code || "unknown";
      codes.set(key, (codes.get(key) ?? 0) + 1);
    } else {
      ok += 1;
      const d = num(l.duration_ms);
      if (d != null && d >= 0) durations.push(d);
    }
  }
  const total = stepLogs.length;
  const errors: ErrorRate[] = [...codes.entries()]
    .map(([code, count]) => ({
      code,
      count,
      ratePct: total > 0 ? round1((count / total) * 100) : null,
      helpSlug: isGraderErrorCode(code) ? graderErrorInfo(code, "en").helpSlug : null,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const avg = mean(durations);
  return { autoGraded: ok, failed: total - ok, totalRuns: total, avgDurationMs: avg == null ? null : Math.round(avg), errors };
}

export interface AiUsageSummary {
  /** ai_drawing + ai_translate calls. */
  checks: number;
  drawing: number;
  translate: number;
  /** Estimated cost in USD. */
  costUsd: number;
}

export function summariseAiUsage(logs: readonly { kind: string; cost_estimate: number | string | null }[]): AiUsageSummary {
  let drawing = 0;
  let translate = 0;
  let cost = 0;
  for (const l of logs) {
    if (l.kind === "ai_drawing") drawing += 1;
    else if (l.kind === "ai_translate") translate += 1;
    else continue;
    cost += num(l.cost_estimate) ?? 0;
  }
  return { checks: drawing + translate, drawing, translate, costUsd: Math.round(cost * 10000) / 10000 };
}

/** Average hours between a task result being created and a trainer grading it. */
export function averageReviewHours(rows: readonly { created_at: string; graded_at: string | null }[]): { count: number; avgHours: number | null } {
  const hours: number[] = [];
  for (const r of rows) {
    if (!r.graded_at) continue;
    const h = (new Date(r.graded_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) hours.push(h);
  }
  const m = mean(hours);
  return { count: hours.length, avgHours: m == null ? null : round1(m) };
}

// ─── the whole page ───────────────────────────────────────────────────────

export interface GradingHealth {
  grading: GradingSummary;
  ai: AiUsageSummary;
  /** First day of the month counted for AI usage (Qatar, YYYY-MM-DD). */
  aiMonthStart: string;
  /** Drawings and manual tasks waiting for a trainer (null = could not load). */
  backlog: number | null;
  reviewed: number;
  avgReviewHours: number | null;
}

/**
 * Everything the Insights page and the pilot report show. A section is null
 * when it could not be loaded, so one failing query never blanks the page.
 * Contains NO names: institutions are labels only for the admin page
 * (pilot-report.ts reduces them to anonymous counts).
 */
export interface InsightsData {
  range: { from: string; to: string };
  students: number | null;
  funnel: FunnelResult | null;
  /** Students who did not finish Get Ready and are counted below. */
  stuckInGetReady: number | null;
  getReadyStops: GetReadyStop[] | null;
  skills: SkillAverage[] | null;
  /** Diagnostic attempts the skill averages came from. */
  skillAttempts: number;
  modules: ModuleAverage[] | null;
  /** Graded attempts the module readiness came from. */
  moduleAttempts: number;
  improvement: ImprovementStats | null;
  institutions: Distribution | null;
  studyLevels: Distribution | null;
  health: GradingHealth | null;
}
