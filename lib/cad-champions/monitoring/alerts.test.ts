import { describe, expect, it } from "vitest";

import { alertIdempotencyKey, evaluateAlerts } from "./alerts";

const now = new Date("2026-07-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("evaluateAlerts", () => {
  it("is quiet when everything is healthy", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: 3, openReviewCreatedAt: [hoursAgo(47)] }, now)).toEqual([]);
  });
  it("alerts when grading errors exceed 3", () => {
    const a = evaluateAlerts({ gradingErrorsLastHour: 4, openReviewCreatedAt: [] }, now);
    expect(a.map((x) => x.kind)).toEqual(["grading_errors"]);
    expect(a[0].count).toBe(4);
  });
  it("alerts on review items older than 48 h and reports the oldest", () => {
    const a = evaluateAlerts({ gradingErrorsLastHour: 0, openReviewCreatedAt: [hoursAgo(49), hoursAgo(100), hoursAgo(2)] }, now);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "stale_review", count: 2, oldestHours: 100 });
  });
  it("skips a check that could not be read (null) and ignores bad dates", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: null, openReviewCreatedAt: null }, now)).toEqual([]);
    expect(evaluateAlerts({ gradingErrorsLastHour: 0, openReviewCreatedAt: ["not a date"] }, now)).toEqual([]);
  });
  it("can raise both alerts", () => {
    expect(evaluateAlerts({ gradingErrorsLastHour: 9, openReviewCreatedAt: [hoursAgo(60)] }, now)).toHaveLength(2);
  });
});

describe("alertIdempotencyKey", () => {
  it("is stable within an hour and differs across hours", () => {
    const k = alertIdempotencyKey(["stale_review", "grading_errors"], now);
    expect(k).toBe(alertIdempotencyKey(["grading_errors", "stale_review"], new Date("2026-07-10T12:59:00Z")));
    expect(k).not.toBe(alertIdempotencyKey(["grading_errors", "stale_review"], new Date("2026-07-10T13:00:00Z")));
  });
});
