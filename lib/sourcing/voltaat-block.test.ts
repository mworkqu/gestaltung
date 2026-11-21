import { describe, expect, it } from "vitest";

import {
  blockedDayStreak,
  blockedUntil,
  blockErrorText,
  DEFAULT_BLOCK_HOURS,
  parseRetryAfter,
  retryAfterFrom,
  runGuard,
  shouldEmailBlocked,
} from "./voltaat-block";

const now = new Date("2026-11-21T03:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const HOUR = 3600_000;
const DAY = 86_400_000;

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("600", now)).toBe("2026-11-21T03:10:00.000Z");
  });
  it("reads an HTTP date", () => {
    expect(parseRetryAfter("Sat, 21 Nov 2026 06:00:00 GMT", now)).toBe("2026-11-21T06:00:00.000Z");
  });
  it("refuses nonsense, the past and anything over a week out", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("0", now)).toBeNull();
    expect(parseRetryAfter("Mon, 01 Jan 2020 00:00:00 GMT", now)).toBeNull();
    expect(parseRetryAfter(String(30 * 86_400), now)).toBeNull();
  });
});

describe("the blocked run remembers the wait", () => {
  it("round-trips through supplier_sync_runs.error", () => {
    const text = blockErrorText("blocked_429", "2026-11-21T06:00:00.000Z");
    expect(text).toBe("blocked_429 retry_after=2026-11-21T06:00:00.000Z");
    expect(retryAfterFrom(text)).toBe("2026-11-21T06:00:00.000Z");
    expect(retryAfterFrom("blocked_429")).toBeNull();
    expect(retryAfterFrom(null)).toBeNull();
  });
  it("falls back to a day from the blocked run when the store said nothing", () => {
    const until = blockedUntil({ started_at: ago(0), error: "blocked_429" });
    expect(until).toBe(new Date(now.getTime() + DEFAULT_BLOCK_HOURS * HOUR).toISOString());
  });
});

describe("blockedDayStreak / shouldEmailBlocked", () => {
  it("counts whole days in a row ending today", () => {
    expect(blockedDayStreak([], now)).toBe(0);
    expect(blockedDayStreak([ago(0)], now)).toBe(1);
    expect(blockedDayStreak([ago(0), ago(DAY)], now)).toBe(2);
    expect(blockedDayStreak([ago(0), ago(DAY), ago(2 * DAY)], now)).toBe(3);
    // Several blocked runs on the same day are still one day.
    expect(blockedDayStreak([ago(0), ago(HOUR), ago(2 * HOUR)], now)).toBe(1);
    // A clear day ends the streak.
    expect(blockedDayStreak([ago(0), ago(2 * DAY), ago(3 * DAY)], now)).toBe(1);
  });
  it("emails once, on the third day", () => {
    expect([0, 1, 2, 3, 4, 10].map(shouldEmailBlocked)).toEqual([false, false, false, true, false, false]);
  });
});

describe("runGuard", () => {
  it("lets a first run start", () => {
    expect(runGuard([], now)).toEqual({ skip: false });
  });
  it("keeps the second runner out while one is running (covers Vercel + the Mac Mini)", () => {
    expect(runGuard([{ status: "running", started_at: ago(5 * 60_000) }], now)).toEqual({ skip: true, reason: "already_running" });
    // A 'running' row left behind by a crashed run stops blocking after an hour.
    expect(runGuard([{ status: "running", started_at: ago(2 * HOUR) }], now)).toEqual({ skip: false });
  });
  it("allows one good run per 20 h", () => {
    expect(runGuard([{ status: "ok", started_at: ago(19 * HOUR) }], now)).toEqual({ skip: true, reason: "already_ran_today" });
    expect(runGuard([{ status: "ok", started_at: ago(21 * HOUR) }], now)).toEqual({ skip: false });
  });
  it("waits out a block instead of trying again on the next schedule", () => {
    const blocked = { status: "blocked", started_at: ago(HOUR), error: "blocked_429 retry_after=2026-11-21T06:00:00.000Z" };
    expect(runGuard([blocked], now)).toEqual({ skip: true, reason: "blocked_until", until: "2026-11-21T06:00:00.000Z" });
    // Past the wait: try again.
    expect(runGuard([blocked], new Date("2026-11-21T06:00:01Z"))).toEqual({ skip: false });
  });
  it("holds for a day when the store sent no Retry-After", () => {
    const g = runGuard([{ status: "blocked", started_at: ago(2 * HOUR), error: "blocked_403" }], now);
    expect(g).toMatchObject({ skip: true, reason: "blocked_until" });
  });
  it("a failed run is not a block: the next schedule may try", () => {
    expect(runGuard([{ status: "failed", started_at: ago(HOUR), error: "boom" }], now)).toEqual({ skip: false });
  });
  it("judges by the newest finished run, ignoring 'skipped' rows", () => {
    const runs = [
      { status: "blocked", started_at: ago(3 * HOUR), error: "blocked_429 retry_after=2026-11-21T06:00:00.000Z" },
      { status: "ok", started_at: ago(30 * HOUR) },
    ];
    expect(runGuard(runs, now)).toMatchObject({ skip: true, reason: "blocked_until" });
  });
});
