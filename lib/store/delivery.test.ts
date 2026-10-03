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
