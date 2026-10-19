// How long each supplier takes to reach us, in days (owner, 2026-10-19).
// ONE place, because the same numbers are written by the Voltaat sync, the
// Voltaat catalogue import, the DigiKey and Mouser adapters and the Fix
// list's "set delivery time" action.
//
//   own stock   next day   — it is already on the shelf in Lusail
//   Voltaat     2 days     — local, but it still has to come to us
//   DigiKey     2 weeks    — ordered and flown in
//   Mouser      2 weeks    — same
//
// These are OUR lead times, not the supplier's own promise: a DigiKey part
// that is in their warehouse today still takes two weeks to reach a customer
// here. They feed supplier_offers.lead_time_days, which 0028 turns into the
// lead class the storefront shows (<= 2 days = "In stock", <= 14 = "1-2 weeks").
// Keep each value inside the class band you want the customer to see.

/** suppliers.code of our own shelf in Lusail. */
export const OWN_STOCK_SUPPLIER = "own_stock";

export const SUPPLIER_LEAD_DAYS = {
  own_stock: 1,
  voltaat: 2,
  digikey: 14,
  mouser: 14,
} as const;

/** The running order 0095 writes into suppliers.rank; lower is offered first. */
export const SUPPLIER_RANK = {
  own_stock: 10,
  voltaat: 20,
  digikey: 30,
  mouser: 40,
  alibaba: 70,
  aliexpress: 70,
} as const;

/** Rank of a supplier code; an unknown supplier sits after the named ones. */
export function supplierRank(code: string | null | undefined): number {
  const c = String(code ?? "").toLowerCase();
  return (SUPPLIER_RANK as Record<string, number>)[c] ?? 50;
}

/** Our lead time for a supplier code, or null when we have no rule for it. */
export function supplierLeadDays(code: string | null | undefined): number | null {
  const c = String(code ?? "").toLowerCase();
  return (SUPPLIER_LEAD_DAYS as Record<string, number>)[c] ?? null;
}
