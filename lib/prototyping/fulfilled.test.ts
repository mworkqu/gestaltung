import { describe, expect, it } from "vitest";

import { fulfilledLabel, fulfilledOrderIds, orderRef } from "./fulfilled";

const OID = "b8ccfccb-1d30-4eeb-b33c-41a78692cadc";
const marker = { orderId: OID, at: "2026-09-26T00:00:00Z", productId: "p1", sku: "T-1", quantity: 1 };

describe("orderRef", () => {
  it("is the first 8 characters", () => expect(orderRef(OID)).toBe("b8ccfccb"));
});

describe("fulfilledOrderIds", () => {
  it("collects distinct order ids and skips lines without one", () => {
    expect(
      fulfilledOrderIds([
        { fulfilled: marker },
        { fulfilled: null },
        {},
        { fulfilled: { ...marker, sku: "T-2" } },
        { fulfilled: { sku: "legacy" } },
        { fulfilled: { ...marker, orderId: "other" } },
      ])
    ).toEqual([OID, "other"]);
  });
});

describe("fulfilledLabel", () => {
  const statuses = (s: string) => new Map([[OID, s]]);

  it("is null for a line that is not fulfilled", () => {
    expect(fulfilledLabel(null, statuses("pending"))).toBeNull();
    expect(fulfilledLabel(undefined, null)).toBeNull();
  });

  it("shows the order ref and status", () => {
    expect(fulfilledLabel(marker, statuses("shipped"))).toEqual({ kind: "ordered", ref: "b8ccfccb", status: "shipped" });
    expect(fulfilledLabel(marker, statuses("cancelled"))).toEqual({ kind: "ordered", ref: "b8ccfccb", status: "cancelled" });
  });

  it("says delivered when the order is delivered", () => {
    expect(fulfilledLabel(marker, statuses("delivered"))).toEqual({ kind: "delivered", ref: "b8ccfccb" });
  });

  it("falls back to the plain label", () => {
    // legacy marker without an order id
    expect(fulfilledLabel({ sku: "T-1", quantity: 1 }, statuses("shipped"))).toEqual({ kind: "bought" });
    // status lookup failed
    expect(fulfilledLabel(marker, null)).toEqual({ kind: "bought" });
    // order not returned (not visible / deleted)
    expect(fulfilledLabel(marker, new Map())).toEqual({ kind: "bought" });
    // unknown status value
    expect(fulfilledLabel(marker, statuses("lost"))).toEqual({ kind: "bought" });
  });
});
