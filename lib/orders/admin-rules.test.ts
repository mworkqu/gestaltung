import { describe, expect, it } from "vitest";

import {
  canCancel,
  canMarkTest,
  filterVisible,
  isHiddenByDefault,
  nextStepFor,
  nextStepLabel,
  parseShowHidden,
  promiseState,
  summariseSuppliers,
} from "./admin-rules";
import { supplierForLine, supplierFromSku, suppliersOfOrder } from "./line-suppliers";
import { canTransition } from "./status";

describe("nextStepFor", () => {
  it("maps each open status to the obvious next action", () => {
    expect(nextStepFor("confirmed")).toEqual({ to: "paid", key: "mark_paid" });
    expect(nextStepFor("paid")).toEqual({ to: "sourcing", key: "start_sourcing" });
    expect(nextStepFor("sourcing")).toEqual({ to: "shipped", key: "mark_shipped" });
    expect(nextStepFor("shipped")).toEqual({ to: "delivered", key: "mark_delivered" });
  });
  it("cash on delivery skips paid", () => {
    expect(nextStepFor("confirmed", "cash_on_delivery")).toEqual({ to: "sourcing", key: "start_sourcing" });
    expect(nextStepFor("confirmed", "fawran")?.to).toBe("paid");
  });
  it("reads the pre-0053 names", () => {
    expect(nextStepFor("pending")?.to).toBe("paid");
    expect(nextStepFor("processing")?.to).toBe("shipped");
  });
  it("has no next step when the order is finished or unknown", () => {
    expect(nextStepFor("delivered")).toBeNull();
    expect(nextStepFor("cancelled")).toBeNull();
    expect(nextStepFor("nonsense")).toBeNull();
    expect(nextStepFor(null)).toBeNull();
  });
  it("is always a move the status rule allows", () => {
    for (const s of ["confirmed", "paid", "sourcing", "shipped", "pending", "processing"]) {
      for (const m of [null, "cash_on_delivery", "bank_transfer"]) {
        const step = nextStepFor(s, m);
        expect(step).not.toBeNull();
        expect(canTransition(s, step!.to)).toBe(true);
      }
    }
  });
});

describe("summariseSuppliers", () => {
  it("none, one or two names, many", () => {
    expect(summariseSuppliers([])).toEqual({ kind: "none" });
    expect(summariseSuppliers(["Voltaat", "Voltaat"])).toEqual({ kind: "names", names: ["Voltaat"] });
    expect(summariseSuppliers(["Voltaat", "Mouser"])).toEqual({ kind: "names", names: ["Voltaat", "Mouser"] });
    expect(summariseSuppliers(["Voltaat", "Mouser", "DigiKey"])).toEqual({ kind: "many", count: 3 });
  });
});

describe("nextStepLabel", () => {
  const sourcing = nextStepFor("paid")!;
  it("Paid names the supplier of the order lines", () => {
    expect(nextStepLabel(sourcing, ["Voltaat"])).toEqual({ key: "start_sourcing_one", values: { a: "Voltaat" } });
    expect(nextStepLabel(sourcing, ["Voltaat", "Mouser"])).toEqual({ key: "start_sourcing_two", values: { a: "Voltaat", b: "Mouser" } });
    expect(nextStepLabel(sourcing, ["A", "B", "C"])).toEqual({ key: "start_sourcing_many", values: { count: 3 } });
    expect(nextStepLabel(sourcing, [])).toEqual({ key: "start_sourcing", values: {} });
  });
  it("other steps never name suppliers", () => {
    expect(nextStepLabel(nextStepFor("sourcing")!, ["Voltaat"])).toEqual({ key: "mark_shipped", values: {} });
  });
});

