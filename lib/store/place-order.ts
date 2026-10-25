// Placing a store order from the checkout form (R6), without React so the
// sequence is tested: validate → create_part_order (with its fallbacks for
// older databases) → redeem_credits → set_order_payment_method → the
// sessionStorage snapshot the guest-safe success page reads. The Supabase
// client and storage come in as parameters; the page keeps the UI wiring
// (submitting state, confirmation email, analytics, clearing the cart).

import type { PaymentMethod } from "@/lib/company";
import type { CartItem } from "@/lib/supabase/types";
import { isOnRequest, type DeliveryQuote, type ShippingTier } from "@/lib/store/delivery";
import { checkoutRpcError, validateCheckoutEmail } from "@/lib/store/checkout";
import { isZeroTotal, placedTotalQar } from "@/lib/store/checkout-totals";
import { isValidPhone } from "@/lib/phone";
import { LAST_ORDER_KEY } from "@/lib/parts/storage-keys";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

export type PlaceOrderDeps = {
  /** The browser Supabase client (only .rpc is used). */
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
  /** window.sessionStorage, read inside a try (it can throw in privacy modes). */
  storage: () => Pick<Storage, "setItem">;
  /** Validation passed; the first RPC is about to go out. */
  onPlacing?: () => void;
  /** redeem_credits applied something (the page refreshes balances). */
  onCreditsApplied?: () => void;
};

/**
 * Message keys, as the page shows them: Checkout.* unless noted; the two
 * email ones go under the email field.
 */
export type PlaceOrderError =
  | "errorRequired"
  | "phoneInvalid" // Phone.invalid
  | "errorEmailBank"
  | "errorEmailInvalid"
  | "errorEmpty"
  | "quoteError" // Delivery.quoteError
  | "errorNoDate" // Delivery.errorNoDate
  | "errorTotalZero"
  | "cartBlocked" // Delivery.cartBlocked
  | "errorTooManyOrders" // 0103: hourly cap per phone / email
  | "errorQtyCap" // 0103: more than 1000 units on a line
  | "errorLineCap" // 0103: more than 100 lines
  | "errorSubmit";

export const EMAIL_FIELD_ERRORS: readonly PlaceOrderError[] = ["errorEmailBank", "errorEmailInvalid"];

export type PlaceOrderFields = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryArea: string;
  deliveryNotes: string;
};

export type PlaceOrderInput = {
  fields: PlaceOrderFields;
  items: CartItem[];
  payMethod: PaymentMethod;
  tier: ShippingTier;
  /** Split chosen and allowed (checkoutTotals().doSplit). */
  split: boolean;
  quote: DeliveryQuote | null;
  /** The database predates 0029 (no delivery quote). */
  legacy: boolean;
  quoteError: boolean;
  /** 3e: a teacher's class order. */
  classOrderId: string | null;
  totals: { grandTotal: number; creditQar: number; shippingQar: number; handlingQar: number };
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; placedTotal: number; appliedQar: number }
  | { ok: false; error: PlaceOrderError };

/** "Available on request" ids from the quote; null before it loads (lead time decides then). */
export function quoteOnRequestIds(quote: DeliveryQuote | null): string[] | null {
  return quote ? quote.on_request ?? [] : null;
}

/** Checkout cannot go ahead without a dated quote for the chosen tier (unless pre-0029). */
export function checkoutBlocked(quote: DeliveryQuote | null, tier: ShippingTier, legacy: boolean): boolean {
  return !legacy && (!quote || !quote.tiers[tier]);
}

/** The form checks, in the order the page runs them. */
export function validateOrder(input: PlaceOrderInput): PlaceOrderError | null {
  const f = input.fields;
  if (!f.customerName || !f.customerPhone || !f.deliveryArea) return "errorRequired";
  if (!isValidPhone(f.customerPhone)) return "phoneInvalid";
  const emailProblem = validateCheckoutEmail(f.customerEmail, input.payMethod);
  if (emailProblem) return emailProblem === "emailRequiredBank" ? "errorEmailBank" : "errorEmailInvalid";
  if (input.items.length === 0) return "errorEmpty";
  if (checkoutBlocked(input.quote, input.tier, input.legacy)) return input.quoteError ? "quoteError" : "errorNoDate";
  if (isZeroTotal(input.totals.grandTotal)) return "errorTotalZero";
  return null;
}

/** Trimmed form values (FormData → strings). */
export function readOrderFields(form: { get(name: string): unknown }): PlaceOrderFields {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    customerName: s("customer_name"),
    customerPhone: s("customer_phone"),
    customerEmail: s("customer_email"),
    deliveryArea: s("delivery_area"),
    deliveryNotes: s("delivery_notes"),
  };
}

