// Test timer math (Prompt 5 Step B). Pure: no DOM, no I/O. Tested in timer.test.ts.
//
// The deadline lives on the server (cc_attempts.deadline_at = started_at +
// time limit). The browser only displays it: it estimates the offset between
// its clock and the server clock (GET /api/cad-champions/time) and counts
// down to the server deadline. Uploads that finish within the grace period
// (cc_tests.grace_seconds, default 60 s) after the deadline are still accepted.

import { formatCountdown } from "../journey/test-status";

export { formatCountdown };

/** Default grace period after the deadline (seconds). */
export const DEFAULT_GRACE_SECONDS = 60;

/** Uploads within this many seconds of the attempt start are flagged "too fast" (admin only). */
export const TOO_FAST_SECONDS = 60;

/** M4 in-person sessions: the physical part is collected 2 hours after the start. */
export const PART_COLLECTED_AFTER_MINUTES = 120;
export const PART_COLLECTED_KEY = "part_collected";

/** Deadline in ms since epoch, or null for an untimed test. */
export function deadlineFrom(startedAtMs: number, timeLimitMinutes: number | null | undefined): number | null {
  if (!Number.isFinite(startedAtMs)) return null;
  if (timeLimitMinutes == null || !Number.isFinite(timeLimitMinutes) || timeLimitMinutes <= 0) return null;
  return startedAtMs + timeLimitMinutes * 60_000;
}

/** Parses an ISO timestamp; NaN-safe (returns null). */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The last moment an upload or a submit still counts: deadline + grace. */
export function graceEndsAt(deadlineMs: number, graceSeconds: number = DEFAULT_GRACE_SECONDS): number {
  return deadlineMs + Math.max(0, graceSeconds) * 1000;
}

/** True when `now` is past deadline + grace (the attempt must be closed with reason "timeout"). */
export function isPastGrace(now: number, deadlineMs: number | null, graceSeconds: number = DEFAULT_GRACE_SECONDS): boolean {
  if (deadlineMs == null) return false;
  return now > graceEndsAt(deadlineMs, graceSeconds);
}

/** True when the deadline has passed (grace not counted). */
export function isPastDeadline(now: number, deadlineMs: number | null): boolean {
  return deadlineMs != null && now >= deadlineMs;
}

/** Whole seconds left until the deadline, never negative. */
export function secondsUntil(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

/** Whole minutes left (rounded up), for "Continue your test - 47 minutes left". */
export function minutesUntil(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 60_000));
}

export type TimerWarning = "none" | "warning" | "urgent" | "critical" | "over";

/**
 * Visual level for the remaining time:
 * - warning: 15 minutes or less (banner)
 * - urgent: 5 minutes or less (toast + banner)
 * - critical: 1 minute or less (red pulse)
 * - over: time is up
 */
export function warningLevel(secondsLeft: number): TimerWarning {
  if (secondsLeft <= 0) return "over";
  if (secondsLeft <= 60) return "critical";
  if (secondsLeft <= 5 * 60) return "urgent";
  if (secondsLeft <= 15 * 60) return "warning";
  return "none";
}

export const WARNING_THRESHOLDS = [15 * 60, 5 * 60, 60] as const;
export type WarningThreshold = (typeof WARNING_THRESHOLDS)[number];

/**
 * The threshold (seconds) crossed between two readings, for one-time
 * notices. Returns the smallest threshold crossed, or null. A first reading
 * (prev = null) never counts as a crossing, so reloading the page with 4
 * minutes left does not toast again.
 */
export function crossedThreshold(prevSecondsLeft: number | null, nextSecondsLeft: number): WarningThreshold | null {
  if (prevSecondsLeft == null) return null;
  let crossed: WarningThreshold | null = null;
  for (const th of WARNING_THRESHOLDS) {
    if (prevSecondsLeft > th && nextSecondsLeft <= th) crossed = th;
  }
  return crossed;
}

/**
 * Server clock minus browser clock (ms), from one round trip: the server time
 * is assumed to be read half-way between sending and receiving.
 */
export function clockOffset(input: { serverNow: number; sentAt: number; receivedAt: number }): number {
  const { serverNow, sentAt, receivedAt } = input;
  if (![serverNow, sentAt, receivedAt].every(Number.isFinite) || receivedAt < sentAt) return 0;
  return Math.round(serverNow - (sentAt + receivedAt) / 2);
}

/** When the M4 "physical part collected" marker is due (ms), or null without a start time. */
export function partCollectedDueAt(startedAtMs: number | null): number | null {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return null;
  return startedAtMs + PART_COLLECTED_AFTER_MINUTES * 60_000;
}

/** Elapsed time since the start, in whole seconds (never negative). */
export function secondsSince(startedAtMs: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAtMs) / 1000));
}

/** Retake date: last attempt time + cooldown days. Null when there is no cooldown. */
export function retakeAvailableAt(lastAttemptMs: number | null, cooldownDays: number): number | null {
  if (lastAttemptMs == null || !Number.isFinite(lastAttemptMs) || !(cooldownDays > 0)) return null;
  return lastAttemptMs + cooldownDays * 86_400_000;
}
