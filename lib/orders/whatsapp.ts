import type { SupabaseClient } from "@supabase/supabase-js";

// "Confirmation sent on WhatsApp" flag on an order (part_orders.whatsapp_sent).
//
// Today the owner ticks it by hand after messaging the customer
// (toggleWhatsappSent). There is NO WhatsApp auto-send module in the code yet.
// When one exists, call markWhatsappSent(db, orderId) from it right after a
// message is accepted by the provider and the box ticks itself; nothing else
// in the UI has to change. Server only; `db` is a Supabase client that may
// update part_orders (super admin cookie client, or the service client).

type Db = SupabaseClient;

export async function setWhatsappSent(db: Db, orderId: string, sent: boolean): Promise<boolean> {
  const { error } = await db.from("part_orders").update({ whatsapp_sent: sent }).eq("id", orderId);
  if (error) {
    console.error(`[orders] whatsapp_sent ${orderId} -> ${sent}: ${error.message ?? "failed"}`);
    return false;
  }
  return true;
}

/** Hook for the future auto-send module: the confirmation went out, tick the box. */
export function markWhatsappSent(db: Db, orderId: string): Promise<boolean> {
  return setWhatsappSent(db, orderId, true);
}
