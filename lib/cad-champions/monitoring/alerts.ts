// Monitoring alert rules (Prompt 12 Step F). PURE: counts in, alerts out;
// tested in alerts.test.ts. The database reads and the email are in
// alerts-server.ts, called from the cc-payments-expire cron route.
//
// Two alerts:
//   grading_errors  more than GRADING_ERRORS_THRESHOLD failed grading calls
//                   (cc_grading_logs.error not null) in the last hour
//   stale_review    review-queue items (cc_task_results status ai_pending_review
//                   or error) older than STALE_REVIEW_HOURS

export const GRADING_ERRORS_THRESHOLD = 3;
export const GRADING_WINDOW_HOURS = 1;
export const STALE_REVIEW_HOURS = 48;

export type AlertKind = "grading_errors" | "stale_review";

export interface MonitoringCounts {
  /** Grading log rows with an error in the last GRADING_WINDOW_HOURS; null = could not be read. */
  gradingErrorsLastHour: number | null;
  /** created_at (ISO) of every review-queue item still open; null = could not be read. */
  openReviewCreatedAt: string[] | null;
}

export interface MonitoringAlert {
  kind: AlertKind;
  /** Short English line for the email. */
  message: string;
  count: number;
  /** stale_review only: age in whole hours of the oldest stale item. */
  oldestHours?: number;
}

export function evaluateAlerts(counts: MonitoringCounts, now: Date = new Date()): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];

  const errors = counts.gradingErrorsLastHour;
  if (errors !== null && errors > GRADING_ERRORS_THRESHOLD) {
    alerts.push({
      kind: "grading_errors",
      count: errors,
      message: `${errors} grading errors in the last ${GRADING_WINDOW_HOURS} hour (limit ${GRADING_ERRORS_THRESHOLD}). Check the grader service and cc_grading_logs.`,
    });
  }

  if (counts.openReviewCreatedAt) {
    const cutoff = now.getTime() - STALE_REVIEW_HOURS * 3600_000;
    const stale = counts.openReviewCreatedAt.map((s) => Date.parse(s)).filter((t) => Number.isFinite(t) && t < cutoff);
    if (stale.length > 0) {
      const oldestHours = Math.floor((now.getTime() - Math.min(...stale)) / 3600_000);
      alerts.push({
        kind: "stale_review",
        count: stale.length,
        oldestHours,
        message: `${stale.length} review item${stale.length === 1 ? "" : "s"} waiting more than ${STALE_REVIEW_HOURS} hours (oldest: ${oldestHours} h). Open the review queue.`,
      });
    }
  }

  return alerts;
}

/** Resend idempotency key: one email per alert combination per hour bucket (UTC). */
export function alertIdempotencyKey(kinds: AlertKind[], now: Date = new Date()): string {
  return `cc-monitor-${[...kinds].sort().join("+")}-${now.toISOString().slice(0, 13)}`;
}
