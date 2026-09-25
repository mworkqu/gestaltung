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
