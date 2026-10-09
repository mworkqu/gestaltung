import { describe, expect, it } from "vitest";

import { isOnRequest, reviewPromise, splitByDatability } from "@/lib/store/delivery";

describe("isOnRequest / splitByDatability", () => {
  const a = { partId: "a", leadTimeClass: "in_stock" as const };
  const b = { partId: "b", leadTimeClass: null };
  const c = { partId: "c", leadTimeClass: "1_2_weeks" as const };

  it("uses the server quote's on_request ids when present", () => {
    // The quote is authoritative even when the cart snapshot says otherwise.
    expect(isOnRequest(a, ["a"])).toBe(true);
    expect(isOnRequest(b, [])).toBe(false);
  });

  it("falls back to the line's lead-time class before the quote loads", () => {
    expect(isOnRequest(a, null)).toBe(false);
    expect(isOnRequest(b, undefined)).toBe(true);
    expect(isOnRequest({ partId: "x" })).toBe(true);
  });

  it("splits lines, keeping order", () => {
    expect(splitByDatability([a, b, c], ["b"])).toEqual({ datable: [a, c], toConfirm: [b] });
    expect(splitByDatability([b], ["b"])).toEqual({ datable: [], toConfirm: [b] });
    expect(splitByDatability([], ["b"])).toEqual({ datable: [], toConfirm: [] });
  });
});

describe("reviewPromise (delivery-promises cron)", () => {
  const base = { orderDate: "2026-10-01", oldDate: "2026-10-10", handlingDays: 1, transitDays: 3, bufferDays: 3 };

  it("returns null when nothing datable changed", () => {
    expect(reviewPromise([{ sold: "in_stock", current: "in_stock" }], base)).toBeNull();
  });

  it("skips lines sold on request, even if they have an offer now", () => {
    expect(reviewPromise([{ sold: null, current: "in_stock" }], base)).toBeNull();
    expect(
      reviewPromise(
        [
          { sold: null, current: null },
          { sold: "in_stock", current: "in_stock" },
        ],
        base
      )
    ).toBeNull();
  });

  it("moves the date later from datable lines only", () => {
    // 1_2_weeks = 14 days: 1 Oct + 14 + 1 + 3 + 3 = 22 Oct.
    const r = reviewPromise(
      [
        { sold: null, current: null },
        { sold: "in_stock", current: "1_2_weeks" },
      ],
      base
    );
    expect(r).toEqual({ changed: [1], newDate: "2026-10-22" });
  });

  it("never moves the date earlier", () => {
    const r = reviewPromise([{ sold: "2_4_weeks", current: "in_stock" }], { ...base, oldDate: "2026-11-05" });
    expect(r).toEqual({ changed: [0], newDate: "2026-11-05" });
  });

  it("returns a null date when a datable line lost its offer", () => {
    const r = reviewPromise(
      [
        { sold: "in_stock", current: null },
        { sold: null, current: null },
      ],
      base
    );
    expect(r).toEqual({ changed: [0], newDate: null });
  });
});

import { arrivesByDate, parseShippingSettings, todayIso } from "@/lib/store/delivery";

describe("parseShippingSettings", () => {
  it("reads handling, buffer and the standard tier's transit days", () => {
    expect(
      parseShippingSettings({ handling_days: 1, buffer_days: 3, tiers: { standard: { transit_days: 2 }, express: { transit_days: 1 } } })
    ).toEqual({ handlingDays: 1, bufferDays: 3, standardTransitDays: 2 });
  });
  it("uses the SQL defaults for missing days (handling 1, buffer 3, transit 0)", () => {
    expect(parseShippingSettings({ tiers: { standard: {} } })).toEqual({ handlingDays: 1, bufferDays: 3, standardTransitDays: 0 });
    expect(parseShippingSettings({ handling_days: 0, buffer_days: 0, tiers: { standard: { transit_days: 0 } } })).toEqual({
      handlingDays: 0,
      bufferDays: 0,
      standardTransitDays: 0,
    });
  });
  it("is null without a standard tier or a usable value", () => {
    expect(parseShippingSettings({ tiers: { express: { transit_days: 1 } } })).toBeNull();
    expect(parseShippingSettings(null)).toBeNull();
    expect(parseShippingSettings("x")).toBeNull();
  });
});

