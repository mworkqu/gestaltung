import { describe, expect, it } from "vitest";

import { DEFAULT_MEETING_SETTINGS, readMeetingSettings, hhmm, minutesOfDay } from "./settings";
import { freeSlots, isoWeekday, qatarDate, qatarInstant, slotLabel, slotOnGrid, slotOptions, slotTimesOfDay } from "./slots";

// Sunday 22 Nov 2026, 12:00 Qatar (09:00Z). The first open slot is Monday 16:00.
const NOW = Date.parse("2026-11-22T09:00:00Z");
const MON_16 = "2026-11-23T13:00:00.000Z";
const MON_17 = "2026-11-23T14:00:00.000Z";
const WED_16 = "2026-11-25T13:00:00.000Z";
const S = DEFAULT_MEETING_SETTINGS;

describe("meeting settings", () => {
  it("fills defaults in and clamps a hand-edited row", () => {
    expect(readMeetingSettings(undefined)).toEqual(S);
    expect(readMeetingSettings({ price_qar: 200 })).toMatchObject({ price_qar: 200, weekdays: [1, 3], start: "16:00" });

    const wild = readMeetingSettings({
      weekdays: [0, 1, 3, 9, 3],
      start: "25:00",
      end: "09:00",
      slot_minutes: 2,
      horizon_days: 9999,
      modes: ["online", "carrier_pigeon"],
    });
    expect(wild.weekdays).toEqual([1, 3]); // 0 and 9 dropped, duplicates removed
    expect(wild.start).toBe("16:00"); // invalid time -> default
    expect(wild.end).toBe("18:00"); // end before start -> default
    expect(wild.slot_minutes).toBe(15); // clamped up
    expect(wild.horizon_days).toBe(365); // clamped down
    expect(wild.modes).toEqual(["online"]);
  });

  it("converts between HH:MM and minutes", () => {
    expect(minutesOfDay("16:00")).toBe(960);
    expect(minutesOfDay("00:30")).toBe(30);
    expect(hhmm(960)).toBe("16:00");
    expect(hhmm(1_000)).toBe("16:40");
  });
});

describe("Qatar time helpers", () => {
  it("has no DST: the same offset in January and July", () => {
    expect(qatarInstant("2026-01-15", "16:00")).toBe(Date.parse("2026-01-15T13:00:00Z"));
    expect(qatarInstant("2026-07-15", "16:00")).toBe(Date.parse("2026-07-15T13:00:00Z"));
  });

  it("knows the ISO weekday and the Qatar calendar date", () => {
    expect(isoWeekday("2026-11-23")).toBe(1); // Monday
    expect(isoWeekday("2026-11-25")).toBe(3); // Wednesday
    expect(isoWeekday("2026-11-29")).toBe(7); // Sunday
    // 22:00Z is already the next day in Qatar
    expect(qatarDate(Date.parse("2026-11-22T22:00:00Z"))).toBe("2026-11-23");
  });

  it("offers 16:00 and 17:00 only", () => {
    expect(slotTimesOfDay(S)).toEqual(["16:00", "17:00"]);
    expect(slotTimesOfDay({ ...S, slot_minutes: 30 })).toEqual(["16:00", "16:30", "17:00", "17:30"]);
  });
});

describe("freeSlots", () => {
  it("returns Mondays and Wednesdays at 16:00 and 17:00, ordered", () => {
    const slots = freeSlots({ settings: S, nowMs: NOW });
    expect(slots.slice(0, 4)).toEqual([MON_16, MON_17, WED_16, "2026-11-25T14:00:00.000Z"]);
    expect(slots).toEqual([...slots].sort());
    for (const s of slots) expect([1, 3]).toContain(isoWeekday(qatarDate(Date.parse(s))));
  });

  it("honours the notice window", () => {
    // 24 h notice from Sunday noon already clears Monday 16:00
    expect(freeSlots({ settings: S, nowMs: NOW })[0]).toBe(MON_16);
    // a 48 h notice pushes it to Wednesday
    expect(freeSlots({ settings: { ...S, min_notice_hours: 48 }, nowMs: NOW })[0]).toBe(WED_16);
  });

  it("skips holidays and respects the horizon", () => {
    const withHoliday = freeSlots({ settings: S, nowMs: NOW, holidays: ["2026-11-23"] });
    expect(withHoliday[0]).toBe(WED_16);
    expect(withHoliday).not.toContain(MON_16);

    const short = freeSlots({ settings: { ...S, horizon_days: 3 }, nowMs: NOW });
    expect(short).toEqual([MON_16, MON_17]); // Wednesday is day 4, outside a 3-day horizon
    // asking for more days than the horizon changes nothing
    expect(freeSlots({ settings: S, nowMs: NOW, days: 999 })).toEqual(freeSlots({ settings: S, nowMs: NOW }));
  });

  it("drops slots that are already taken", () => {
    const slots = freeSlots({ settings: S, nowMs: NOW, taken: [MON_16, Date.parse(WED_16)] });
    expect(slots).not.toContain(MON_16);
    expect(slots).not.toContain(WED_16);
    expect(slots[0]).toBe(MON_17);
  });
});

describe("slotOnGrid", () => {
  const on = (s: string, extra: Partial<Parameters<typeof slotOnGrid>[2]> = {}) =>
    slotOnGrid(s, S, { nowMs: NOW, ...extra });

  it("accepts an open weekday on the grid", () => {
    expect(on(MON_16)).toBe(true);
    expect(on(MON_17)).toBe(true);
    expect(on(WED_16)).toBe(true);
  });

  it("refuses the wrong day, the wrong time, a holiday and the far future", () => {
    expect(on("2026-11-24T13:00:00.000Z")).toBe(false); // Tuesday
    expect(on("2026-11-23T13:30:00.000Z")).toBe(false); // 16:30, off the grid
    expect(on("2026-11-23T15:00:00.000Z")).toBe(false); // 18:00, does not fit
    expect(on("2026-11-23T12:00:00.000Z")).toBe(false); // 15:00, before opening
    expect(on(MON_16, { holidays: ["2026-11-23"] })).toBe(false);
    expect(on("2027-02-01T13:00:00.000Z")).toBe(false); // past the 21-day horizon
    expect(slotOnGrid("not a date", S, { nowMs: NOW })).toBe(false);
  });
});

describe("labels", () => {
  it("reads as Qatar wall-clock time in English", () => {
    const label = slotLabel(MON_16, "en", S);
    expect(label).toContain("Mon");
    expect(label).toContain("23 Nov");
    expect(label).toMatch(/4:00/);
    expect(label.toLowerCase()).toContain("pm");
    expect(label).toContain("·");
  });

  it("is Arabic with Western digits", () => {
    const label = slotLabel(MON_16, "ar", S);
    expect(label).toContain("نوفمبر");
    expect(label).toContain("23");
    expect(label).toMatch(/4:00/);
    // no Arabic-Indic digits anywhere
    expect(label).not.toMatch(/[٠-٩۰-۹]/);
  });

  it("pairs both labels with the instant", () => {
    const [first] = slotOptions([MON_16], S);
    expect(first).toMatchObject({ starts_at: MON_16 });
    expect(first!.label_en).toMatch(/23 Nov/);
    expect(first!.label_ar).toContain("نوفمبر");
  });
});