/** create_part_order's arguments; `shipping` null before migration 0029 (no such parameters). */
function orderRpcArgs(
  fields: PlaceOrderFields,
  items: CartItem[],
  shipping: { tier: ShippingTier; split: boolean } | null
) {
  return {
    p_customer_name: fields.customerName,
    p_customer_phone: fields.customerPhone,
    p_customer_email: fields.customerEmail || null,
    p_delivery_area: fields.deliveryArea,
    p_delivery_notes: fields.deliveryNotes || null,
    // Project, BOM lines and kit let the server price kits and mark the
    // project's lines bought (0025); older databases ignore the extra keys.
    p_items: items.map((i) => ({
      part_id: i.partId,
      quantity: i.quantity,
      project_id: i.projectId ?? null,
      bom_lines: i.bomLines ?? [],
      kit_id: i.kitId ?? null,
    })),
    ...(shipping ? { p_shipping_tier: shipping.tier, p_split: shipping.split } : {}),
  };
}

/** A create_part_order refusal → the page's message key. */
function refusalError(message: string | undefined): PlaceOrderError {
  // A database without 0032 still refuses on-request items; 0044 refuses a
  // bank transfer without an email and an order with nothing to pay.
  const key = checkoutRpcError(message);
  if (key === "emailRequiredBank") return "errorEmailBank";
  if (key === "cartBlocked") return "cartBlocked";
  if (key === "totalZero") return "errorTotalZero";
  if (key === "errorTooManyOrders" || key === "errorQtyCap" || key === "errorLineCap") return key;
  return "errorSubmit";
}

/** What the success page reads from sessionStorage (LAST_ORDER_KEY). */
export function orderSnapshot(input: PlaceOrderInput, orderId: string, placedTotal: number) {
  const { fields, items, payMethod, tier, split, quote, totals } = input;
  const onRequestIds = quoteOnRequestIds(quote);
  const toConfirm = (i: CartItem) => isOnRequest(i, onRequestIds);
  const chosen = quote?.tiers[tier];
  return {
    id: orderId,
    customerName: fields.customerName,
    total: placedTotal,
    shippingQar: totals.shippingQar,
    handlingQar: totals.handlingQar,
    tier,
    split,
    promisedDate: chosen?.date ?? null,
    earlyDate: split ? chosen?.early_date ?? null : null,
    heldBy: quote?.held_by ?? null,
    hasOnRequest: items.some(toConfirm),
    paymentMethod: payMethod,
    items: items.map((i) => ({
      sku: i.sku,
      name: i.name,
      nameAr: i.nameAr,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      leadTimeClass: i.leadTimeClass ?? null,
      onRequest: toConfirm(i),
    })),
  };
}

export async function placeOrder(deps: PlaceOrderDeps, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const invalid = validateOrder(input);
  if (invalid) return { ok: false, error: invalid };

  const { fields, items, payMethod, tier, split, legacy, classOrderId, totals } = input;
  const { supabase } = deps;
  deps.onPlacing?.();

  const orderArgs = orderRpcArgs(fields, items, legacy ? null : { tier, split });
  // 3e: only sent for a class order, so a normal checkout is byte-for-byte
  // the call it was before.
  const classArgs = !legacy && classOrderId ? { p_class_id: classOrderId } : {};
  // The payment method goes in with the order (0044) so a bank transfer
  // without an email is refused before any order exists. A database
  // without 0044 has no such parameter (PGRST202): place it without.
  let { data, error: rpcError } = await supabase.rpc(
    "create_part_order",
    legacy ? orderArgs : { ...orderArgs, p_payment_method: payMethod, ...classArgs }
  );
  // A database without migration 0097 has no p_class_id: place the order
  // without the class link (delivery is then charged at the normal price).
  if (rpcError?.code === "PGRST202" && classOrderId) {
    ({ data, error: rpcError } = await supabase.rpc(
      "create_part_order",
      legacy ? orderArgs : { ...orderArgs, p_payment_method: payMethod }
    ));
  }
  if (rpcError?.code === "PGRST202" && !legacy) {
    ({ data, error: rpcError } = await supabase.rpc("create_part_order", orderArgs));
  }

  if (rpcError || !data) {
    return { ok: false, error: refusalError(rpcError?.message) };
  }

  const orderId = data as string;

  // Apply redeemable AI credits to this order (0042). The server decides the
  // amount; before 0042 the call fails and nothing is applied.
  const { data: applied } = await supabase.rpc("redeem_credits", { p_order: orderId }).then(
    (r) => r,
    () => ({ data: 0 })
  );
  const appliedQar = Number(applied) || 0;
  const placedTotal = placedTotalQar(totals.grandTotal, totals.creditQar, appliedQar);
  if (appliedQar > 0) deps.onCreditsApplied?.();

  // Record how they'll pay (0039). Since 0044 create_part_order has already
  // stored it and this is a no-op; before 0039 the call fails and the order
  // simply has no method; the success page still shows the choice.
  await supabase.rpc("set_order_payment_method", { p_order: orderId, p_method: payMethod }).then(
    () => {},
    () => {}
  );

  // Snapshot the order for the (guest-safe) success page — a guest can't read
  // their own order back through RLS.
  try {
    deps.storage().setItem(LAST_ORDER_KEY, JSON.stringify(orderSnapshot(input, orderId, placedTotal)));
  } catch {
    // sessionStorage unavailable — the success page falls back gracefully.
  }

  return { ok: true, orderId, placedTotal, appliedQar };
}
