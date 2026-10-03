// Pure checkout decisions (site review Phase A), kept here so they are tested.

import { isPlausibleEmail } from "@/lib/store/shipping";

/**
 * /store/checkout with nothing to buy goes to the cart. `itemCount` null means
 * the count could not be read: let the page load (the client falls back to the
 * same redirect once the cart is read) rather than bounce a full cart.
 */
export function shouldRedirectEmptyCart(o: { hasSession: boolean; itemCount: number | null }): boolean {
  if (!o.hasSession) return true;
  return o.itemCount === 0;
}

export type CheckoutEmailError = "emailRequiredBank" | "emailInvalid";

/**
 * Bank transfer needs an email (the bank details are emailed, never shown on
 * the site). Any other method: email optional, but if given it must look real.
 */
export function validateCheckoutEmail(email: string, payMethod: string): CheckoutEmailError | null {
  const e = email.trim();
  if (!e) return payMethod === "bank_transfer" ? "emailRequiredBank" : null;
  return isPlausibleEmail(e) ? null : "emailInvalid";
}

/** Server refusals (create_part_order / set_order_payment_method) → message key. */
export type CheckoutRpcError = "cartBlocked" | "emailRequiredBank" | "totalZero" | "errorSubmit";

export function checkoutRpcError(message: string | null | undefined): CheckoutRpcError {
  const m = message ?? "";
  if (m.includes("available on request only")) return "cartBlocked";
  if (m.includes("email is required for bank transfer")) return "emailRequiredBank";
  if (m.includes("order total must be greater than zero")) return "totalZero";
  return "errorSubmit";
}
