import { describe, expect, it } from "vitest";

import { formatCountdown, secondsLeft, testCardState } from "./test-status";

const NOW = Date.parse("2026-06-01T10:00:00Z");

describe("testCardState", () => {
  it("handles no attempt", () => {
    expect(testCardState({ testAvailable: false, attempt: null, locked: false, now: NOW })).toBe("unavailable");
    expect(testCardState({ testAvailable: true, attempt: null, locked: true, now: NOW })).toBe("locked");
    expect(testCardState({ testAvailable: true, attempt: null, locked: false, now: NOW })).toBe("not_started");
  });
  it("tracks an attempt through its life", () => {
    const base = { testAvailable: true, locked: false, now: NOW };
    expect(testCardState({ ...base, attempt: { status: "in_progress", deadline_at: "2026-06-01T11:00:00Z" } })).toBe("in_progress");
    expect(testCardState({ ...base, attempt: { status: "in_progress", deadline_at: "2026-06-01T09:59:00Z" } })).toBe("time_up");
    expect(testCardState({ ...base, attempt: { status: "in_progress", deadline_at: null } })).toBe("in_progress");
    expect(testCardState({ ...base, attempt: { status: "submitted" } })).toBe("grading");
    expect(testCardState({ ...base, attempt: { status: "grading" } })).toBe("grading");
    expect(testCardState({ ...base, attempt: { status: "provisional" } })).toBe("ready");
    expect(testCardState({ ...base, attempt: { status: "graded" } })).toBe("ready");
    expect(testCardState({ ...base, attempt: { status: "expired" } })).toBe("expired");
  });
  it("shows an existing attempt even if the test was unpublished or Get Ready is locked", () => {
    expect(testCardState({ testAvailable: false, locked: true, attempt: { status: "graded" }, now: NOW })).toBe("ready");
  });
});

describe("countdown", () => {
  it("computes seconds left", () => {
    expect(secondsLeft("2026-06-01T10:01:30Z", NOW)).toBe(90);
    expect(secondsLeft("2026-06-01T09:00:00Z", NOW)).toBe(0);
    expect(secondsLeft("nope", NOW)).toBe(0);
  });
  it("formats with Western digits", () => {
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(3725)).toBe("1:02:05");
    expect(formatCountdown(-4)).toBe("00:00");
  });
});
