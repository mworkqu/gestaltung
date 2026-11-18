import { describe, expect, it } from "vitest";

import {
  clockOffset,
  crossedThreshold,
  deadlineFrom,
  formatCountdown,
  graceEndsAt,
  isPastDeadline,
  isPastGrace,
  minutesUntil,
  parseTime,
  partCollectedDueAt,
  retakeAvailableAt,
  secondsSince,
  secondsUntil,
  warningLevel,
} from "./timer";

const T0 = Date.parse("2026-10-14T08:00:00.000Z");

describe("deadline math", () => {
  it("adds the time limit to the start", () => {
    expect(deadlineFrom(T0, 90)).toBe(T0 + 90 * 60_000);
    expect(deadlineFrom(T0, 3)).toBe(T0 + 180_000);
  });

  it("returns null for untimed tests and bad input", () => {
    expect(deadlineFrom(T0, null)).toBeNull();
    expect(deadlineFrom(T0, 0)).toBeNull();
    expect(deadlineFrom(Number.NaN, 90)).toBeNull();
  });

  it("parses ISO times safely", () => {
    expect(parseTime("2026-10-14T08:00:00.000Z")).toBe(T0);
    expect(parseTime("nope")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });

  it("applies the 60-second grace period", () => {
    const deadline = T0 + 90 * 60_000;
    expect(graceEndsAt(deadline)).toBe(deadline + 60_000);
    expect(isPastGrace(deadline + 59_000, deadline)).toBe(false);
    expect(isPastGrace(deadline + 60_000, deadline)).toBe(false);
    expect(isPastGrace(deadline + 60_001, deadline)).toBe(true);
    expect(isPastGrace(deadline + 10_000, deadline, 0)).toBe(true);
    expect(isPastGrace(T0, null)).toBe(false);
  });

  it("knows when the deadline has passed", () => {
    expect(isPastDeadline(T0, T0)).toBe(true);
    expect(isPastDeadline(T0 - 1, T0)).toBe(false);
    expect(isPastDeadline(T0, null)).toBe(false);
  });

  it("counts seconds and minutes left, never negative", () => {
    expect(secondsUntil(T0 + 1500, T0)).toBe(2);
    expect(secondsUntil(T0 - 5000, T0)).toBe(0);
    expect(minutesUntil(T0 + 47 * 60_000 - 1, T0)).toBe(47);
    expect(minutesUntil(T0 + 46 * 60_000 + 1, T0)).toBe(47);
  });

  it("counts elapsed seconds", () => {
    expect(secondsSince(T0, T0 + 61_500)).toBe(61);
    expect(secondsSince(T0, T0 - 1000)).toBe(0);
  });
});

describe("warnings", () => {
  it("maps time left to a level", () => {
    expect(warningLevel(16 * 60)).toBe("none");
    expect(warningLevel(15 * 60)).toBe("warning");
    expect(warningLevel(5 * 60 + 1)).toBe("warning");
    expect(warningLevel(5 * 60)).toBe("urgent");
    expect(warningLevel(61)).toBe("urgent");
    expect(warningLevel(60)).toBe("critical");
    expect(warningLevel(1)).toBe("critical");
    expect(warningLevel(0)).toBe("over");
  });

  it("reports a crossed threshold once", () => {
    expect(crossedThreshold(null, 200)).toBeNull();
    expect(crossedThreshold(901, 900)).toBe(900);
    expect(crossedThreshold(900, 899)).toBeNull();
    expect(crossedThreshold(301, 300)).toBe(300);
    expect(crossedThreshold(61, 60)).toBe(60);
    // A long sleep jumps over several thresholds: the smallest wins.
    expect(crossedThreshold(1000, 30)).toBe(60);
  });
});

describe("clock sync", () => {
  it("estimates the server offset from the middle of the round trip", () => {
    expect(clockOffset({ serverNow: 10_500, sentAt: 1000, receivedAt: 2000 })).toBe(9000);
    expect(clockOffset({ serverNow: 1500, sentAt: 1000, receivedAt: 2000 })).toBe(0);
  });

  it("ignores broken readings", () => {
    expect(clockOffset({ serverNow: Number.NaN, sentAt: 1, receivedAt: 2 })).toBe(0);
    expect(clockOffset({ serverNow: 5, sentAt: 10, receivedAt: 2 })).toBe(0);
  });
});

describe("M4 phase marker and retakes", () => {
  it("is due 2 hours after the start", () => {
    expect(partCollectedDueAt(T0)).toBe(T0 + 120 * 60_000);
    expect(partCollectedDueAt(null)).toBeNull();
  });

  it("computes the retake date", () => {
    expect(retakeAvailableAt(T0, 14)).toBe(T0 + 14 * 86_400_000);
    expect(retakeAvailableAt(T0, 0)).toBeNull();
    expect(retakeAvailableAt(null, 14)).toBeNull();
  });

  it("formats the clock with Western digits", () => {
    expect(formatCountdown(5 * 60 + 9)).toBe("05:09");
    expect(formatCountdown(90 * 60)).toBe("1:30:00");
  });
});
