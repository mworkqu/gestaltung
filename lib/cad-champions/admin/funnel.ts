// Admin insights: date range + signup funnel by week (Prompt 11 Step E).
// PURE (no I/O): tested in funnel.test.ts. All days are Asia/Qatar days
// (UTC+3, no daylight saving), weeks start on Monday.
//
// Funnel semantics: every step counts the students (of that sign-up week)
// who have the step's journey timestamp. Steps are not forced to be
// sequential (a student may watch the free lesson before the first test), so
// "drop-off" is measured against the previous step and never goes below 0.

import { GET_READY_STEPS, type GetReadyStepKey } from "../get-ready/steps";

const QATAR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 731;
export const DEFAULT_RANGE_WEEKS = 12;

// ─── Qatar days and weeks ─────────────────────────────────────────────────

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The Qatar calendar day (YYYY-MM-DD) of an instant. "" for invalid input. */
export function qatarDay(input: string | number | Date): string {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + QATAR_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((new Date(`${toYmd}T00:00:00Z`).getTime() - new Date(`${fromYmd}T00:00:00Z`).getTime()) / DAY_MS);
}

/** Monday (YYYY-MM-DD) of the week a Qatar day belongs to. */
export function weekStartOfDay(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

/** Monday of the Qatar week an instant falls in. "" for invalid input. */
export function weekStartQatar(input: string | number | Date): string {
  const d = qatarDay(input);
  return d ? weekStartOfDay(d) : "";
}

/** Start of a Qatar day as an ISO instant (UTC). */
export function qatarDayStartIso(ymd: string): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - QATAR_OFFSET_MS).toISOString();
}

export interface InsightRange {
  /** First day, YYYY-MM-DD (Qatar), inclusive. */
  from: string;
  /** Last day, YYYY-MM-DD (Qatar), inclusive. */
  to: string;
  /** Instant the range starts (inclusive). */
  fromIso: string;
  /** Instant the range ends (exclusive: start of the day after `to`). */
  toIso: string;
  isDefault: boolean;
}

/**
 * ?from=&to= (YYYY-MM-DD, Qatar days). Default: the last 12 weeks (this week
 * and the 11 before it) up to today. Bad input falls back to the default; a
 * reversed range is swapped; the span is capped at two years.
 */
export function parseInsightRange(from: unknown, to: unknown, now: Date = new Date()): InsightRange {
  const today = qatarDay(now);
  const defTo = today;
  const defFrom = addDays(weekStartOfDay(today), -7 * (DEFAULT_RANGE_WEEKS - 1));
  let f = isYmd(from) ? from : null;
  let t = isYmd(to) ? to : null;
  const isDefault = f == null && t == null;
  if (f && !t) t = today > f ? today : f;
  if (t && !f) f = addDays(t, -(7 * DEFAULT_RANGE_WEEKS - 1));
  let rf = f ?? defFrom;
  let rt = t ?? defTo;
  if (rf > rt) [rf, rt] = [rt, rf];
  if (daysBetween(rf, rt) > MAX_RANGE_DAYS) rf = addDays(rt, -MAX_RANGE_DAYS);
  return { from: rf, to: rt, fromIso: qatarDayStartIso(rf), toIso: qatarDayStartIso(addDays(rt, 1)), isDefault };
}

// ─── funnel ───────────────────────────────────────────────────────────────

export const FUNNEL_STEPS = ["signed_up", "get_ready", "practice", "test", "results", "free_lesson", "paid"] as const;
export type FunnelStepId = (typeof FUNNEL_STEPS)[number];

/** cc_journey_progress column that marks each step. */
export const FUNNEL_COLUMNS: Record<FunnelStepId, keyof JourneyRow> = {
  signed_up: "created_at",
  get_ready: "get_ready_completed_at",
  practice: "practice_passed_at",
  test: "first_test_submitted_at",
  results: "results_viewed_at",
  free_lesson: "sample_lesson_watched_at",
  paid: "enrolled_at",
};

