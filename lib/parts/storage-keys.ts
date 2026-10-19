// The browser storage keys of the Parts Store, on their own and import-free.
//
// lib/parts/cart.ts needs only CART_KEY, and the cart provider sits in the
// locale layout, so anything it reaches is in the first-load JS of every route.
// Taking the key from ./constants pulled in lib/orders/status.ts (the whole
// order status chain) for one string. ./constants re-exports both keys, so
// existing imports keep working.

/** localStorage key for the guest cart. */
export const CART_KEY = "gestaltung:cart";

/**
 * sessionStorage key holding a snapshot of the just-placed order, so the
 * (guest-safe) success page can render a summary without reading it back from
 * the DB — RLS hides a guest's own order rows.
 */
export const LAST_ORDER_KEY = "gestaltung:last-order";
