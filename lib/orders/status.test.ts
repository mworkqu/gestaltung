import { describe, expect, it } from "vitest";

import {
  ORDER_STATUSES,
  buildTimeline,
  canTransition,
  needsPayment,
  nextStatuses,
  normaliseOrderStatus,
  orderShort,
  toPre0053Status,
} from "./status";

describe("normaliseOrderStatus (0053 mapping)", () => {
  it("keeps the new set and maps the old values", () => {
    for (const s of ORDER_STATUSES) expect(normaliseOrderStatus(s)).toBe(s);
    expect(normaliseOrderStatus("pending")).toBe("confirmed");
    expect(normaliseOrderStatus("processing")).toBe("sourcing");
    expect(normaliseOrderStatus("ready")).toBeNull();
    expect(normaliseOrderStatus(undefined)).toBeNull();
  });
});

describe("state machine", () => {
  it("forward only, skipping allowed", () => {
    expect(canTransition("confirmed", "paid")).toBe(true);
    expect(canTransition("confirmed", "sourcing")).toBe(true); // cash on delivery skips paid
    expect(canTransition("paid", "delivered")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("shipped", "paid")).toBe(false);
    expect(canTransition("sourcing", "confirmed")).toBe(false);
  });

  it("any open status may be cancelled", () => {
    for (const s of ["confirmed", "paid", "sourcing", "shipped"]) expect(canTransition(s, "cancelled")).toBe(true);
  });

  it("delivered and cancelled are terminal; the same status is refused", () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition("delivered", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
    expect(canTransition("paid", "paid")).toBe(false);
  });

  it("junk is refused; legacy sources work", () => {
    expect(canTransition("confirmed", "teleported")).toBe(false);
    expect(canTransition("nope", "paid")).toBe(false);
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("processing", "paid")).toBe(false);
    expect(canTransition("processing", "shipped")).toBe(true);
  });

  it("nextStatuses lists the allowed targets in chain order", () => {
    expect(nextStatuses("confirmed")).toEqual(["paid", "sourcing", "shipped", "delivered", "cancelled"]);
    expect(nextStatuses("shipped")).toEqual(["delivered", "cancelled"]);
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
  });

  it("pre-0053 writes use the old vocabulary; paid has none", () => {
    expect(toPre0053Status("sourcing")).toBe("processing");
    expect(toPre0053Status("shipped")).toBe("shipped");
    expect(toPre0053Status("paid")).toBeNull();
  });
});

describe("buildTimeline", () => {
  const created = "2026-10-01T08:00:00Z";

  it("no history (before 0053): confirmed dated from created_at, later steps by the current status", () => {
    const steps = buildTimeline({ status: "processing", created_at: created }, []);
    expect(steps.map((s) => s.status)).toEqual(["confirmed", "paid", "sourcing", "shipped", "delivered"]);
    expect(steps.map((s) => s.reached)).toEqual([true, true, true, false, false]);
    expect(steps[0].at).toBe(created);
    expect(steps[1].at).toBeNull(); // skipped / unknown → undated
    expect(steps.find((s) => s.current)?.status).toBe("sourcing");
  });

  it("dates and notes from history (first time each status was reached)", () => {
    const steps = buildTimeline({ status: "shipped", created_at: created }, [
      { status: "shipped", changed_at: "2026-10-04T10:00:00Z", note: "Aramex 123" },
      { status: "confirmed", changed_at: "2026-10-01T08:00:01Z" },
      { status: "paid", changed_at: "2026-10-02T09:00:00Z", note: "  " },
    ]);
    expect(steps[0].at).toBe("2026-10-01T08:00:01Z");
    expect(steps[1].at).toBe("2026-10-02T09:00:00Z");
    expect(steps[1].note).toBeNull();
    expect(steps[3]).toMatchObject({ status: "shipped", reached: true, current: true, note: "Aramex 123" });
    expect(steps[4].reached).toBe(false);
  });

  it("cancelled: ends after the last reached step with a cancelled step", () => {
    const steps = buildTimeline({ status: "cancelled", created_at: created }, [
      { status: "confirmed", changed_at: "2026-10-01T08:00:00Z" },
      { status: "paid", changed_at: "2026-10-02T08:00:00Z" },
      { status: "cancelled", changed_at: "2026-10-03T08:00:00Z", note: "Out of stock" },
    ]);
    expect(steps.map((s) => s.status)).toEqual(["confirmed", "paid", "cancelled"]);
    expect(steps[2]).toMatchObject({ reached: true, current: true, note: "Out of stock", at: "2026-10-03T08:00:00Z" });
  });

  it("cancelled without history shows confirmed then cancelled", () => {
    const steps = buildTimeline({ status: "cancelled", created_at: created }, []);
    expect(steps.map((s) => s.status)).toEqual(["confirmed", "cancelled"]);
  });
});

describe("needsPayment", () => {
  it("bank transfer / Fawran: only while confirmed", () => {
    expect(needsPayment("confirmed", "bank_transfer")).toBe(true);
    expect(needsPayment("pending", "fawran")).toBe(true);
    expect(needsPayment("paid", "fawran")).toBe(false);
    expect(needsPayment("sourcing", "bank_transfer")).toBe(false);
  });

  it("cash on delivery: until delivered", () => {
    expect(needsPayment("shipped", "cash_on_delivery")).toBe(true);
    expect(needsPayment("delivered", "cash_on_delivery")).toBe(false);
  });

  it("never for cancelled orders or without a method", () => {
    expect(needsPayment("cancelled", "fawran")).toBe(false);
    expect(needsPayment("confirmed", null)).toBe(false);
  });
});

it("orderShort = first 8 characters", () => {
  expect(orderShort("945ea389-1111-2222-3333-444444444444")).toBe("945ea389");
});
