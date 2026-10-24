// The checkout's money, as pure functions (R6). The database is the authority
// — create_part_order charges the delivery and redeem_credits applies the
// credit — and these mirror it so the page shows the same figures before the
// order exists. Delivery rules themselves live in lib/store/shipping.ts.

import type { DeliveryQuote, ShippingTier } from "@/lib/store/delivery";
import { shippingFor } from "@/lib/store/shipping";
import { round2 } from "@/lib/format/money";

export type CheckoutQuote = Pick<DeliveryQuote, "tiers" | "handling_fee_qar" | "free_shipping" | "can_split">;

export type TierPrice = { shippingQar: number; handlingQar: number; free: boolean };

/**
 * The goods subtotal free delivery is judged on: the server quote's (0044),
 * else the cart total (items less kit discount) before the quote has it.
 */
export function checkoutGoodsQar(quote: CheckoutQuote | null, cartTotalQar: number): number {
  return quote?.free_shipping?.goods_qar ?? cartTotalQar;
}

/** Shipping and handling for one tier; all 0 until the quote has loaded. */
export function tierPrice(
  quote: CheckoutQuote | null,
  tier: ShippingTier,
  goodsQar: number,
  split: boolean
): TierPrice {
  return quote
    ? shippingFor({
        tier,
        goodsQar,
        tiers: quote.tiers,
        handlingFeeQar: quote.handling_fee_qar,
        freeShipping: quote.free_shipping,
        split,
      })
    : { shippingQar: 0, handlingQar: 0, free: false };
}

/** Extra delivery cost of splitting into two shipments (0 when delivery is free). */
export function splitExtraQar(quote: CheckoutQuote | null, tier: ShippingTier, goodsQar: number): number {
  return quote
    ? shippingFor({ tier, goodsQar, tiers: quote.tiers, freeShipping: quote.free_shipping }).shippingQar
    : 0;
}

/**
 * AI credits spent in the last 30 days come back as one discount (0042),
 * capped at the goods subtotal. 0 without a credit summary.
 */
export function creditDiscountQar(
  credits: { redeemable_qar: number } | null | undefined,
  cartTotalQar: number
): number {
  return credits ? Math.min(credits.redeemable_qar, Math.max(cartTotalQar, 0)) : 0;
}

/** What the customer is asked to pay: goods - credit + shipping + handling. */
export function grandTotalQar(o: {
  cartTotalQar: number;
  creditQar: number;
  shippingQar: number;
  handlingQar: number;
}): number {
  return round2(o.cartTotalQar - o.creditQar + o.shippingQar + o.handlingQar);
}

/**
 * The total recorded for the success page once the order exists: the shown
 * credit is swapped for what redeem_credits actually applied.
 */
export function placedTotalQar(grandTotal: number, creditQar: number, appliedQar: number): number {
  return round2(grandTotal + creditQar - appliedQar);
}

/** Checkout refuses an order with nothing to pay (0044 refuses it too). */
export function isZeroTotal(grandTotal: number): boolean {
  return grandTotal <= 0;
}

export type CheckoutTotals = TierPrice & {
  canSplit: boolean;
  /** The split box is ticked and the quote allows it. */
  doSplit: boolean;
  goodsQar: number;
  splitExtraQar: number;
  creditQar: number;
  grandTotal: number;
  /** Price of any tier with the current split choice (the tier picker). */
  priceOf: (tier: ShippingTier) => TierPrice;
};

/** Everything the checkout page shows, from the cart, the quote and the choices. */
export function checkoutTotals(o: {
  quote: CheckoutQuote | null;
  /** useCart().totalQar: items at listed prices less the kit discount. */
  cartTotalQar: number;
  tier: ShippingTier;
  split: boolean;
  credits: { redeemable_qar: number } | null | undefined;
}): CheckoutTotals {
  const canSplit = Boolean(o.quote?.can_split);
  const doSplit = o.split && canSplit;
  const goodsQar = checkoutGoodsQar(o.quote, o.cartTotalQar);
  const priceOf = (k: ShippingTier) => tierPrice(o.quote, k, goodsQar, doSplit);
  const price = priceOf(o.tier);
  const creditQar = creditDiscountQar(o.credits, o.cartTotalQar);
  return {
    ...price,
    canSplit,
    doSplit,
    goodsQar,
    splitExtraQar: splitExtraQar(o.quote, o.tier, goodsQar),
    creditQar,
    grandTotal: grandTotalQar({
      cartTotalQar: o.cartTotalQar,
      creditQar,
      shippingQar: price.shippingQar,
      handlingQar: price.handlingQar,
    }),
    priceOf,
  };
}
