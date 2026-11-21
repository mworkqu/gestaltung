// Monitoring alert rules (Prompt 12 Step F). PURE: counts in, alerts out;
// tested in alerts.test.ts. The database reads and the email are in
// alerts-server.ts, called from the cc-payments-expire cron route.
//
// Two alerts:
//   grading_errors  more than GRADING_ERRORS_THRESHOLD failed grading calls
//                   (cc_grading_logs.error not null) in the last hour
//   stale_review    review-queue items (cc_task_results status ai_pending_review
//                   or error) older than STALE_REVIEW_HOURS
//
// Flood control (2026-11). The cron runs hourly, so the old "one key per hour
// bucket" meant one email an hour for the same unattended review item, each
// with a different age in the subject line. Now every alert carries its OWN
// idempotency key built from the DIGEST DAY and a fingerprint of WHAT it is
// about, never from the hour or the count:
//   stale_review    day + the sorted ids of the stale items -> at most one
//                   email a day for the same set, and one more at once when
//                   the set changes (an item added or cleared)
//   grading_errors  day + the sorted distinct error signatures -> the check
//                   stays hourly, but the same failure reports once a day
// The digest day starts at DIGEST_HOUR_QATAR, so a set that simply persists is
// re-reported each morning at that hour (Asia/Qatar) rather than at midnight
// UTC. Resend drops a repeat send with the same key (lib/email.ts).

export const GRADING_ERRORS_THRESHOLD = 3;
export const GRADING_WINDOW_HOURS = 1;
export const STALE_REVIEW_HOURS = 48;

/** Asia/Qatar is UTC+3 all year (no daylight saving). */
const QATAR_OFFSET_HOURS = 3;
/** Qatar wall-clock hour the daily digest goes out (and the day bucket flips). */
export const DIGEST_HOUR_QATAR = 9;

/** How many stale items the email lists by name before "and N more". */
export const MAX_LISTED_ITEMS = 10;

export type AlertKind = "grading_errors" | "stale_review";

/** One open review-queue row, as alerts-server.ts reads it. */
export interface ReviewQueueItem {
  /** cc_task_results.id — also the /admin/review/<id> path segment. */
  id: string;
  createdAt: string;
  /** Student's name (or email), when the profile could be read. */
  studentName?: string | null;
  /** The task that was submitted. */
  taskTitle?: string | null;
}

export interface MonitoringCounts {
  /** Grading log rows with an error in the last GRADING_WINDOW_HOURS; null = could not be read. */
  gradingErrorsLastHour: number | null;
  /** Distinct error texts behind that count (de-dupe fingerprint; empty = unknown). */
  gradingErrorSignatures?: readonly string[];
  /** Every review-queue item still open; null = could not be read. */
  openReviewItems: readonly ReviewQueueItem[] | null;
}

/** A stale item with its age and its deep link, ready for the email. */
export interface StaleReviewItem extends ReviewQueueItem {
  waitingHours: number;
}

export interface MonitoringAlert {
  kind: AlertKind;
  /** Short English line for the email. */
  message: string;
  count: number;
  /** stale_review only: age in whole hours of the oldest stale item. */
  oldestHours?: number;
  /** stale_review only: the stale items, oldest first. */
  items?: StaleReviewItem[];
  /**
   * Resend Idempotency-Key for this alert's email: digest day + what the alert
   * is about. Repeats inside the same day with the same subject matter carry
   * the same key and are not sent again.
   */
  idempotencyKey: string;
}

/**
 * The digest day an instant belongs to: the Qatar date, with the boundary
 * moved to DIGEST_HOUR_QATAR. 08:59 Qatar still belongs to the previous day,
 * 09:00 starts a new one — so the first hourly run at or after 09:00 Qatar is
 * the one that sends the day's digest.
 */
export function digestDay(now: Date = new Date()): string {
  const shifted = now.getTime() - (DIGEST_HOUR_QATAR - QATAR_OFFSET_HOURS) * 3600_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** FNV-1a (32-bit) as 8 hex chars: a short, stable fingerprint for a key. */
function fingerprint(parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const s of parts.join("\u0000")) {
    h ^= s.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** `cc-monitor-stale-2026-11-21-2-1a2b3c4d` — day + how many + which items. */
export function staleReviewKey(ids: readonly string[], now: Date = new Date()): string {
  const sorted = [...ids].sort();
  return `cc-monitor-stale-${digestDay(now)}-${sorted.length}-${fingerprint(sorted)}`;
}

/** `cc-monitor-grading-2026-11-21-1a2b3c4d` — day + which errors (never the count). */
export function gradingErrorsKey(signatures: readonly string[], now: Date = new Date()): string {
  const sorted = [...new Set(signatures.map((s) => s.trim()).filter(Boolean))].sort();
  return `cc-monitor-grading-${digestDay(now)}-${fingerprint(sorted.length ? sorted : ["unknown"])}`;
}

export function evaluateAlerts(counts: MonitoringCounts, now: Date = new Date()): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];

  const errors = counts.gradingErrorsLastHour;
  if (errors !== null && errors > GRADING_ERRORS_THRESHOLD) {
    alerts.push({
      kind: "grading_errors",
      count: errors,
      message: `${errors} grading errors in the last ${GRADING_WINDOW_HOURS} hour (limit ${GRADING_ERRORS_THRESHOLD}). Check the grader service and cc_grading_logs.`,
      idempotencyKey: gradingErrorsKey(counts.gradingErrorSignatures ?? [], now),
    });
  }

  if (counts.openReviewItems) {
    const cutoff = now.getTime() - STALE_REVIEW_HOURS * 3600_000;
    const stale: StaleReviewItem[] = [];
    for (const item of counts.openReviewItems) {
      const t = Date.parse(item.createdAt);
      if (!Number.isFinite(t) || t >= cutoff) continue;
      stale.push({ ...item, waitingHours: Math.floor((now.getTime() - t) / 3600_000) });
    }
    if (stale.length > 0) {
      stale.sort((a, b) => b.waitingHours - a.waitingHours);
      const oldestHours = stale[0].waitingHours;
      alerts.push({
        kind: "stale_review",
        count: stale.length,
        oldestHours,
        items: stale,
        message: `${stale.length} review item${stale.length === 1 ? "" : "s"} waiting more than ${STALE_REVIEW_HOURS} hours (oldest: ${oldestHours} h). Open the review queue.`,
        idempotencyKey: staleReviewKey(stale.map((s) => s.id), now),
      });
    }
  }

  return alerts;
}

/** Deep link to one review item: /cad-champions/en/admin/review/<id>. */
export function reviewItemUrl(siteUrl: string, id: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/cad-champions/en/admin/review/${encodeURIComponent(id)}`;
}

/** Link to the whole queue. */
export function reviewQueueUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/cad-champions/en/admin/review`;
}

/** Email subject for one alert (no counts or ages: they would defeat the de-dupe). */
export function alertSubject(alert: MonitoringAlert): string {
  return alert.kind === "grading_errors"
    ? "CAD Champions alert: grading errors"
    : "CAD Champions alert: review queue";
}
