// The checkout's money, as pure functions (R6). The database is the authority
// — create_part_order charges the delivery and redeem_credits applies the
// credit — and these mirror it so the page shows the same figures before the
// order exists. Delivery rules themselves live in lib/store/shipping.ts.

import { SHIPPING_TIERS, type DeliveryQuote, type ShippingTier } from "@/lib/store/delivery";
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

// ── Which tiers are shown (F-014) ────────────────────────────────────────────
// Display only: the quote, the order and the database keep every tier. When two
// tiers cost the same the customer is offered only the faster one, so a slower
// tier is never sold for the same money. A hidden tier is not submittable from
// the page; an order already placed on one still renders (the order pages and
// emails print the stored tier key).

export type PricedTier = { tier: ShippingTier; priceQar: number; date: string | null };

/** Priced, dated tiers the quote offers, in express > standard > economy order. */
export function pricedTiers(quote: CheckoutQuote | null, goodsQar: number, split: boolean): PricedTier[] {
  if (!quote) return [];
  return SHIPPING_TIERS.filter((k) => quote.tiers[k]).map((k) => ({
    tier: k,
    priceQar: tierPrice(quote, k, goodsQar, split).shippingQar,
    date: quote.tiers[k]?.date ?? null,
  }));
}

/** Earlier arrival wins; no date is the slowest; a tie goes to the earlier tier in SHIPPING_TIERS. */
function isFaster(a: PricedTier, b: PricedTier): boolean {
  if (a.date !== b.date) return a.date !== null && (b.date === null || a.date < b.date);
  return SHIPPING_TIERS.indexOf(a.tier) < SHIPPING_TIERS.indexOf(b.tier);
}

/**
 * The tiers to show: of the tiers with the same price only the fastest stays
 * (earliest arrival date). Original order is kept; never empty unless the
 * input is.
 */
export function displayedTiers<T extends PricedTier>(tiers: readonly T[]): T[] {
  const fastest = new Map<number, T>();
  for (const t of tiers) {
    const key = round2(t.priceQar);
    const best = fastest.get(key);
    if (!best || isFaster(t, best)) fastest.set(key, t);
  }
  return tiers.filter((t) => fastest.get(round2(t.priceQar)) === t);
}

/**
 * The tier the page actually uses: the selected one if it is displayed, else
 * the displayed tier with the same price, else the first displayed. Falls back
 * to `selected` when nothing is displayed (quote not loaded yet).
 */
export function selectableTier(
  selected: ShippingTier,
  tiers: readonly PricedTier[],
  shown: readonly PricedTier[] = displayedTiers(tiers)
): ShippingTier {
  if (shown.some((t) => t.tier === selected)) return selected;
  const price = tiers.find((t) => t.tier === selected)?.priceQar;
  const same = price === undefined ? undefined : shown.find((t) => round2(t.priceQar) === round2(price));
  return (same ?? shown[0])?.tier ?? selected;
}
