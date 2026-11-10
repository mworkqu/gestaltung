import { describe, expect, it } from "vitest";

import {
  addDays,
  buildFunnel,
  firstMissingRequiredStep,
  getReadyStops,
  isYmd,
  parseInsightRange,
  qatarDay,
  qatarDayStartIso,
  weekStartOfDay,
  weekStartQatar,
} from "./funnel";

describe("qatar days and weeks", () => {
  it("uses UTC+3 for the calendar day", () => {
    // 22:00 UTC on Sunday is already Monday 01:00 in Qatar.
    expect(qatarDay("2026-10-11T22:00:00Z")).toBe("2026-10-12");
    expect(qatarDay("2026-10-11T20:59:00Z")).toBe("2026-10-11");
    expect(qatarDay("nope")).toBe("");
  });

  it("starts weeks on Monday", () => {
    expect(weekStartOfDay("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStartOfDay("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekStartOfDay("2026-10-19")).toBe("2026-10-19");
    expect(weekStartQatar("2026-10-11T22:00:00Z")).toBe("2026-10-12");
    expect(weekStartQatar("2026-10-11T20:00:00Z")).toBe("2026-10-05");
  });

  it("adds days and checks dates", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-02-28")).toBe(true);
    expect(qatarDayStartIso("2026-10-12")).toBe("2026-10-11T21:00:00.000Z");
  });
});

describe("parseInsightRange", () => {
  const now = new Date("2026-10-14T09:00:00Z"); // Wednesday

  it("defaults to the last 12 weeks, from a Monday", () => {
    const r = parseInsightRange(undefined, undefined, now);
    expect(r.isDefault).toBe(true);
    expect(r.to).toBe("2026-10-14");
    expect(r.from).toBe("2026-07-27"); // Monday 11 weeks before 2026-10-12
    expect(weekStartOfDay(r.from)).toBe(r.from);
  });

  it("accepts a valid range and builds Qatar-day instants", () => {
    const r = parseInsightRange("2026-09-01", "2026-09-30", now);
    expect(r.isDefault).toBe(false);
    expect(r.fromIso).toBe("2026-08-31T21:00:00.000Z");
    expect(r.toIso).toBe("2026-09-30T21:00:00.000Z");
  });

  it("swaps a reversed range and ignores bad input", () => {
    const r = parseInsightRange("2026-09-30", "2026-09-01", now);
    expect(r.from).toBe("2026-09-01");
    expect(r.to).toBe("2026-09-30");
    expect(parseInsightRange("garbage", "also bad", now).isDefault).toBe(true);
  });

  it("caps the span at about two years", () => {
    const r = parseInsightRange("2000-01-01", "2026-10-01", now);
    expect(r.from > "2024-01-01").toBe(true);
  });
});

describe("buildFunnel", () => {
  const rows = [
    // week of 2026-10-05 (Qatar): 3 sign-ups
    { created_at: "2026-10-06T08:00:00Z", get_ready_completed_at: "2026-10-07T08:00:00Z", practice_passed_at: "2026-10-07T09:00:00Z", first_test_submitted_at: "2026-10-08T09:00:00Z", results_viewed_at: "2026-10-08T10:00:00Z", sample_lesson_watched_at: null, enrolled_at: "2026-10-09T10:00:00Z" },
    { created_at: "2026-10-07T08:00:00Z", get_ready_completed_at: "2026-10-08T08:00:00Z" },
    { created_at: "2026-10-11T20:00:00Z" }, // Sunday evening Qatar, still week of 10-05
    // next week
    { created_at: "2026-10-11T22:00:00Z", get_ready_completed_at: "2026-10-12T08:00:00Z" }, // Monday 01:00 Qatar
    // outside the range
    { created_at: "2026-01-01T00:00:00Z" },
  ];

  it("counts steps per sign-up week and in total", () => {
    const f = buildFunnel(rows, { from: "2026-10-05", to: "2026-10-18" });
    expect(f.weeks.map((w) => w.weekStart)).toEqual(["2026-10-05", "2026-10-12"]);
    const w1 = f.weeks[0].steps.map((s) => s.count);
    expect(w1).toEqual([3, 2, 1, 1, 1, 0, 1]);
    expect(f.weeks[1].steps.map((s) => s.count)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(f.totals.map((s) => s.count)).toEqual([4, 3, 1, 1, 1, 0, 1]);
    expect(f.total).toBe(4);
  });

  it("computes drop-off against the previous step", () => {
    const f = buildFunnel(rows, { from: "2026-10-05", to: "2026-10-18" });
    const t = f.totals;
    expect(t[0].dropOffPct).toBeNull();
    expect(t[1].dropOffPct).toBe(25); // 4 -> 3
    expect(t[2].dropOffPct).toBeCloseTo(66.7, 1); // 3 -> 1
    expect(t[3].dropOffPct).toBe(0);
    expect(t[5].dropOffPct).toBe(100); // 1 -> 0
    expect(t[6].dropOffPct).toBeNull(); // previous step empty
    expect(t[1].ofSignedUpPct).toBe(75);
  });

  it("never reports negative drop-off", () => {
    // 1 test submitted, 2 viewed results (one of them skipped the test step)
    const g = buildFunnel([
      { created_at: "2026-10-06T08:00:00Z", first_test_submitted_at: "2026-10-07T08:00:00Z", results_viewed_at: "2026-10-07T09:00:00Z" },
      { created_at: "2026-10-06T08:00:00Z", results_viewed_at: "2026-10-07T08:00:00Z" },
    ]);
    expect(g.totals[3].count).toBe(1);
    expect(g.totals[4].count).toBe(2);
    expect(g.totals[4].dropOffPct).toBe(0);
  });

  it("lists empty weeks inside the range and handles no rows", () => {
    const f = buildFunnel([], { from: "2026-10-05", to: "2026-10-25" });
    expect(f.weeks).toHaveLength(3);
    expect(f.total).toBe(0);
    expect(f.totals[1].ofSignedUpPct).toBeNull();
    expect(buildFunnel([]).weeks).toEqual([]);
  });
});

describe("Get Ready stops", () => {
  it("finds the first required step not done", () => {
    expect(firstMissingRequiredStep([])).toBe("welcome_video");
    expect(firstMissingRequiredStep(["welcome_video"])).toBe("check_computer");
    expect(firstMissingRequiredStep(["welcome_video", "check_computer"])).toBe("install_software");
  });

  it("counts per step, in order, ignoring sub-item keys", () => {
    const stops = getReadyStops([
      { doneKeys: [] },
      { doneKeys: [] },
      { doneKeys: ["welcome_video", "check_computer__ram"] },
      { doneKeys: ["welcome_video", "check_computer"] },
    ]);
    const byKey = Object.fromEntries(stops.map((s) => [s.key, s.count]));
    expect(byKey.welcome_video).toBe(2);
    expect(byKey.check_computer).toBe(1);
    expect(byKey.install_software).toBe(1);
    expect(stops[0].key).toBe("welcome_video");
    expect(stops.some((s) => s.key === "essential_actions")).toBe(true);
    expect(stops.some((s) => s.key === "try_test_screen")).toBe(false); // optional step
  });
});
