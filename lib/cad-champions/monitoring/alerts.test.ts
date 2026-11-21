import { describe, expect, it } from "vitest";

import {
  alertSubject,
  digestDay,
  evaluateAlerts,
  gradingErrorsKey,
  reviewItemUrl,
  reviewQueueUrl,
  staleReviewKey,
  type MonitoringCounts,
} from "./alerts";

const now = new Date("2026-07-10T12:00:00Z");
const hoursAgo = (h: number, from: Date = now) => new Date(from.getTime() - h * 3600_000).toISOString();
const item = (id: string, h: number, extra: Record<string, unknown> = {}) => ({ id, createdAt: hoursAgo(h), ...extra });

describe("evaluateAlerts", () => {
  it("is quiet when everything is healthy", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: 3, openReviewItems: [item("a", 47)] }, now)).toEqual([]);
  });
  it("alerts when grading errors exceed 3", () => {
    const a = evaluateAlerts({ gradingErrorsLastHour: 4, openReviewItems: [] }, now);
    expect(a.map((x) => x.kind)).toEqual(["grading_errors"]);
    expect(a[0].count).toBe(4);
  });
  it("alerts on review items older than 48 h and reports the oldest", () => {
    const a = evaluateAlerts(
      { gradingErrorsLastHour: 0, openReviewItems: [item("a", 49), item("b", 100), item("c", 2)] },
      now
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "stale_review", count: 2, oldestHours: 100 });
    // Oldest first, and only the stale ones.
    expect(a[0].items?.map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("carries the student and task names through for the email", () => {
    const a = evaluateAlerts(
      { gradingErrorsLastHour: 0, openReviewItems: [item("r1", 60, { studentName: "Sara N.", taskTitle: "Bracket drawing" })] },
      now
    );
    expect(a[0].items?.[0]).toMatchObject({ id: "r1", studentName: "Sara N.", taskTitle: "Bracket drawing", waitingHours: 60 });
  });
  it("skips a check that could not be read (null) and ignores bad dates", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: null, openReviewItems: null }, now)).toEqual([]);
    expect(evaluateAlerts({ gradingErrorsLastHour: 0, openReviewItems: [{ id: "x", createdAt: "not a date" }] }, now)).toEqual([]);
  });
  it("can raise both alerts", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: 9, openReviewItems: [item("a", 60)] }, now)).toHaveLength(2);
  });
});

// The cron runs hourly. Resend drops a send whose Idempotency-Key it has
// already seen (lib/email.ts), so "an email goes out" = "this run produced a
// key that has not been sent yet". That is what these three cases check.
describe("stale_review flood control", () => {
  const sent = new Set<string>();
  const run = (counts: MonitoringCounts, at: Date): string[] => {
    const fresh: string[] = [];
    for (const a of evaluateAlerts(counts, at)) {
      if (sent.has(a.idempotencyKey)) continue;
      sent.add(a.idempotencyKey);
      fresh.push(a.kind);
    }
    return fresh;
  };
  // 10 Jul 2026, 12:00 UTC = 15:00 Qatar: inside the digest day that began at
  // 09:00 Qatar the same morning.
  const stale = (at: Date, ids: string[]): MonitoringCounts => ({
    gradingErrorsLastHour: 0,
    openReviewItems: ids.map((id) => ({ id, createdAt: hoursAgo(60, at) })),
  });

  it("emails once, stays quiet the next hours, digests again the next day, and reacts to a change", () => {
    // First run with one stale item: one email.
    expect(run(stale(now, ["r1"]), now)).toEqual(["stale_review"]);
    // Same item an hour later, and three hours later: nothing.
    expect(run(stale(now, ["r1"]), new Date("2026-07-10T13:00:00Z"))).toEqual([]);
    expect(run(stale(now, ["r1"]), new Date("2026-07-10T15:00:00Z"))).toEqual([]);
    // A second item appears the same day: that is news.
    expect(run(stale(now, ["r1", "r2"]), new Date("2026-07-10T16:00:00Z"))).toEqual(["stale_review"]);
    // ...and then stays quiet again.
    expect(run(stale(now, ["r2", "r1"]), new Date("2026-07-10T17:00:00Z"))).toEqual([]);
    // One is cleared: also news.
    expect(run(stale(now, ["r2"]), new Date("2026-07-10T18:00:00Z"))).toEqual(["stale_review"]);
    // Next day, same single item: exactly one digest, at the 09:00 Qatar flip
    // (06:00 UTC), and nothing for the rest of that day.
    const next = new Date("2026-07-11T06:00:00Z");
    expect(run(stale(next, ["r2"]), next)).toEqual(["stale_review"]);
    expect(run(stale(next, ["r2"]), new Date("2026-07-11T07:00:00Z"))).toEqual([]);
    expect(run(stale(next, ["r2"]), new Date("2026-07-11T23:00:00Z"))).toEqual([]);
  });

  it("holds the previous day until 09:00 Qatar", () => {
    // 05:59 UTC = 08:59 Qatar: still the 10 Jul digest day.
    expect(digestDay(new Date("2026-07-11T05:59:00Z"))).toBe("2026-07-10");
    expect(digestDay(new Date("2026-07-11T06:00:00Z"))).toBe("2026-07-11");
  });

  it("keys on which items, not how long they have waited", () => {
    const a = evaluateAlerts(stale(now, ["r1"]), now)[0];
    const later = new Date("2026-07-10T20:00:00Z");
    const b = evaluateAlerts(stale(now, ["r1"]), later)[0];
    expect(b.oldestHours).toBeGreaterThan(a.oldestHours!);
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    // The subject carries no age or count either.
    expect(alertSubject(b)).toBe(alertSubject(a));
    expect(alertSubject(b)).toBe("CAD Champions alert: review queue");
  });

  it("ignores the order the ids come in", () => {
    expect(staleReviewKey(["b", "a"], now)).toBe(staleReviewKey(["a", "b"], now));
    expect(staleReviewKey(["a"], now)).not.toBe(staleReviewKey(["a", "b"], now));
  });
});

describe("grading_errors de-dupe", () => {
  it("is one key per day per error signature, whatever the count", () => {
    const k = gradingErrorsKey(["grader timeout"], now);
    expect(gradingErrorsKey(["grader timeout"], new Date("2026-07-10T20:00:00Z"))).toBe(k);
    expect(gradingErrorsKey(["grader timeout", "grader timeout"], now)).toBe(k);
    expect(gradingErrorsKey(["upload rejected"], now)).not.toBe(k);
    // Next digest day: reported again.
    expect(gradingErrorsKey(["grader timeout"], new Date("2026-07-11T06:00:00Z"))).not.toBe(k);
  });
  it("still raises the alert hourly, so a new failure is seen at once", () => {
    const a = evaluateAlerts({ gradingErrorsLastHour: 7, gradingErrorSignatures: ["grader timeout"], openReviewItems: [] }, now)[0];
    const b = evaluateAlerts({ gradingErrorsLastHour: 7, gradingErrorSignatures: ["zip unreadable"], openReviewItems: [] }, now)[0];
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(alertSubject(a)).toBe("CAD Champions alert: grading errors");
  });
});

describe("links", () => {
  it("point at the review screen and the queue", () => {
    expect(reviewItemUrl("https://gestaltung360.com/", "abc-1")).toBe("https://gestaltung360.com/cad-champions/en/admin/review/abc-1");
    expect(reviewQueueUrl("https://gestaltung360.com")).toBe("https://gestaltung360.com/cad-champions/en/admin/review");
  });
});