describe("arrivesByDate (mirrors order_delivery_quote, Standard tier)", () => {
  const settings = { handlingDays: 1, bufferDays: 3, standardTransitDays: 2 };

  it("is from + lead class days + handling + transit + buffer", () => {
    // in_stock = 2 days: 2 + 1 + 2 + 3 = 8
    expect(arrivesByDate("in_stock", settings, "2026-10-03")).toBe("2026-10-11");
    // 3_5_days = 5: 5 + 6 = 11
    expect(arrivesByDate("3_5_days", settings, "2026-10-03")).toBe("2026-10-14");
    // 1_2_weeks = 14: 14 + 6 = 20
    expect(arrivesByDate("1_2_weeks", settings, "2026-10-03")).toBe("2026-10-23");
    // 2_4_weeks = 28: 28 + 6 = 34, across a month and year end
    expect(arrivesByDate("2_4_weeks", settings, "2026-12-01")).toBe("2027-01-04");
  });
  it("has no date for a product on request or without settings", () => {
    expect(arrivesByDate(null, settings, "2026-10-03")).toBeNull();
    expect(arrivesByDate(undefined, settings, "2026-10-03")).toBeNull();
    expect(arrivesByDate("in_stock", null, "2026-10-03")).toBeNull();
  });
  it("defaults the start to today (UTC)", () => {
    expect(arrivesByDate("in_stock", settings)).toBe(arrivesByDate("in_stock", settings, todayIso()));
    expect(todayIso(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-03");
  });
});

import { promiseDate } from "@/lib/store/delivery";

describe("working days (P2-06, mirrors order_delivery_quote v3)", () => {
  const QA = { weekend: [5, 6], dates: ["2026-12-18", "2026-12-19"] };

  it("promiseDate: supplier lead in calendar days, our days in working days", () => {
    // Worked example: Thu 17 Dec, in_stock lead 2 (→ Sat 19), then 1 handling + 3 transit + 3 buffer = 7
    // working days: Sun 20 … Thu 24 (5), Sun 27 (6), Mon 28 (7).
    expect(promiseDate("2026-12-17", 2, 7, QA)).toBe("2026-12-28");
    // Without a lead the answer is the same here (Fri 18 / Sat 19 are skipped anyway).
    expect(promiseDate("2026-12-17", 0, 7, QA)).toBe("2026-12-28");
    // No holidays row (before 0054): calendar days, as the 0044 quote.
    expect(promiseDate("2026-12-17", 2, 7, null)).toBe("2026-12-26");
  });
  it("promiseDate with 0 own days still rolls off a weekend", () => {
    expect(promiseDate("2026-10-14", 2, 0, QA)).toBe("2026-10-18"); // Wed + 2 = Fri → Sun
  });
  it("arrivesByDate uses the holidays in the settings", () => {
    const settings = { handlingDays: 1, bufferDays: 3, standardTransitDays: 3, holidays: QA };
    expect(arrivesByDate("in_stock", settings, "2026-12-17")).toBe("2026-12-28");
    // 1_2_weeks: 17 Dec + 14 = Thu 31 Dec, + 7 working days: Sun 3 … Thu 7 (5), Sun 10 (6), Mon 11 (7).
    expect(arrivesByDate("1_2_weeks", settings, "2026-12-17")).toBe("2027-01-11");
    expect(arrivesByDate("in_stock", { ...settings, holidays: null }, "2026-12-17")).toBe("2026-12-26");
  });
  it("reviewPromise recomputes with working days", () => {
    const r = reviewPromise([{ sold: "in_stock", current: "3_5_days" }], {
      orderDate: "2026-12-17",
      oldDate: "2026-12-28",
      handlingDays: 1,
      transitDays: 3,
      bufferDays: 3,
      holidays: QA,
    });
    // 17 Dec + 5 = Tue 22 Dec, + 7 working days: Wed 23, Thu 24, Sun 27, Mon 28, Tue 29, Wed 30, Thu 31.
    expect(r).toEqual({ changed: [0], newDate: "2026-12-31" });
  });
});
