// When /api/orders/confirmation may send an order's confirmation e-mail, and
// the claim-then-send step that keeps it to one mail per order. A guest cannot
// read their own order under RLS, so the route reads it with the service key;
// these rules are what stop the bare order id from being used to send mail
// twice or to someone long after checkout.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The order id alone must not trigger a mail once the order is older than this. */
export const CONFIRMATION_WINDOW_MS = 60 * 60 * 1000;

export type ConfirmationOrder = {
  customer_email?: string | null;
  confirmation_emailed_at?: string | null;
  created_at: string;
};

/**
 * True when the order has an address, has not been emailed yet and is at most
 * an hour old (exactly 60 minutes still counts).
 */
export function confirmationAllowed(order: ConfirmationOrder | null | undefined, now: Date | number): boolean {
  if (!order || !order.customer_email || order.confirmation_emailed_at) return false;
  const age = (typeof now === "number" ? now : now.getTime()) - new Date(order.created_at).getTime();
  return !(age > CONFIRMATION_WINDOW_MS);
}

/**
 * Stamp confirmation_emailed_at before sending, only while it is still null, so
 * of two concurrent calls exactly one gets true and sends.
 */
export async function claimConfirmation(db: SupabaseClient, orderId: string, now: Date): Promise<boolean> {
  const { data: claimed } = await db
    .from("part_orders")
    .update({ confirmation_emailed_at: now.toISOString() })
    .eq("id", orderId)
    .is("confirmation_emailed_at", null)
    .select("id");
  return !!claimed?.length;
}

/** The mail failed to send: clear the claim so a retry can send it. */
export async function releaseConfirmation(db: SupabaseClient, orderId: string): Promise<void> {
  await db.from("part_orders").update({ confirmation_emailed_at: null }).eq("id", orderId);
}
