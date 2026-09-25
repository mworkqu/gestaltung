import { describe, expect, it } from "vitest";

import { deriveItemStatus, deriveProjectStatus, shortOrderId } from "./item-status";

const P = "prod-1";
const ORDER_A = "aaaaaaaa-1111-2222-3333-444444444444";
const ORDER_B = "bbbbbbbb-1111-2222-3333-444444444444";

const item = (quantity: number, qty_from_inventory = 0) => ({
  product_id: P,
  quantity,
  qty_from_inventory,
});

describe("deriveItemStatus", () => {
  it("in cart when a project cart line holds it and nothing is ordered", () => {
    const s = deriveItemStatus({
      item: item(2),
      cartRows: [{ product_id: P, quantity: 2 }],
      orderLines: [],
    });
    expect(s.kind).toBe("in_cart");
    expect(s.cartQty).toBe(2);
    expect(s.orderId).toBeUndefined();
  });

  it("ordered with a pending order, carrying the short id and status", () => {
    const s = deriveItemStatus({
      // 0027: the bought unit is added to quantity and qty_from_inventory.
      item: item(1, 1),
      cartRows: [],
      orderLines: [{ part_id: P, quantity: 1, order: { id: ORDER_A, status: "pending" } }],
    });
    expect(s.kind).toBe("ordered");
    expect(s.orderId).toBe(ORDER_A);
    expect(s.orderStatus).toBe("pending");
    expect(s.shortId).toBe("aaaaaaaa");
    expect(s.orderedQty).toBe(1);
    // Bought units are not "yours from the shelf".
    expect(s.shelfQty).toBe(0);
  });

  it("delivered when every live order is delivered", () => {
    const s = deriveItemStatus({
      item: item(3, 3),
      cartRows: [],
      orderLines: [
        { part_id: P, quantity: 1, order: { id: ORDER_A, status: "delivered" } },
        { part_id: P, quantity: 2, order: { id: ORDER_B, status: "delivered" } },
      ],
    });
    expect(s.kind).toBe("delivered");
    expect(s.orderedQty).toBe(3);
  });

  it("stays ordered while one of its orders is still open", () => {
    const s = deriveItemStatus({
      item: item(2, 2),
      cartRows: [],
      orderLines: [
        { part_id: P, quantity: 1, order: { id: ORDER_A, status: "delivered" } },
        { part_id: P, quantity: 1, order: { id: ORDER_B, status: "shipped" } },
      ],
    });
    expect(s.kind).toBe("ordered");
    expect(s.orderId).toBe(ORDER_B);
    expect(s.orderStatus).toBe("shipped");
  });

  it("picks the newest open order when there are several", () => {
    const s = deriveItemStatus({
      item: item(2, 2),
      cartRows: [],
      orderLines: [
        { part_id: P, quantity: 1, order: { id: ORDER_B, status: "pending", created_at: "2026-09-01T00:00:00Z" } },
        { part_id: P, quantity: 1, order: { id: ORDER_A, status: "confirmed", created_at: "2026-09-20T00:00:00Z" } },
      ],
    });
    expect(s.orderId).toBe(ORDER_A);
  });

  it("to buy when units are missing and there is no cart line or order", () => {
    const s = deriveItemStatus({ item: item(4, 1), cartRows: [], orderLines: [] });
    expect(s.kind).toBe("to_buy");
    expect(s.shelfQty).toBe(1);
  });

  it("bought in part (rest still in the cart) counts as ordered", () => {
    const s = deriveItemStatus({
      item: item(3, 1),
      cartRows: [{ product_id: P, quantity: 2 }],
      orderLines: [{ part_id: P, quantity: 1, order: { id: ORDER_A, status: "confirmed" } }],
    });
    expect(s.kind).toBe("ordered");
    expect(s.cartQty).toBe(2);
    expect(s.orderedQty).toBe(1);
  });

  it("ignores cancelled orders", () => {
    const s = deriveItemStatus({
      item: item(1),
      cartRows: [],
      orderLines: [{ part_id: P, quantity: 1, order: { id: ORDER_A, status: "cancelled" } }],
    });
    expect(s.kind).toBe("to_buy");
    expect(s.orderedQty).toBe(0);
  });

  it("ignores rows for other products and unreadable orders", () => {
    const s = deriveItemStatus({
      item: item(1),
      cartRows: [{ product_id: "other", quantity: 5 }],
      orderLines: [
        { part_id: "other", quantity: 1, order: { id: ORDER_A, status: "pending" } },
        { part_id: P, quantity: 1, order: null },
      ],
    });
    expect(s.kind).toBe("to_buy");
  });

  it("yours when every unit came off the client's own shelf", () => {
    const s = deriveItemStatus({ item: item(2, 2), cartRows: [], orderLines: [] });
    expect(s.kind).toBe("yours");
    expect(s.shelfQty).toBe(2);
    expect(s.missingQty).toBe(0);
  });
});

describe("deriveItemStatus — missingQty", () => {
  it("delivered but still short: 5 needed, 2 delivered, none in cart → 3 missing", () => {
    const s = deriveItemStatus({
      item: item(5, 2),
      cartRows: [],
      orderLines: [{ part_id: P, quantity: 2, order: { id: ORDER_A, status: "delivered" } }],
    });
    expect(s.kind).toBe("delivered");
    expect(s.missingQty).toBe(3);
  });

  it("ordered, part in cart, rest missing", () => {
    const s = deriveItemStatus({
      item: item(6, 1),
      cartRows: [{ product_id: P, quantity: 2 }],
      orderLines: [{ part_id: P, quantity: 1, order: { id: ORDER_A, status: "pending" } }],
    });
    expect(s.kind).toBe("ordered");
    expect(s.missingQty).toBe(3);
  });

  it("in cart for the whole shortfall → nothing missing", () => {
    const s = deriveItemStatus({
      item: item(3, 1),
      cartRows: [{ product_id: P, quantity: 2 }],
      orderLines: [],
    });
    expect(s.kind).toBe("in_cart");
    expect(s.missingQty).toBe(0);
  });

  it("to buy equals the shortfall", () => {
    const s = deriveItemStatus({ item: item(4, 1), cartRows: [], orderLines: [] });
    expect(s.missingQty).toBe(3);
  });

  it("never negative when the cart holds more than the shortfall", () => {
    const s = deriveItemStatus({
      item: item(1),
      cartRows: [{ product_id: P, quantity: 5 }],
      orderLines: [],
    });
    expect(s.missingQty).toBe(0);
  });
});

describe("deriveProjectStatus", () => {
  it("ordered beats in cart beats planning", () => {
    expect(deriveProjectStatus({ hasLiveOrder: true, hasCartLine: true })).toBe("ordered");
    expect(deriveProjectStatus({ hasLiveOrder: false, hasCartLine: true })).toBe("in_cart");
    expect(deriveProjectStatus({ hasLiveOrder: false, hasCartLine: false })).toBe("planning");
  });
});

describe("shortOrderId", () => {
  it("keeps the first 8 characters", () => {
    expect(shortOrderId(ORDER_A)).toBe("aaaaaaaa");
  });
});