describe("canMarkTest / canCancel", () => {
  it("refuses paid and everything after it", () => {
    for (const s of ["paid", "sourcing", "shipped", "delivered", "processing"]) expect(canMarkTest(s)).toBe(false);
  });
  it("allows confirmed, legacy pending and cancelled", () => {
    for (const s of ["confirmed", "pending", "cancelled"]) expect(canMarkTest(s)).toBe(true);
  });
  it("refuses unknown statuses", () => {
    expect(canMarkTest("weird")).toBe(false);
    expect(canMarkTest(undefined)).toBe(false);
  });
  it("cancel is for open orders only", () => {
    expect(canCancel("confirmed")).toBe(true);
    expect(canCancel("paid")).toBe(true);
    expect(canCancel("delivered")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});

describe("default list filter", () => {
  const orders = [
    { id: "a", status: "confirmed", is_test: false },
    { id: "b", status: "confirmed", is_test: true },
    { id: "c", status: "cancelled", is_test: false },
    { id: "d", status: "delivered", is_test: null },
    { id: "e", status: "paid" },
  ];
  it("hides test and cancelled by default", () => {
    expect(isHiddenByDefault(orders[1])).toBe(true);
    expect(isHiddenByDefault(orders[2])).toBe(true);
    expect(isHiddenByDefault(orders[3])).toBe(false);
    expect(filterVisible(orders, false).map((o) => o.id)).toEqual(["a", "d", "e"]);
  });
  it("shows everything with the toggle", () => {
    expect(filterVisible(orders, true)).toHaveLength(5);
  });
  it("the URL toggle is ?show=all only", () => {
    expect(parseShowHidden(undefined)).toBe(false);
    expect(parseShowHidden("")).toBe(false);
    expect(parseShowHidden("1")).toBe(false);
    expect(parseShowHidden("all")).toBe(true);
    expect(parseShowHidden(["all", "x"])).toBe(true);
  });
});

describe("promiseState", () => {
  it("compares the promised date with today", () => {
    expect(promiseState("2026-10-15", "2026-10-11", "paid")).toEqual({ kind: "later", days: 4 });
    expect(promiseState("2026-10-11", "2026-10-11", "paid")).toEqual({ kind: "today" });
    expect(promiseState("2026-10-09", "2026-10-11", "sourcing")).toEqual({ kind: "late", days: 2 });
  });
  it("counts across month and year ends", () => {
    expect(promiseState("2027-01-02", "2026-12-30", "confirmed")).toEqual({ kind: "later", days: 3 });
  });
  it("ignores the date once the order is closed", () => {
    expect(promiseState("2026-10-01", "2026-10-11", "delivered")).toEqual({ kind: "closed" });
    expect(promiseState("2026-10-01", "2026-10-11", "cancelled")).toEqual({ kind: "closed" });
  });
  it("no date, no state", () => {
    expect(promiseState(null, "2026-10-11", "paid")).toEqual({ kind: "none" });
    expect(promiseState("garbage", "2026-10-11", "paid")).toEqual({ kind: "none" });
  });
});

describe("line suppliers", () => {
  const voltaat = { code: "voltaat", name: "Voltaat" };
  const mouser = { code: "mouser", name: "Mouser" };
  it("SKU prefix fallback", () => {
    expect(supplierFromSku("VLT-123")).toEqual(voltaat);
    expect(supplierFromSku("ms-9")).toEqual(mouser);
    expect(supplierFromSku("GR-001")).toBeNull();
    expect(supplierFromSku(null)).toBeNull();
  });
  it("preferred offer, then any active offer, then the prefix", () => {
    const offers = [
      { id: "o1", active: false, supplier: mouser },
      { id: "o2", active: true, supplier: voltaat },
    ];
    expect(supplierForLine({ sku: "X", preferredOfferId: "o1", offers })).toEqual(mouser);
    expect(supplierForLine({ sku: "X", preferredOfferId: null, offers })).toEqual(voltaat);
    expect(supplierForLine({ sku: "MS-1", offers: [] })).toEqual(mouser);
    expect(supplierForLine({ sku: "GR-1", offers: [] })).toBeNull();
  });
  it("distinct suppliers in first-seen order", () => {
    const list = suppliersOfOrder([{ supplier: mouser }, { supplier: null }, { supplier: voltaat }, { supplier: mouser }]);
    expect(list.map((s) => s.code)).toEqual(["mouser", "voltaat"]);
  });
});
