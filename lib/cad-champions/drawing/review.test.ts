import { describe, expect, it } from "vitest";

import { filterAndSortQueue, finalizeRows, isOverdue, isReviewable, nextInQueue, prefill, waitingHours } from "./review";

const ASPECTS = [
  { id: "a", type: "measurement", method: "ai_drawing", max_points: 2 },
  { id: "b", type: "measurement", method: "trainer", max_points: 3, partial_rule: { any: 1 } },
  { id: "j", type: "judgement", method: "trainer", max_points: 1.5 },
];

describe("finalizeRows", () => {
  it("scores measurement all-or-nothing and judgement max x score / 3", () => {
    const r = finalizeRows(ASPECTS, [
      { aspectId: "a", passed: true },
      { aspectId: "b", passed: false },
      { aspectId: "j", score: 2 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { aspect_id: "a", passed: true, judgement_score: null, points_awarded: 2 },
      { aspect_id: "b", passed: false, judgement_score: null, points_awarded: 0 },
      { aspect_id: "j", passed: null, judgement_score: 2, points_awarded: 1 },
    ]);
    expect(r.finalScore).toBe(3);
    expect(r.manualScore).toBe(1);
    expect(r.maxPoints).toBe(6.5);
  });

  it("refuses when an item is not decided or a score is out of range", () => {
    const r = finalizeRows(ASPECTS, [{ aspectId: "a", passed: true }, { aspectId: "b", passed: null }, { aspectId: "j", score: 4 }]);
    expect(r).toEqual({ ok: false, missing: ["b", "j"] });
  });

  it("prefills from AI results and earlier scores", () => {
    expect(prefill(ASPECTS[0], { passed: true, judgement_score: null })).toEqual({ aspectId: "a", passed: true });
    expect(prefill(ASPECTS[0], { passed: null, judgement_score: null })).toEqual({ aspectId: "a", passed: null });
    expect(prefill(ASPECTS[2], { passed: null, judgement_score: 3 })).toEqual({ aspectId: "j", score: 3 });
    expect(prefill(ASPECTS[2], null)).toEqual({ aspectId: "j", score: null });
  });
});

describe("queue", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("waiting time and the 24 h colour", () => {
    expect(waitingHours("2026-10-13T11:00:00Z", now)).toBe(25);
    expect(isOverdue(25)).toBe(true);
    expect(isOverdue(23.9)).toBe(false);
    expect(waitingHours(null, now)).toBeNull();
  });

  it("reviewable rows", () => {
    expect(isReviewable({ status: "ai_pending_review", submission_id: "s" }, "ai_drawing")).toBe(true);
    expect(isReviewable({ status: "ai_pending_review", submission_id: null }, "ai_drawing")).toBe(false);
    expect(isReviewable({ status: "pending", submission_id: "s" }, "manual")).toBe(true);
    expect(isReviewable({ status: "pending", submission_id: "s" }, "auto_step")).toBe(false);
    expect(isReviewable({ status: "error", submission_id: "s", needs_manual_review: true }, "auto_step")).toBe(true);
    expect(isReviewable({ status: "final", submission_id: "s" }, "ai_drawing")).toBe(false);
  });

  it("filters and sorts oldest first", () => {
    const rows = [
      { id: "1", submittedAt: "2026-10-14T10:00:00Z", unclear: 0, aiSkipped: false, testId: "t1" },
      { id: "2", submittedAt: "2026-10-12T10:00:00Z", unclear: 1, aiSkipped: false, testId: "t2" },
      { id: "3", submittedAt: "2026-10-13T10:00:00Z", unclear: 0, aiSkipped: true, testId: "t1" },
    ];
    expect(filterAndSortQueue(rows, {}).map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(filterAndSortQueue(rows, { testId: "t1" }).map((r) => r.id)).toEqual(["3", "1"]);
    expect(filterAndSortQueue(rows, { unclearOnly: true }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(nextInQueue(["2", "3", "1"], "3")).toBe("1");
    expect(nextInQueue(["2", "3", "1"], "1")).toBe("2");
    expect(nextInQueue(["2"], "2")).toBeNull();
    expect(nextInQueue(["2", "3"], "x")).toBe("2");
  });
});
