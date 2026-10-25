import { describe, expect, it, vi } from "vitest";

import {
  checkoutBlocked,
  placeOrder,
  quoteOnRequestIds,
  readOrderFields,
  type PlaceOrderDeps,
  type PlaceOrderInput,
} from "@/lib/store/place-order";
import { LAST_ORDER_KEY } from "@/lib/parts/storage-keys";
import type { DeliveryQuote } from "@/lib/store/delivery";
import type { CartItem } from "@/lib/supabase/types";

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null } | "reject";

/** A fake Supabase client: answers each rpc from a per-function queue and records the calls. */
function fakeDeps(replies: Record<string, Reply[]> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const stored: Record<string, string> = {};
  const events: string[] = [];
  const deps: PlaceOrderDeps = {
    supabase: {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        events.push(`rpc:${fn}`);
        const queue = replies[fn] ?? [];
        const r = queue.length ? queue.shift()! : defaults[fn];
        if (r === "reject") return Promise.reject(new Error("network"));
        return Promise.resolve({ data: r?.data ?? null, error: r?.error ?? null });
      },
    },
    storage: () => ({
      setItem: (k: string, v: string) => {
        events.push("storage");
        stored[k] = v;
      },
    }),
    onPlacing: () => events.push("placing"),
    onCreditsApplied: () => events.push("creditsChanged"),
  };
  return { deps, calls, stored, events };
}

const defaults: Record<string, Reply> = {
  create_part_order: { data: "order-1" },
  redeem_credits: { data: 0 },
  set_order_payment_method: { data: null },
};

const PGRST202 = { error: { code: "PGRST202", message: "Could not find the function" } };

const tierQ = { carrier_cost_qar: 50, base_cost_qar: 50, transit_days: 2, date: "2026-10-27", early_date: "2026-10-24" };
const quote: DeliveryQuote = {
  tiers: { express: tierQ, standard: tierQ, economy: tierQ },
  handling_fee_qar: 0,
  held_by: "Servo",
  can_split: true,
  on_request: ["p2"],
};

const items: CartItem[] = [
  { partId: "p1", sku: "SKU1", name: "LED", nameAr: "ليد", unitPrice: 10, imageUrl: null, minOrderQty: 1, quantity: 3, leadTimeClass: "in_stock", kitId: "k1", projectId: "proj", bomLines: ["b1"] },
  { partId: "p2", sku: "SKU2", name: "Servo", nameAr: null, unitPrice: 40, imageUrl: null, minOrderQty: 1, quantity: 1, leadTimeClass: null },
];

const input = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  fields: {
    customerName: "Sara",
    customerPhone: "55123456",
    customerEmail: "sara@example.com",
    deliveryArea: "doha",
    deliveryNotes: "",
  },
  items,
  payMethod: "cash_on_delivery",
  tier: "standard",
  split: false,
  quote,
  legacy: false,
  quoteError: false,
  classOrderId: null,
  totals: { grandTotal: 120, creditQar: 0, shippingQar: 50, handlingQar: 0 },
  ...over,
});

const baseOrderArgs = {
  p_customer_name: "Sara",
  p_customer_phone: "55123456",
  p_customer_email: "sara@example.com",
  p_delivery_area: "doha",
  p_delivery_notes: null,
  p_items: [
    { part_id: "p1", quantity: 3, project_id: "proj", bom_lines: ["b1"], kit_id: "k1" },
    { part_id: "p2", quantity: 1, project_id: null, bom_lines: [], kit_id: null },
  ],
  p_shipping_tier: "standard",
  p_split: false,
};

