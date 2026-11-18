// Edge cases for deadline / retake logic around Asia/Qatar midnight (UTC+3, no DST).
import { describe, expect, it } from "vitest";

import { formatDateTime } from "../format";
import { attemptEndedAt, introState, isOpenAttempt, type AttemptLite } from "./status";
import { crossedThreshold, deadlineFrom, graceEndsAt, minutesUntil, retakeAvailableAt, secondsUntil, warningLevel } from "./timer";

const iso = (ms: number) => new Date(ms).toISOString();

describe("deadline across Qatar midnight", () => {
  it("a 90 minute test started at 23:00 Qatar ends after midnight Qatar", () => {
    const start = Date.parse("2026-10-14T20:00:00Z"); // 23:00 Qatar, 14 Oct
    const deadline = deadlineFrom(start, 90)!;
    expect(iso(deadline)).toBe("2026-10-14T21:30:00.000Z");
    expect(formatDateTime(deadline, "en")).toContain("October 15, 2026");
    expect(formatDateTime(deadline, "en")).toContain("00:30");
    expect(iso(graceEndsAt(deadline))).toBe("2026-10-14T21:31:00.000Z");
  });
  it("is a pure duration across a year end", () => {
    const start = Date.parse("2026-12-31T20:30:00Z"); // 23:30 Qatar, 31 Dec
    const deadline = deadlineFrom(start, 60)!;
    expect(iso(deadline)).toBe("2026-12-31T21:30:00.000Z");
    expect(formatDateTime(deadline, "en")).toContain("January 1, 2027");
  });
  it("fractional minutes and a 24 hour limit", () => {
    expect(deadlineFrom(0, 0.5)).toBe(30_000);
    expect(deadlineFrom(0, 24 * 60)).toBe(86_400_000);
  });
  it("negative, infinite and missing limits are untimed", () => {
    expect(deadlineFrom(0, -5)).toBeNull();
    expect(deadlineFrom(0, Number.POSITIVE_INFINITY)).toBeNull();
    expect(deadlineFrom(0, undefined)).toBeNull();
  });
});

describe("grace edge cases", () => {
  it("negative grace is treated as 0", () => {
    expect(graceEndsAt(1000, -30)).toBe(1000);
  });
  it("a custom grace changes the boundary", () => {
    expect(graceEndsAt(1000, 120)).toBe(121_000);
  });
});

describe("countdown rounding", () => {
  it("secondsUntil rounds up so the display never shows 0 while time remains", () => {
    expect(secondsUntil(1001, 1000)).toBe(1);
    expect(secondsUntil(1000, 1000)).toBe(0);
    expect(secondsUntil(1999, 1000)).toBe(1);
    expect(secondsUntil(2001, 1000)).toBe(2);
  });
  it("minutesUntil rounds up", () => {
    expect(minutesUntil(1, 0)).toBe(1);
    expect(minutesUntil(60_000, 0)).toBe(1);
    expect(minutesUntil(60_001, 0)).toBe(2);
    expect(minutesUntil(0, 5)).toBe(0);
  });
  it("warning levels at the exact second edges", () => {
    expect(warningLevel(-5)).toBe("over");
    expect(warningLevel(900)).toBe("warning");
    expect(warningLevel(901)).toBe("none");
    expect(warningLevel(300)).toBe("urgent");
    expect(warningLevel(301)).toBe("warning");
    expect(warningLevel(61)).toBe("urgent");
  });
  it("counting down second by second fires each threshold exactly once", () => {
    const fired: number[] = [];
    let prev: number | null = null;
    for (let s = 1000; s >= 0; s--) {
      const c = crossedThreshold(prev, s);
      if (c != null) fired.push(c);
      prev = s;
    }
    expect(fired).toEqual([900, 300, 60]);
  });
  it("a jump straight to over reports the smallest threshold; nothing going backwards", () => {
    expect(crossedThreshold(2000, 0)).toBe(60);
    expect(crossedThreshold(10, 2000)).toBeNull();
    expect(crossedThreshold(50, 40)).toBeNull();
  });
});

describe("retake cooldown across Qatar day boundaries", () => {
  it("is exactly cooldownDays x 24 h after the last attempt (fixed duration)", () => {
    const last = Date.parse("2026-10-14T20:59:00Z"); // 23:59 Qatar
    const at = retakeAvailableAt(last, 14)!;
    expect(iso(at)).toBe("2026-10-28T20:59:00.000Z");
    expect(formatDateTime(at, "en")).toContain("October 28, 2026");
    const lastAfter = Date.parse("2026-10-14T21:01:00Z"); // 00:01 Qatar next day
    expect(formatDateTime(retakeAvailableAt(lastAfter, 14)!, "en")).toContain("October 29, 2026");
  });
  it("fractional days and invalid input", () => {
    expect(retakeAvailableAt(0, 0.5)).toBe(43_200_000);
    expect(retakeAvailableAt(0, -1)).toBeNull();
    expect(retakeAvailableAt(0, Number.NaN)).toBeNull();
    expect(retakeAvailableAt(Number.NaN, 14)).toBeNull();
  });
});

describe("introState cooldown boundary", () => {
  const READY = { ready: true, reasonKey: "ready" as const, remaining: 0 };
  const submitted = Date.parse("2026-10-14T20:30:00Z"); // 23:30 Qatar
  const last: AttemptLite = { id: "a", status: "graded", started_at: iso(submitted - 3_600_000), deadline_at: iso(submitted + 600_000), submitted_at: iso(submitted) };
  const retakeAt = submitted + 7 * 86_400_000;

  it("blocks 1 ms before and allows at exactly the retake time", () => {
    expect(introState({ attempts: [last], testType: "diagnostic", cooldownDays: 7, gate: READY, now: retakeAt - 1 }).kind).toBe("cooldown");
    expect(introState({ attempts: [last], testType: "diagnostic", cooldownDays: 7, gate: READY, now: retakeAt }).kind).toBe("start");
  });
  it("cooldown 0 never blocks", () => {
    expect(introState({ attempts: [last], testType: "diagnostic", cooldownDays: 0, gate: READY, now: submitted + 1 }).kind).toBe("start");
  });
  it("cooldown wins over the Get Ready lock", () => {
    const notReady = { ready: false, reasonKey: "not_finished" as const, remaining: 2 };
    expect(introState({ attempts: [last], testType: "diagnostic", cooldownDays: 7, gate: notReady, now: submitted + 1 }).kind).toBe("cooldown");
  });
  it("attemptEndedAt prefers submit, then deadline, then start; null when none parse", () => {
    expect(attemptEndedAt(last)).toBe(submitted);
    expect(attemptEndedAt({ ...last, submitted_at: null })).toBe(submitted + 600_000);
    expect(attemptEndedAt({ ...last, submitted_at: null, deadline_at: null })).toBe(submitted - 3_600_000);
    expect(attemptEndedAt({ ...last, submitted_at: null, deadline_at: null, started_at: "bad" })).toBeNull();
  });
  it("only in_progress attempts within deadline + grace are open", () => {
    expect(isOpenAttempt({ ...last, status: "submitted" }, submitted)).toBe(false);
    expect(isOpenAttempt({ ...last, status: "in_progress", submitted_at: null }, submitted)).toBe(true);
    expect(isOpenAttempt({ ...last, status: "in_progress", deadline_at: iso(submitted - 61_000) }, submitted)).toBe(false);
  });
});
