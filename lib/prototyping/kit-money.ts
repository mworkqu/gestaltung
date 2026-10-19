// The kit money rounding, on its own so the cart can have it without the BOM.
//
// components/parts/cart-provider.tsx sits in the locale layout, so whatever it
// imports is in the first-load JS of EVERY route. It needs one three-line
// function, kitDiscountQar; taking it from kit-plan.ts pulled in ./bom, and
// through it lib/store/attributes.ts, lib/store/pack.ts and
// lib/store/derive-attributes.ts - about 69 kB of source the home page never
// runs. Everything here is pure, has no imports and is safe on the client.

/** QAR rounded to the fils the cart shows. */
export const money = (n: number) => Math.round(n * 100) / 100;

/** The kit discount in QAR for a goods sum, rounded the way the cart rounds it. */
export function kitDiscountQar(goods: number, pct: number): number {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 90);
  return money((goods * p) / 100);
}