describe("placeOrder — RPC sequence", () => {
  it("create_part_order (with payment method) → redeem_credits → set_order_payment_method → snapshot", async () => {
    const f = fakeDeps();
    const r = await placeOrder(f.deps, input());
    expect(r).toEqual({ ok: true, orderId: "order-1", placedTotal: 120, appliedQar: 0 });
    expect(f.calls).toEqual([
      { fn: "create_part_order", args: { ...baseOrderArgs, p_payment_method: "cash_on_delivery" } },
      { fn: "redeem_credits", args: { p_order: "order-1" } },
      { fn: "set_order_payment_method", args: { p_order: "order-1", p_method: "cash_on_delivery" } },
    ]);
    expect(f.events).toEqual([
      "placing",
      "rpc:create_part_order",
      "rpc:redeem_credits",
      "rpc:set_order_payment_method",
      "storage",
    ]);
    expect(JSON.parse(f.stored[LAST_ORDER_KEY])).toEqual({
      id: "order-1",
      customerName: "Sara",
      total: 120,
      shippingQar: 50,
      handlingQar: 0,
      tier: "standard",
      split: false,
      promisedDate: "2026-10-27",
      earlyDate: null,
      heldBy: "Servo",
      hasOnRequest: true,
      paymentMethod: "cash_on_delivery",
      items: [
        { sku: "SKU1", name: "LED", nameAr: "ليد", quantity: 3, unitPrice: 10, leadTimeClass: "in_stock", onRequest: false },
        { sku: "SKU2", name: "Servo", nameAr: null, quantity: 1, unitPrice: 40, leadTimeClass: null, onRequest: true },
      ],
    });
  });

  it("PGRST202 on the first call (pre-0044) retries without the payment method", async () => {
    const f = fakeDeps({ create_part_order: [PGRST202] });
    const r = await placeOrder(f.deps, input());
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.fn)).toEqual([
      "create_part_order",
      "create_part_order",
      "redeem_credits",
      "set_order_payment_method",
    ]);
    expect(f.calls[0].args).toEqual({ ...baseOrderArgs, p_payment_method: "cash_on_delivery" });
    expect(f.calls[1].args).toEqual(baseOrderArgs);
  });

  it("class order: drops p_class_id first (pre-0097), then the payment method (pre-0044)", async () => {
    const f = fakeDeps({ create_part_order: [PGRST202, PGRST202] });
    const r = await placeOrder(f.deps, input({ classOrderId: "class-9", tier: "economy" }));
    expect(r.ok).toBe(true);
    const args = { ...baseOrderArgs, p_shipping_tier: "economy" };
    expect(f.calls.slice(0, 3)).toEqual([
      { fn: "create_part_order", args: { ...args, p_payment_method: "cash_on_delivery", p_class_id: "class-9" } },
      { fn: "create_part_order", args: { ...args, p_payment_method: "cash_on_delivery" } },
      { fn: "create_part_order", args },
    ]);
  });

  it("class order that succeeds first time sends p_class_id once", async () => {
    const f = fakeDeps();
    await placeOrder(f.deps, input({ classOrderId: "class-9" }));
    expect(f.calls.filter((c) => c.fn === "create_part_order")).toHaveLength(1);
    expect(f.calls[0].args).toMatchObject({ p_class_id: "class-9" });
  });

  it("legacy database (pre-0029): no shipping, payment or class keys", async () => {
    const f = fakeDeps({ create_part_order: [PGRST202] });
    const r = await placeOrder(f.deps, input({ legacy: true, quote: null, classOrderId: "class-9" }));
    const legacyArgs: Record<string, unknown> = { ...baseOrderArgs };
    delete legacyArgs.p_shipping_tier;
    delete legacyArgs.p_split;
    // class id set: the 0097 fallback still repeats the same legacy call once.
    expect(f.calls.filter((c) => c.fn === "create_part_order").map((c) => c.args)).toEqual([legacyArgs, legacyArgs]);
    expect(r.ok).toBe(true);
  });

  it("split order records the early date", async () => {
    const f = fakeDeps();
    await placeOrder(f.deps, input({ split: true }));
    expect(f.calls[0].args).toMatchObject({ p_split: true });
    expect(JSON.parse(f.stored[LAST_ORDER_KEY])).toMatchObject({ split: true, earlyDate: "2026-10-24" });
  });

  it("applied credits change the placed total and fire onCreditsApplied before set_order_payment_method", async () => {
    const f = fakeDeps({ redeem_credits: [{ data: "12.5" }] });
    const r = await placeOrder(f.deps, input({ totals: { grandTotal: 107.5, creditQar: 12.5, shippingQar: 50, handlingQar: 0 } }));
    expect(r).toEqual({ ok: true, orderId: "order-1", placedTotal: 107.5, appliedQar: 12.5 });
    expect(f.events.indexOf("creditsChanged")).toBe(f.events.indexOf("rpc:redeem_credits") + 1);
    expect(f.events.indexOf("rpc:set_order_payment_method")).toBeGreaterThan(f.events.indexOf("creditsChanged"));
  });

  it("shown credit not applied by the server: total goes back up", async () => {
    const f = fakeDeps();
    const r = await placeOrder(f.deps, input({ totals: { grandTotal: 107.5, creditQar: 12.5, shippingQar: 50, handlingQar: 0 } }));
    expect(r).toMatchObject({ ok: true, placedTotal: 120, appliedQar: 0 });
    expect(f.events).not.toContain("creditsChanged");
  });

  it("redeem_credits / set_order_payment_method failing (pre-0042 / pre-0039) still places the order", async () => {
    const f = fakeDeps({ redeem_credits: ["reject"], set_order_payment_method: ["reject"] });
    const r = await placeOrder(f.deps, input());
    expect(r).toMatchObject({ ok: true, appliedQar: 0 });
    expect(f.stored[LAST_ORDER_KEY]).toBeDefined();
  });

  it("storage that throws is ignored", async () => {
    const f = fakeDeps();
    const r = await placeOrder({ ...f.deps, storage: () => { throw new Error("denied"); } }, input());
    expect(r.ok).toBe(true);
  });
});