export interface JourneyRow {
  created_at: string;
  get_ready_completed_at?: string | null;
  practice_passed_at?: string | null;
  first_test_submitted_at?: string | null;
  results_viewed_at?: string | null;
  sample_lesson_watched_at?: string | null;
  enrolled_at?: string | null;
}

export interface FunnelStep {
  id: FunnelStepId;
  count: number;
  /** % lost since the previous step (0-100); null for the first step or when the previous step is empty. */
  dropOffPct: number | null;
  /** % of the students who signed up (0-100); null when nobody signed up. */
  ofSignedUpPct: number | null;
}

export interface FunnelWeek {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  steps: FunnelStep[];
}

export interface FunnelResult {
  weeks: FunnelWeek[];
  totals: FunnelStep[];
  /** Students who signed up in the range. */
  total: number;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function toSteps(counts: readonly number[]): FunnelStep[] {
  return FUNNEL_STEPS.map((id, i) => {
    const prev = i === 0 ? null : counts[i - 1];
    const drop = prev == null || prev <= 0 ? null : Math.max(0, pct(prev - counts[i], prev) ?? 0);
    return { id, count: counts[i], dropOffPct: drop, ofSignedUpPct: pct(counts[i], counts[0]) };
  });
}

/**
 * Funnel by sign-up week. `range` (Qatar days) lists every week of the range
 * (empty weeks included) and ignores rows outside it; without a range only
 * the weeks that have sign-ups are listed.
 */
export function buildFunnel(rows: readonly JourneyRow[], range?: { from: string; to: string }): FunnelResult {
  const byWeek = new Map<string, number[]>();
  const totalCounts: number[] = FUNNEL_STEPS.map(() => 0);
  const ensure = (w: string) => {
    let c = byWeek.get(w);
    if (!c) {
      c = FUNNEL_STEPS.map(() => 0);
      byWeek.set(w, c);
    }
    return c;
  };
  if (range) {
    const last = weekStartOfDay(range.to);
    for (let w = weekStartOfDay(range.from), guard = 0; w <= last && guard < 120; w = addDays(w, 7), guard++) ensure(w);
  }
  for (const r of rows) {
    const day = qatarDay(r.created_at);
    if (!day) continue;
    if (range && (day < range.from || day > range.to)) continue;
    const counts = ensure(weekStartOfDay(day));
    FUNNEL_STEPS.forEach((id, i) => {
      const v = r[FUNNEL_COLUMNS[id]];
      if (typeof v === "string" && v) {
        counts[i] += 1;
        totalCounts[i] += 1;
      }
    });
  }
  const weeks = [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([weekStart, counts]) => ({ weekStart, steps: toSteps(counts) }));
  return { weeks, totals: toSteps(totalCounts), total: totalCounts[0] };
}

// ─── where students stop in Get Ready ─────────────────────────────────────

const REQUIRED_IN_ORDER: readonly GetReadyStepKey[] = GET_READY_STEPS.filter((s) => s.required).map((s) => s.key);

/** The first required step (steps.ts order) not in `done`; null when all required steps are done. */
export function firstMissingRequiredStep(done: Iterable<string>): GetReadyStepKey | null {
  const set = new Set(done);
  return REQUIRED_IN_ORDER.find((k) => !set.has(k)) ?? null;
}

export interface GetReadyStop {
  key: GetReadyStepKey;
  count: number;
}

/**
 * For students who have NOT finished Get Ready: the first required step each
 * one has not done, counted per step (every required step is listed, in step
 * order, even with 0). Checklist sub-item keys ("step__sub") are ignored.
 */
export function getReadyStops(students: readonly { doneKeys: readonly string[] }[]): GetReadyStop[] {
  const counts = new Map<GetReadyStepKey, number>(REQUIRED_IN_ORDER.map((k) => [k, 0]));
  for (const s of students) {
    const k = firstMissingRequiredStep(s.doneKeys.filter((x) => !x.includes("__")));
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return REQUIRED_IN_ORDER.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}
