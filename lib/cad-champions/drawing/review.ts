// Trainer review (Prompt 8 Step D). PURE; tested in review.test.ts.
//
// - finalizeRows: the trainer's decisions -> cc_aspect_results rows + scores
//   (measurement all-or-nothing, judgement points = max x score / 3)
// - prefill: what the review screen starts with (AI pass/fail, earlier scores)
// - queue helpers: waiting time, overdue (> 24 h), sort, filters

import { aspectPoints, round2 } from "../scoring/core";
import { JUDGEMENT_MAX } from "../scoring/config";

export const REVIEW_OVERDUE_HOURS = 24;
export const COMMENT_MAX = 2000;

export interface ReviewAspect {
  id: string;
  type: "measurement" | "judgement" | string;
  method: string;
  max_points: number | string;
  partial_rule?: unknown;
}

export interface Decision {
  aspectId: string;
  /** measurement */
  passed?: boolean | null;
  /** judgement 0-3 */
  score?: number | null;
}

export interface FinalizeRow {
  aspect_id: string;
  passed: boolean | null;
  judgement_score: number | null;
  points_awarded: number;
}

export type FinalizeComputation =
  | { ok: true; rows: FinalizeRow[]; finalScore: number; manualScore: number; maxPoints: number }
  | { ok: false; missing: string[] };

function validScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= JUDGEMENT_MAX;
}

/**
 * Every aspect needs a decision: pass/fail for measurement, 0-3 for
 * judgement. manualScore = points of the trainer-method aspects; finalScore =
 * all points (the trainer confirmed the AI items too).
 */
export function finalizeRows(aspects: readonly ReviewAspect[], decisions: readonly Decision[]): FinalizeComputation {
  const byId = new Map(decisions.map((d) => [d.aspectId, d]));
  const missing: string[] = [];
  const rows: FinalizeRow[] = [];
  let finalScore = 0;
  let manualScore = 0;
  let maxPoints = 0;
  for (const a of aspects) {
    const d = byId.get(a.id);
    const judgement = a.type === "judgement";
    if (judgement ? !validScore(d?.score) : typeof d?.passed !== "boolean") {
      missing.push(a.id);
      continue;
    }
    // Trainer decisions are all-or-nothing for measurement (no partial_rule here).
    const points = aspectPoints(
      { type: a.type, max_points: a.max_points, partial_rule: null },
      judgement ? { aspect_id: a.id, passed: null, judgement_score: d!.score! } : { aspect_id: a.id, passed: d!.passed!, judgement_score: null }
    );
    rows.push({ aspect_id: a.id, passed: judgement ? null : d!.passed!, judgement_score: judgement ? d!.score! : null, points_awarded: points });
    finalScore += points;
    if (a.method === "trainer") manualScore += points;
    maxPoints += Math.max(0, Number(a.max_points) || 0);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, rows, finalScore: round2(finalScore), manualScore: round2(manualScore), maxPoints: round2(maxPoints) };
}

/** Starting decision for one aspect from its stored result (AI pass/fail or an earlier review). */
export function prefill(a: ReviewAspect, existing: { passed: boolean | null; judgement_score: number | null } | null | undefined): Decision {
  if (a.type === "judgement") return { aspectId: a.id, score: existing && validScore(existing.judgement_score) ? existing.judgement_score : null };
  return { aspectId: a.id, passed: typeof existing?.passed === "boolean" ? existing.passed : null };
}

export function isDecided(a: Pick<ReviewAspect, "type">, d: Decision | undefined): boolean {
  if (!d) return false;
  return a.type === "judgement" ? validScore(d.score) : typeof d.passed === "boolean";
}

// ─── queue ────────────────────────────────────────────────────────────────

export function waitingHours(submittedAt: string | null, now: number = Date.now()): number | null {
  const t = submittedAt ? Date.parse(submittedAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
}

export function isOverdue(hours: number | null): boolean {
  return hours != null && hours > REVIEW_OVERDUE_HOURS;
}

/** Statuses a trainer reviews: AI drawings, manual tasks with a file, grading errors. */
export function isReviewable(r: { status: string; submission_id: string | null; needs_manual_review?: boolean | null }, gradingMode: string): boolean {
  if (!r.submission_id) return false;
  if (r.status === "ai_pending_review") return true;
  if (r.status === "pending") return gradingMode === "manual" || gradingMode === "ai_drawing";
  if (r.status === "error") return !!r.needs_manual_review;
  return false;
}

export interface QueueRowLike {
  id: string;
  submittedAt: string | null;
  unclear: number;
  aiSkipped: boolean | string | null;
  testId: string;
}

/** Oldest first; filters by test and "unclear only" (unclear/low-confidence items, or the AI could not run). */
export function filterAndSortQueue<T extends QueueRowLike>(rows: readonly T[], f: { testId?: string | null; unclearOnly?: boolean }): T[] {
  return rows
    .filter((r) => !f.testId || r.testId === f.testId)
    .filter((r) => !f.unclearOnly || r.unclear > 0 || !!r.aiSkipped)
    .slice()
    .sort((a, b) => (Date.parse(a.submittedAt ?? "") || 0) - (Date.parse(b.submittedAt ?? "") || 0) || a.id.localeCompare(b.id));
}

/** The next queue item after `currentId` (wraps to the first other item), or null. */
export function nextInQueue(ids: readonly string[], currentId: string): string | null {
  const others = ids.filter((id) => id !== currentId);
  if (others.length === 0) return null;
  const i = ids.indexOf(currentId);
  if (i < 0) return others[0];
  return ids.slice(i + 1).find((id) => id !== currentId) ?? others[0];
}