describe("placeOrder — refusals", () => {
  const refused = async (message: string | undefined, data: unknown = null) => {
    const f = fakeDeps({ create_part_order: [{ data, error: message === undefined ? null : { code: "P0001", message } }] });
    const r = await placeOrder(f.deps, input());
    expect(f.calls.map((c) => c.fn)).toEqual(["create_part_order"]);
    expect(f.stored).toEqual({});
    return r;
  };

  it("maps server messages to the keys the page shows", async () => {
    expect(await refused("part X is available on request only")).toEqual({ ok: false, error: "cartBlocked" });
    expect(await refused("an email is required for bank transfer")).toEqual({ ok: false, error: "errorEmailBank" });
    expect(await refused("order total must be greater than zero")).toEqual({ ok: false, error: "errorTotalZero" });
    expect(await refused("too_many_orders")).toEqual({ ok: false, error: "errorTooManyOrders" });
    expect(await refused("quantity_too_large")).toEqual({ ok: false, error: "errorQtyCap" });
    expect(await refused("too_many_lines")).toEqual({ ok: false, error: "errorLineCap" });
    expect(await refused("boom")).toEqual({ ok: false, error: "errorSubmit" });
    // No error but no order id either.
    expect(await refused(undefined, null)).toEqual({ ok: false, error: "errorSubmit" });
  });
});

describe("placeOrder — validation (no RPC)", () => {
  const check = async (over: Partial<PlaceOrderInput>) => {
    const f = fakeDeps();
    const r = await placeOrder(f.deps, input(over));
    expect(f.calls).toEqual([]);
    expect(f.events).toEqual([]);
    return r.ok ? null : r.error;
  };
  const fields = input().fields;

  it("runs the checks in the page's order", async () => {
    expect(await check({ fields: { ...fields, customerName: "" } })).toBe("errorRequired");
    expect(await check({ fields: { ...fields, customerPhone: "" } })).toBe("errorRequired");
    expect(await check({ fields: { ...fields, deliveryArea: "" } })).toBe("errorRequired");
    expect(await check({ fields: { ...fields, customerPhone: "12" } })).toBe("phoneInvalid");
    expect(await check({ fields: { ...fields, customerEmail: "" }, payMethod: "bank_transfer" })).toBe("errorEmailBank");
    expect(await check({ fields: { ...fields, customerEmail: "nope" } })).toBe("errorEmailInvalid");
    expect(await check({ items: [] })).toBe("errorEmpty");
    expect(await check({ quote: null })).toBe("errorNoDate");
    expect(await check({ quote: null, quoteError: true })).toBe("quoteError");
    expect(await check({ quote: { ...quote, tiers: { express: tierQ } } })).toBe("errorNoDate");
    expect(await check({ totals: { grandTotal: 0, creditQar: 120, shippingQar: 0, handlingQar: 0 } })).toBe("errorTotalZero");
    // Required beats a bad phone, a bad phone beats a bad email.
    expect(await check({ fields: { ...fields, customerName: "", customerPhone: "12" } })).toBe("errorRequired");
    expect(await check({ fields: { ...fields, customerPhone: "12", customerEmail: "nope" } })).toBe("phoneInvalid");
  });

  it("legacy database is not blocked by a missing quote", async () => {
    const f = fakeDeps();
    const r = await placeOrder(f.deps, input({ legacy: true, quote: null }));
    expect(r.ok).toBe(true);
  });
});

describe("helpers", () => {
  it("readOrderFields trims and defaults to empty", () => {
    const form = new Map<string, unknown>([["customer_name", "  Sara "], ["delivery_notes", " gate 2 "]]);
    expect(readOrderFields(form)).toEqual({
      customerName: "Sara",
      customerPhone: "",
      customerEmail: "",
      deliveryArea: "",
      deliveryNotes: "gate 2",
    });
  });
  it("checkoutBlocked / quoteOnRequestIds", () => {
    expect(checkoutBlocked(null, "standard", true)).toBe(false);
    expect(checkoutBlocked(null, "standard", false)).toBe(true);
    expect(checkoutBlocked(quote, "standard", false)).toBe(false);
    expect(quoteOnRequestIds(null)).toBeNull();
    expect(quoteOnRequestIds({ ...quote, on_request: undefined as unknown as string[] })).toEqual([]);
  });
  it("onPlacing fires once validation passes, before the first RPC", async () => {
    const onPlacing = vi.fn();
    const f = fakeDeps();
    await placeOrder({ ...f.deps, onPlacing }, input());
    expect(onPlacing).toHaveBeenCalledOnce();
  });
});
