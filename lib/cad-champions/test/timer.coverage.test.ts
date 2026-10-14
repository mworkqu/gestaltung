import { describe, expect, it } from "vitest";

import { ageOn, isMinorDob, qatarToday } from "../auth/schema";
import { formatDate, formatDateTime } from "../format";
import { clockOffset, crossedThreshold, deadlineFrom, graceEndsAt, isPastDeadline, isPastGrace, parseTime, partCollectedDueAt, retakeAvailableAt, warningLevel } from "./timer";

const T0 = Date.parse("2026-10-14T21:00:00Z"); // 00:00 15 Oct Qatar

describe("timer boundaries", () => {
  it("deadline: 60 min test; null for 0, negative, NaN start", () => {
    expect(deadlineFrom(T0, 60)).toBe(T0 + 3_600_000);
    expect(deadlineFrom(T0, 0)).toBeNull();
    expect(deadlineFrom(T0, -5)).toBeNull();
    expect(deadlineFrom(Number.NaN, 60)).toBeNull();
    expect(deadlineFrom(T0, undefined)).toBeNull();
  });
  it("deadline is inclusive, grace end is still accepted", () => {
    const d = T0;
    expect(isPastDeadline(d - 1, d)).toBe(false);
    expect(isPastDeadline(d, d)).toBe(true);
    expect(isPastDeadline(d + 1, null)).toBe(false);
    expect(graceEndsAt(d)).toBe(d + 60_000);
    expect(isPastGrace(d + 60_000, d)).toBe(false);
    expect(isPastGrace(d + 60_001, d)).toBe(true);
    expect(isPastGrace(d + 1e12, null)).toBe(false);
  });
  it("warningLevel exact edges 900/300/60/0 and non-integers", () => {
    const L = warningLevel;
    expect([L(901), L(900), L(301), L(300), L(61), L(60), L(1), L(0), L(-5)]).toEqual([
      "none", "warning", "warning", "urgent", "urgent", "critical", "critical", "over", "over",
    ]);
    expect(L(900.5)).toBe("none");
    expect(L(0.5)).toBe("critical");
  });
  it("crossedThreshold", () => {
    expect(crossedThreshold(901, 900)).toBe(900);
    expect(crossedThreshold(900, 899)).toBeNull();
    expect(crossedThreshold(301, 300)).toBe(300);
    expect(crossedThreshold(61, 60)).toBe(60);
    expect(crossedThreshold(61, 0)).toBe(60);
    expect(crossedThreshold(null, 10)).toBeNull();
    expect(crossedThreshold(100, 200)).toBeNull();
  });
  it("retake: cooldown days are fixed 24h blocks; none for 0 / NaN / null", () => {
    expect(retakeAvailableAt(T0, 7)).toBe(T0 + 7 * 86_400_000);
    expect(retakeAvailableAt(T0, 0)).toBeNull();
    expect(retakeAvailableAt(T0, Number.NaN)).toBeNull();
    expect(retakeAvailableAt(null, 7)).toBeNull();
  });
  it("partCollectedDueAt is +120 min; null for missing/NaN", () => {
    expect(partCollectedDueAt(T0)).toBe(T0 + 7_200_000);
    expect(partCollectedDueAt(null)).toBeNull();
    expect(partCollectedDueAt(Number.NaN)).toBeNull();
  });
  it("parseTime / clockOffset", () => {
    expect(parseTime("garbage")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("2026-10-14T21:00:00Z")).toBe(T0);
    expect(clockOffset({ serverNow: 1000, sentAt: 100, receivedAt: 300 })).toBe(800);
    expect(clockOffset({ serverNow: 1000, sentAt: 300, receivedAt: 100 })).toBe(0);
  });
});

describe("Asia/Qatar day boundaries", () => {
  it("formatDate: 20:59:59Z is still the same Qatar day, 21:00:00Z is the next", () => {
    expect(formatDate("2026-10-14T20:59:59Z", "en")).toBe("October 14, 2026");
    expect(formatDate("2026-10-14T21:00:00Z", "en")).toBe("October 15, 2026");
  });
  it("formatDate year rollover", () => {
    expect(formatDate("2026-12-31T21:30:00Z", "en")).toBe("January 1, 2027");
  });
  it("formatDateTime: 21:30Z shows 00:30 (UTC+3, no DST in summer or winter)", () => {
    expect(formatDateTime("2026-10-14T21:30:00Z", "en")).toContain("00:30");
    expect(formatDateTime("2026-01-15T09:00:00Z", "en")).toContain("12:00");
    expect(formatDateTime("2026-07-15T09:00:00Z", "en")).toContain("12:00");
  });
  it("Arabic output keeps Western digits", () => {
    const s = formatDate("2026-10-14T21:30:00Z", "ar");
    expect(s).toMatch(/15/);
    expect(s).not.toMatch(/[٠-٩]/);
  });
  it("qatarToday around midnight", () => {
    expect(qatarToday(new Date("2026-10-14T20:59:59Z"))).toBe("2026-10-14");
    expect(qatarToday(new Date("2026-10-14T21:00:00Z"))).toBe("2026-10-15");
    expect(qatarToday(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
  });
  it("minor flips exactly at Qatar midnight of the 18th birthday", () => {
    const dob = "2008-10-15";
    expect(isMinorDob(dob, new Date("2026-10-14T20:59:59Z"))).toBe(true);
    expect(isMinorDob(dob, new Date("2026-10-14T21:00:00Z"))).toBe(false);
  });
  it("leap-day birthday, bad dates and empty values", () => {
    expect(ageOn("2008-02-29", new Date("2026-02-28T09:00:00Z"))).toBe(17);
    expect(ageOn("2008-02-29", new Date("2026-03-01T09:00:00Z"))).toBe(18);
    expect(ageOn("not-a-date", new Date())).toBeNull();
    expect(isMinorDob("", new Date())).toBe(false);
    expect(isMinorDob(undefined, new Date())).toBe(false);
    expect(isMinorDob("2026-13-01", new Date())).toBe(false);
  });
});
