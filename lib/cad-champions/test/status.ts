// Test flow states (Prompt 5). Pure: no I/O. Tested in status.test.ts.
//
// - introState: what the intro page offers (continue / cooldown / locked / start)
// - acceptsWork / submitReasonFor: server rules for uploads and submits
// - liveTaskState: the per-task line on the "Test submitted" screen
// - tasksWithoutFiles: names for the submit confirmation

import type { CcAttemptStatus, CcGradingMode, CcResultStatus, CcTestType } from "../db/types";
import type { GetReadyGateReason } from "../get-ready/steps";
import { DEFAULT_GRACE_SECONDS, isPastDeadline, isPastGrace, parseTime, retakeAvailableAt, secondsUntil } from "./timer";

export interface AttemptLite {
  id: string;
  status: CcAttemptStatus | string;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
}

export type IntroState =
  /** An attempt is running: "Continue your test - 47 minutes left" (null = untimed). */
  | { kind: "continue"; attemptId: string; secondsLeft: number | null }
  /** Within the retake cooldown after the last attempt. */
  | { kind: "cooldown"; retakeAt: number; last: AttemptLite }
  /** Get Ready not finished (or no profile). */
  | { kind: "locked"; reason: GetReadyGateReason; remaining: number }
  /** May start; `last` is the previous finished attempt, if any. */
  | { kind: "start"; last: AttemptLite | null };

export interface IntroInput {
  attempts: readonly AttemptLite[];
  testType: CcTestType | string;
  cooldownDays: number;
  graceSeconds?: number;
  gate: { ready: boolean; reasonKey: GetReadyGateReason; remaining: number };
  /** Staff may start any test (testing), Get Ready does not apply. */
  isStaff?: boolean;
  now: number;
}

function newestFirst(attempts: readonly AttemptLite[]): AttemptLite[] {
  return [...attempts].sort((a, b) => (parseTime(b.started_at) ?? 0) - (parseTime(a.started_at) ?? 0));
}

/** True when an in-progress attempt is still open (not past deadline + grace). */
export function isOpenAttempt(a: AttemptLite, now: number, graceSeconds: number = DEFAULT_GRACE_SECONDS): boolean {
  return a.status === "in_progress" && !isPastGrace(now, parseTime(a.deadline_at), graceSeconds);
}

/** The moment an attempt ended (for the cooldown): submit time, else deadline, else start. */
export function attemptEndedAt(a: AttemptLite): number | null {
  return parseTime(a.submitted_at) ?? parseTime(a.deadline_at) ?? parseTime(a.started_at);
}

export function introState(input: IntroInput): IntroState {
  const { testType, cooldownDays, gate, isStaff = false, now } = input;
  const grace = input.graceSeconds ?? DEFAULT_GRACE_SECONDS;
  const sorted = newestFirst(input.attempts);

  const open = sorted.find((a) => isOpenAttempt(a, now, grace));
  if (open) {
    const deadline = parseTime(open.deadline_at);
    return { kind: "continue", attemptId: open.id, secondsLeft: deadline == null ? null : secondsUntil(deadline, now) };
  }

  const last = sorted[0] ?? null;
  if (last) {
    const retakeAt = retakeAvailableAt(attemptEndedAt(last), cooldownDays);
    if (retakeAt != null && now < retakeAt) return { kind: "cooldown", retakeAt, last };
  }

  if (testType !== "practice" && !isStaff && !gate.ready) {
    return { kind: "locked", reason: gate.reasonKey, remaining: gate.remaining };
  }
  return { kind: "start", last };
}

/** Uploads and submits are accepted while the attempt is in progress and not past deadline + grace. */
export function acceptsWork(
  attempt: { status: string; deadline_at: string | null },
  now: number,
  graceSeconds: number = DEFAULT_GRACE_SECONDS
): boolean {
  return attempt.status === "in_progress" && !isPastGrace(now, parseTime(attempt.deadline_at), graceSeconds);
}

/** "timeout" once the deadline has passed (also within the grace period), else "manual". */
export function submitReasonFor(now: number, deadlineIso: string | null): "manual" | "timeout" {
  return isPastDeadline(now, parseTime(deadlineIso)) ? "timeout" : "manual";
}

export type LiveTaskState = "no_file" | "checking" | "done" | "waiting_trainer" | "error";

/** One task's line on the "Test submitted" screen. */
export function liveTaskState(input: {
  hasFile: boolean;
  resultStatus: CcResultStatus | string | null | undefined;
  gradingMode: CcGradingMode | string;
}): LiveTaskState {
  if (!input.hasFile) return "no_file";
  switch (input.resultStatus) {
    case "auto":
    case "final":
      return "done";
    case "ai_pending_review":
      return "waiting_trainer";
    case "error":
      return "error";
    default:
      return input.gradingMode === "manual" ? "waiting_trainer" : "checking";
  }
}

/** True when nothing is still being checked (polling can stop). */
export function allSettled(states: readonly LiveTaskState[]): boolean {
  return states.every((s) => s !== "checking");
}

/** Tasks (in order) that have no uploaded file. */
export function tasksWithoutFiles<T extends { id: string; position: number }>(tasks: readonly T[], uploadedTaskIds: Iterable<string>): T[] {
  const have = new Set(uploadedTaskIds);
  return [...tasks].sort((a, b) => a.position - b.position).filter((t) => !have.has(t.id));
}

export type TaskChip = "not_started" | "uploading" | "uploaded" | "failed";

/** Status chip in the task navigation. A failed save shows "failed" even when an older file exists. */
export function taskChip(input: { uploaded: boolean; busy: boolean; failed: boolean }): TaskChip {
  if (input.busy) return "uploading";
  if (input.failed) return "failed";
  return input.uploaded ? "uploaded" : "not_started";
}

/** Attempt statuses that mean "handed in". */
export function isFinishedStatus(status: string): boolean {
  return status === "submitted" || status === "grading" || status === "provisional" || status === "graded" || status === "expired";
}
