// Writing "units on the shelf" for one product, without any knowledge of who
// is asking or where from.
//
// This is the body of the /dashboard/store/stock server action, lifted out so
// the phone and Mac dashboards reach own stock through the same code instead of
// a second, drifting copy of it. The caller does the authorisation (the website
// through the session, the mobile API through a bearer token) and any cache
// revalidation; everything that decides what actually happens to the product
// lives here.
//
// Behaviour is unchanged from the action it came from: above zero the product
// also gets the own-stock offer at 1 day, because a count alone does not make
// us the supplier; a mirror product is switched to 'markup' first, because 0095
// never lets our offer win for a mirror product; back at zero the offer is
// PARKED, never deleted.

import { ensureOwnStockSupplier, parkSupplierOffer, setPartDelivery } from "@/lib/admin/fix-delivery";
import { isMirror, parseShelfQty, shelfPlan } from "@/lib/admin/own-stock";
import { SUPPLIER_LEAD_DAYS } from "@/lib/sourcing/lead-times";
import type { createClient } from "@/lib/supabase/server";
import { readPartsAdmin } from "@/lib/store/part-columns";

type Db = Awaited<ReturnType<typeof createClient>>;

/** What happened to the own-stock offer beside the count. */
export type ShelfOffer = "added" | "parked" | "none" | "failed";

export type ShelfResult =
  | {
      ok: true;
      qty: number;
      offer: ShelfOffer;
      reason?: string;
      /** The shop price this product is now fixed at (it was following its supplier). */
      priceFixed?: number;
    }
  | { error: string };

/**
 * Set the counted units for one product and keep its own-stock offer in step.
 *
 * Returns `{ error }` for a bad id or quantity and for a failure before the
 * count is saved. Once the count is saved a later failure is reported as a
 * saved count with `offer: "failed"` and a `reason`, never as "nothing
 * happened".
 */
export async function applyShelfUnits(db: Db, partIdRaw: string, qtyRaw: string | number): Promise<ShelfResult> {
  const id = String(partIdRaw ?? "").trim();
  const qty = parseShelfQty(qtyRaw);
  if (!id || qty === null) return { error: "quantity" };

  // The pricing mode decides whether our offer can win at all, so it is read
  // here rather than trusted from the caller.
  const part = await readPartsAdmin((t) => db.from(t).select("pricing_mode, unit_price").eq("id", id).maybeSingle());
  if (part.error || !part.data) return { error: part.error?.message ?? "notFound" };

  const set = await db.rpc("set_own_stock", { p_part: id, p_qty: qty });
  if (set.error) return { error: set.error.message };

  // The count is saved from here on.
  const plan = shelfPlan(qty, { mirror: isMirror(part.data.pricing_mode as string | null) });
  const supplier = await ensureOwnStockSupplier(db);
  if (!supplier) return { ok: true, qty, offer: "failed", reason: "ownSupplier" };

  let priceFixed: number | undefined;
  if (plan.fixPrice) {
    // The price stops following the supplier here. unit_price is left exactly
    // as it is: markup mode writes it back unchanged, so nothing moves for a
    // customer at this moment.
    const up = await db.from("parts").update({ pricing_mode: "markup" }).eq("id", id);
    if (up.error) return { ok: true, qty, offer: "failed", reason: "priceMode" };
    priceFixed = Number(part.data.unit_price) || 0;
  }

  let offer: ShelfOffer;
  let reason: string | undefined;
  if (plan.giveOwnOffer) {
    const res = await setPartDelivery(db, id, supplier, SUPPLIER_LEAD_DAYS.own_stock);
    offer = res.ok ? "added" : "failed";
    if (!res.ok) reason = res.reason;
  } else {
    const res = await parkSupplierOffer(db, id, supplier);
    offer = res.ok ? (res.parked ? "parked" : "none") : "failed";
    if (!res.ok) reason = res.reason;
  }

  return { ok: true, qty, offer, ...(reason ? { reason } : {}), ...(priceFixed === undefined ? {} : { priceFixed }) };
}
