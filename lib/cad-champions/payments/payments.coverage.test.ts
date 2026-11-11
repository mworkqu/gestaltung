import { describe, expect, it } from "vitest";

import type { CcPaymentStatus } from "../db/types";
import { computeTotals, discountAmount } from "./coupon";
import { allowedTransitions, canTransition, isTerminal } from "./state-machine";

const ALL: CcPaymentStatus[] = ["awaiting_transfer", "proof_submitted", "rejected", "paid", "refunded", "expired", "cancelled"];
// Independent literal copy of the intended graph.
const FAWRAN: Record<CcPaymentStatus, CcPaymentStatus[]> = {
  awaiting_transfer: ["proof_submitted", "expired", "cancelled"],
  proof_submitted: ["paid", "rejected"],
  rejected: ["proof_submitted"],
  paid: ["refunded"],
  refunded: [],
  expired: [],
  cancelled: [],
};

describe("state machine: literal full matrix", () => {
  it("fawran: exactly the intended edges, all 49 pairs", () => {
    for (const f of ALL) for (const t of ALL) expect(canTransition(f, t, "fawran"), `${f}>${t}`).toBe(FAWRAN[f].includes(t));
  });
  it("skipcash: same graph plus awaiting_transfer>paid only", () => {
    for (const f of ALL)
      for (const t of ALL) {
        const extra = f === "awaiting_transfer" && t === "paid";
        expect(canTransition(f, t, "skipcash"), `${f}>${t}`).toBe(FAWRAN[f].includes(t) || extra);
      }
  });
  it("no self transitions; terminal = refunded, expired, cancelled", () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
    expect(ALL.filter(isTerminal).sort()).toEqual(["cancelled", "expired", "refunded"]);
    for (const s of ["refunded", "expired", "cancelled"] as const) expect(allowedTransitions(s, "skipcash")).toEqual([]);
  });
  it("default method is fawran", () => {
    expect(canTransition("awaiting_transfer", "paid")).toBe(false);
  });
});

describe("coupon maths", () => {
  it("fixed coupon", () => {
    expect(computeTotals({ planPrice: 1000, coupon: { type: "fixed", value: 250 } })).toEqual({ list: 1000, discount: 250, addon: 0, amount: 750 });
  });
  it("percent coupon", () => {
    expect(computeTotals({ planPrice: 1000, coupon: { type: "percent", value: 15 } })).toEqual({ list: 1000, discount: 150, addon: 0, amount: 850 });
  });
  it("percent over 100 is capped at the price; fixed over price clamps amount at 0", () => {
    expect(computeTotals({ planPrice: 400, coupon: { type: "percent", value: 250 } }).amount).toBe(0);
    expect(computeTotals({ planPrice: 400, coupon: { type: "fixed", value: 9999 } })).toEqual({ list: 400, discount: 400, addon: 0, amount: 0 });
  });
  it("addon is added AFTER the discount (never discounted) and stays consistent", () => {
    const t = computeTotals({ planPrice: 1000, coupon: { type: "percent", value: 50 }, addonPrice: 200 });
    expect(t).toEqual({ list: 1000, discount: 500, addon: 200, amount: 700 });
    expect(t.amount).toBe(t.list - t.discount + t.addon);
    expect(computeTotals({ planPrice: 100, coupon: { type: "fixed", value: 500 }, addonPrice: 30 }).amount).toBe(30);
  });
  it("rounds to 2 decimals", () => {
    expect(discountAmount("percent", 33.333, 100)).toBe(33.33);
    expect(computeTotals({ planPrice: 99.99, coupon: { type: "percent", value: 10 } })).toMatchObject({ discount: 10, amount: 89.99 });
  });
  it("no coupon and zero/NaN coupon values give no discount", () => {
    expect(computeTotals({ planPrice: 500 }).discount).toBe(0);
    expect(computeTotals({ planPrice: 500, coupon: { type: "fixed", value: 0 } }).amount).toBe(500);
    expect(computeTotals({ planPrice: 500, coupon: { type: "percent", value: Number.NaN } }).amount).toBe(500);
  });
});
