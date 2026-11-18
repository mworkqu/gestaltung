// Admin student detail (Prompt 11 Step D) — pure helpers: the journey
// timeline, the per-exercise summary and the enrollment extension plan.
// No I/O; the DB read is student-detail-server.ts and the writes are the
// server actions in app/[locale]/cad-champions/admin/students/actions.ts.

import type { CcJourneyProgress } from "../db/types";
import { GET_READY_STEP_KEYS } from "../get-ready/steps";

const DAY = 24 * 60 * 60 * 1000;
const time = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

// ------------------------------------------------------------------ journey

/** Journey columns shown on the timeline, in the order they normally happen. */
export const JOURNEY_TIMELINE_KEYS = [
  "profile_completed_at",
  "get_ready_completed_at",
  "practice_passed_at",
  "first_test_submitted_at",
  "results_viewed_at",
  "sample_lesson_watched_at",
  "enrolled_at",
] as const satisfies readonly (keyof CcJourneyProgress)[];
export type JourneyTimelineKey = (typeof JOURNEY_TIMELINE_KEYS)[number];

export type TimelineEvent =
  | { kind: "signed_up"; at: string }
  | { kind: "journey"; key: JourneyTimelineKey; at: string }
  | { kind: "get_ready_step"; step: string; at: string };

/**
 * Every dated journey event, oldest first: sign-up, each journey stamp that
 * is set and each Get Ready step done. Ties keep the natural order
 * (sign-up, steps, then journey stamps in JOURNEY_TIMELINE_KEYS order).
 */
export function buildJourneyTimeline(input: {
  createdAt: string | null;
  journey: Partial<Pick<CcJourneyProgress, JourneyTimelineKey>> | null;
  steps: readonly { step_key: string; completed_at: string }[];
}): TimelineEvent[] {
  const events: { e: TimelineEvent; t: number; order: number }[] = [];
  let order = 0;
  const created = time(input.createdAt);
  if (created != null) events.push({ e: { kind: "signed_up", at: input.createdAt! }, t: created, order: order++ });
  const stepRank = (k: string) => {
    const i = (GET_READY_STEP_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? GET_READY_STEP_KEYS.length : i;
  };
  for (const s of [...input.steps].sort((a, b) => stepRank(a.step_key) - stepRank(b.step_key))) {
    const t = time(s.completed_at);
    if (t != null) events.push({ e: { kind: "get_ready_step", step: s.step_key, at: s.completed_at }, t, order: order++ });
  }
  for (const key of JOURNEY_TIMELINE_KEYS) {
    const at = input.journey?.[key] ?? null;
    const t = time(at);
    if (t != null && at) events.push({ e: { kind: "journey", key, at }, t, order: order++ });
  }
  return events.sort((a, b) => a.t - b.t || a.order - b.order).map((x) => x.e);
}

// ------------------------------------------------------------------ exercises

export interface ExerciseAttemptLite {
  exercise_id: string;
  status: string;
  percent: number | null;
  passed: boolean | null;
  created_at: string;
}

export interface ExerciseSummary {
  exerciseId: string;
  attempts: number;
  bestPercent: number | null;
  passed: boolean;
  lastAt: string;
  lastStatus: string;
}

/** One line per exercise the student tried: attempts, best %, passed (ever), last try. Newest first. */
export function summariseExercises(rows: readonly ExerciseAttemptLite[]): ExerciseSummary[] {
  const by = new Map<string, ExerciseSummary>();
  for (const r of rows) {
    const cur = by.get(r.exercise_id);
    const pct = typeof r.percent === "number" && Number.isFinite(r.percent) ? r.percent : null;
    if (!cur) {
      by.set(r.exercise_id, { exerciseId: r.exercise_id, attempts: 1, bestPercent: pct, passed: r.passed === true, lastAt: r.created_at, lastStatus: r.status });
      continue;
    }
    cur.attempts += 1;
    if (pct != null && (cur.bestPercent == null || pct > cur.bestPercent)) cur.bestPercent = pct;
    if (r.passed === true) cur.passed = true;
    if ((time(r.created_at) ?? 0) > (time(cur.lastAt) ?? 0)) {
      cur.lastAt = r.created_at;
      cur.lastStatus = r.status;
    }
  }
  return [...by.values()].sort((a, b) => (time(b.lastAt) ?? 0) - (time(a.lastAt) ?? 0) || a.exerciseId.localeCompare(b.exerciseId));
}

// ------------------------------------------------------------------ enrollment

export const EXTEND_DAYS_MIN = 1;
export const EXTEND_DAYS_MAX = 365;

/** Whole days 1..365 from a form value, else null. */
export function parseExtendDays(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return n >= EXTEND_DAYS_MIN && n <= EXTEND_DAYS_MAX ? n : null;
}

export interface EnrollmentLite {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

export type ExtendPlan =
  /** Add the days to this active enrollment (the one ending last). */
  | { kind: "extend"; enrollmentId: string; fromEndsAt: string; endsAt: string }
  /** No active enrollment: create an admin one from now. */
  | { kind: "create"; startsAt: string; endsAt: string };

/**
 * What "extend enrollment by N days" does: the active enrollment that ends
 * last (and has not ended yet) gets N more days; with none, a new admin
 * enrollment runs from now for N days.
 */
export function planEnrollmentExtension(enrollments: readonly EnrollmentLite[], days: number, now: number): ExtendPlan {
  let best: EnrollmentLite | null = null;
  for (const e of enrollments) {
    const end = time(e.ends_at);
    if (e.status !== "active" || end == null || end <= now) continue;
    if (!best || end > (time(best.ends_at) ?? 0)) best = e;
  }
  if (best) {
    const end = time(best.ends_at)!;
    return { kind: "extend", enrollmentId: best.id, fromEndsAt: best.ends_at, endsAt: new Date(end + days * DAY).toISOString() };
  }
  return { kind: "create", startsAt: new Date(now).toISOString(), endsAt: new Date(now + days * DAY).toISOString() };
}

/** The active enrollment end shown on the profile (latest future end), or null. */
export function activeEnrollmentEnd(enrollments: readonly EnrollmentLite[], now: number): string | null {
  const p = planEnrollmentExtension(enrollments, 0, now);
  return p.kind === "extend" ? p.fromEndsAt : null;
}

// ------------------------------------------------------------------ notes

export const NOTE_MAX = 4000;

/** Trimmed note text (1..4000 chars), else null. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\r\n/g, "\n").trim();
  return s.length >= 1 && s.length <= NOTE_MAX ? s : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
