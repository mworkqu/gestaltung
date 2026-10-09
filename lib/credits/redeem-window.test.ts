import { describe, expect, it } from "vitest";

import { nextEarnedAt, redeemableUntil, spendWindow, type LedgerRow } from "./redeem-window";

// Mirrors public.credit_next_earned_at + spend_credit (0053): FIFO over the
// earn rows, window = earned_at + 30 days.
const r = (id: string, kind: string, delta: number, created_at: string): LedgerRow => ({ id, kind, delta, created_at });

describe("nextEarnedAt (FIFO)", () => {
  const ledger = [
    r("a", "wiring", 3, "2026-09-01T10:00:00Z"), // delivered order: +3
    r("b", "cad", 1, "2026-09-01T10:00:00Z"),
    r("c", "wiring", 2, "2026-09-20T10:00:00Z"), // admin grant: +2
  ];

  it("first spend uses the oldest earn", () => {
    expect(nextEarnedAt(ledger, "wiring")).toBe("2026-09-01T10:00:00Z");
  });

  it("after three spends the next unit comes from the second earn row", () => {
    const spent = [
      ...ledger,
      r("s1", "wiring", -1, "2026-09-02T00:00:00Z"),
      r("s2", "wiring", -1, "2026-09-03T00:00:00Z"),
      r("s3", "wiring", -1, "2026-09-21T00:00:00Z"),
    ];
    expect(nextEarnedAt(spent, "wiring")).toBe("2026-09-20T10:00:00Z");
  });

  it("negative admin corrections count as used; kinds are separate", () => {
    const corrected = [...ledger, r("fix", "wiring", -3, "2026-09-05T00:00:00Z")];
    expect(nextEarnedAt(corrected, "wiring")).toBe("2026-09-20T10:00:00Z");
    expect(nextEarnedAt(corrected, "cad")).toBe("2026-09-01T10:00:00Z");
  });

  it("redeemed audit rows (delta 0) change nothing; nothing left → null", () => {
    const zero = [...ledger, r("red", "wiring", 0, "2026-09-02T00:00:00Z")];
    expect(nextEarnedAt(zero, "wiring")).toBe("2026-09-01T10:00:00Z");
    expect(nextEarnedAt([r("a", "wiring", 1, "2026-09-01T00:00:00Z"), r("s", "wiring", -1, "2026-09-02T00:00:00Z")], "wiring")).toBeNull();
  });

  it("earn rows are read in time order whatever the input order", () => {
    const shuffled = [r("late", "wiring", 1, "2026-10-01T00:00:00Z"), r("early", "wiring", 1, "2026-09-01T00:00:00Z")];
    expect(nextEarnedAt(shuffled, "wiring")).toBe("2026-09-01T00:00:00Z");
  });
});

describe("redemption window", () => {
  it("is 30 days from the EARN date, not the spend", () => {
    expect(redeemableUntil("2026-09-01T10:00:00Z").toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("spendWindow: still open, already closed, and the now fallback", () => {
    const ledger = [r("a", "wiring", 1, "2026-09-01T10:00:00Z")];
    expect(spendWindow(ledger, "wiring", new Date("2026-09-15T00:00:00Z"))).toEqual({
      earnedAt: "2026-09-01T10:00:00Z",
      redeemableUntil: "2026-10-01T10:00:00.000Z",
      redeemable: true,
    });
    expect(spendWindow(ledger, "wiring", new Date("2026-10-05T00:00:00Z")).redeemable).toBe(false);
    const now = new Date("2026-10-05T00:00:00Z");
    expect(spendWindow([], "cad", now)).toEqual({
      earnedAt: now.toISOString(),
      redeemableUntil: "2026-11-04T00:00:00.000Z",
      redeemable: true,
    });
  });
});
