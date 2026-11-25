import { describe, expect, it } from "vitest";

import { settingsAvailability } from "./availability";
import {
  MAX_FUTURE_PER_PHONE,
  canChangeOnline,
  canSetStatus,
  changeDeadline,
  creditAmount,
  creditCheck,
  hasEnoughNotice,
  isLive,
  nextStatuses,
  type MeetingStatus,
} from "./rules";
import { DEFAULT_MEETING_SETTINGS } from "./settings";

const NOW = Date.parse("2026-11-22T09:00:00Z");
const MON_16 = "2026-11-23T13:00:00.000Z";
const S = DEFAULT_MEETING_SETTINGS;

describe("status ladder", () => {
  it("moves forward only", () => {
    expect(canSetStatus("booked", "done")).toBe(true);
    expect(canSetStatus("booked", "no_show")).toBe(true);
    expect(canSetStatus("booked", "cancelled")).toBe(true);
    expect(canSetStatus("done", "invoiced")).toBe(true);
    expect(canSetStatus("invoiced", "paid")).toBe(true);
  });

  it("never goes back or skips the invoice", () => {
    expect(canSetStatus("booked", "invoiced")).toBe(false);
    expect(canSetStatus("booked", "paid")).toBe(false);
    expect(canSetStatus("done", "booked")).toBe(false);
    expect(canSetStatus("invoiced", "done")).toBe(false);
    expect(canSetStatus("paid", "invoiced")).toBe(false);
    expect(canSetStatus("cancelled", "booked")).toBe(false);
    expect(canSetStatus("no_show", "done")).toBe(false);
  });

  it("names the owner's choices and what still counts as live", () => {
    expect(nextStatuses("booked")).toEqual(["done", "no_show", "cancelled"]);
    expect(nextStatuses("paid")).toEqual([]);
    for (const s of ["booked", "done", "invoiced", "paid"] as MeetingStatus[]) expect(isLive(s)).toBe(true);
    expect(isLive("cancelled")).toBe(false);
    expect(isLive("no_show")).toBe(false);
  });
});

describe("the 24-hour window", () => {
  it("allows a change until 24 h before the start", () => {
    expect(canChangeOnline({ startsAt: MON_16, status: "booked" }, S, NOW)).toBe(true);
    // exactly on the deadline is still allowed
    const deadline = Date.parse(MON_16) - 24 * 3_600_000;
    expect(canChangeOnline({ startsAt: MON_16, status: "booked" }, S, deadline)).toBe(true);
    expect(canChangeOnline({ startsAt: MON_16, status: "booked" }, S, deadline + 1)).toBe(false);
  });

  it("refuses once the meeting is no longer simply booked", () => {
    for (const status of ["done", "cancelled", "no_show", "invoiced", "paid"] as MeetingStatus[]) {
      expect(canChangeOnline({ startsAt: MON_16, status }, S, NOW)).toBe(false);
    }
  });

  it("reports the deadline and the booking notice", () => {
    expect(changeDeadline(MON_16, S)).toBe("2026-11-22T13:00:00.000Z");
    expect(hasEnoughNotice(MON_16, S, NOW)).toBe(true);
    expect(hasEnoughNotice(MON_16, S, Date.parse("2026-11-23T10:00:00Z"))).toBe(false);
    expect(MAX_FUTURE_PER_PHONE).toBe(2);
  });
});

describe("order credit", () => {
  const base = { status: "paid" as MeetingStatus, startsAt: MON_16, orderCreatedAt: "2026-11-26T09:00:00Z" };

  it("applies to an order placed within 30 days of a paid meeting", () => {
    expect(creditCheck(base, S)).toEqual({ ok: true });
    expect(creditAmount(base, S)).toBe(150);
  });

  it("refuses an unpaid meeting, a used credit and an order outside the window", () => {
    expect(creditCheck({ ...base, status: "done" }, S)).toEqual({ ok: false, reason: "not_paid" });
    expect(creditCheck({ ...base, creditOrderId: "order-1" }, S)).toEqual({ ok: false, reason: "already_used" });
    // before the meeting
    expect(creditCheck({ ...base, orderCreatedAt: "2026-11-22T09:00:00Z" }, S)).toEqual({ ok: false, reason: "out_of_window" });
    // 31 days after
    expect(creditCheck({ ...base, orderCreatedAt: "2026-12-25T13:00:00Z" }, S)).toEqual({ ok: false, reason: "out_of_window" });
    expect(creditAmount({ ...base, status: "done" }, S)).toBe(0);
  });

  it("counts the last day of the window as inside it", () => {
    const last = new Date(Date.parse(MON_16) + 30 * 86_400_000).toISOString();
    expect(creditCheck({ ...base, orderCreatedAt: last }, S)).toEqual({ ok: true });
    expect(creditCheck({ ...base, orderCreatedAt: new Date(Date.parse(last) + 1).toISOString() }, S).ok).toBe(false);
  });
});

describe("settings availability provider", () => {
  const provider = (taken: string[] = []) =>
    settingsAvailability({
      settings: S,
      holidays: [],
      takenSlots: async () => taken,
      now: () => new Date(NOW),
    });

  it("returns the settings calendar minus live bookings", async () => {
    const all = await provider().freeSlots(undefined, undefined);
    expect(all[0]).toBe(MON_16);

    const fewer = await provider([MON_16]).freeSlots(undefined, undefined);
    expect(fewer).not.toContain(MON_16);
    expect(fewer.length).toBe(all.length - 1);
  });

  it("clamps the window it is asked for", async () => {
    const all = await provider().freeSlots(undefined, undefined);
    expect(await provider().freeSlots(undefined, 999)).toEqual(all);
    // 0 becomes 1 day: Sunday alone, which is closed
    expect(await provider().freeSlots(undefined, 0)).toEqual([]);
  });

  it("asks the store for the same window it generates", async () => {
    const seen: { from: string; days: number }[] = [];
    const p = settingsAvailability({
      settings: S,
      holidays: [],
      takenSlots: async (from, days) => {
        seen.push({ from, days });
        return [];
      },
      now: () => new Date(NOW),
    });
    await p.freeSlots(undefined, 7);
    expect(seen).toEqual([{ from: "2026-11-22", days: 7 }]);
  });
});
