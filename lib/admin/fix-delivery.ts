// Server helpers for the Fix list (D1): give a product a delivery date by
// creating / updating ONE supplier offer, then run the same recompute the
// Sourcing panel relies on (public.refresh_part_sourcing, 0028; the offer
// trigger runs it too). Caller = a super_admin server action with the cookie
// client (RLS: suppliers / supplier_offers / parts writes are super admin only).

import type { createClient } from "@/lib/supabase/server";
import { cleanOffer } from "@/lib/store/offer-clean";
import { ON_REQUEST_KEY, OWN_STOCK_SUPPLIER_CODE, parseOnRequest } from "@/lib/admin/fix-groups";
import { readPartsAdmin } from "@/lib/store/part-columns";

type Db = Awaited<ReturnType<typeof createClient>>;

export type SupplierRef = { id: string; currency: string; own: boolean };

export type DeliveryResult = { ok: true } | { ok: false; reason: string };

/** The "Own stock in Lusail" supplier; created on first use (QAR, markup, no overhead). */
export async function ensureOwnStockSupplier(db: Db): Promise<SupplierRef | null> {
  const read = () =>
    db.from("suppliers").select("id, active, default_currency").eq("code", OWN_STOCK_SUPPLIER_CODE).maybeSingle();
  let { data, error } = await read();
  if (error) return null;
  if (!data) {
    const ins = await db.from("suppliers").insert({
      code: OWN_STOCK_SUPPLIER_CODE,
      name: "Own stock (Lusail)",
      default_pricing_mode: "markup",
      commission_percent: null,
      landed_overhead_pct: 0,
      default_currency: "QAR",
      active: true,
    });
    // 23505: created by a parallel call; read it back either way.
    if (ins.error && ins.error.code !== "23505") return null;
    ({ data, error } = await read());
    if (error || !data) return null;
  } else if (data.active === false) {
    const up = await db.from("suppliers").update({ active: true }).eq("id", data.id);
    if (up.error) return null;
  }
  return { id: String(data.id), currency: String(data.default_currency ?? "QAR"), own: true };
}

/** A supplier picked in the bulk bar / drawer (must exist). */
export async function supplierRef(db: Db, supplierId: string): Promise<SupplierRef | null> {
  const { data, error } = await db.from("suppliers").select("id, code, default_currency").eq("id", supplierId).maybeSingle();
  if (error || !data) return null;
  return { id: String(data.id), currency: String(data.default_currency ?? "USD"), own: data.code === OWN_STOCK_SUPPLIER_CODE };
}

async function leadClass(db: Db, partId: string): Promise<string | null | undefined> {
  const { data, error } = await db.from("parts").select("lead_time_class").eq("id", partId).maybeSingle();
  if (error || !data) return undefined;
  return (data as { lead_time_class: string | null }).lead_time_class;
}

/**
 * Create or update this supplier's offer for the product with `leadDays`
 * (active; own stock = in stock), recompute, and — when the rule still picks
 * nothing (e.g. a mirror-priced product and an offer with no retail price) —
 * pin the offer so its lead time is used. Fails with a reason, never throws.
 */
export async function setPartDelivery(
  db: Db,
  partId: string,
  supplier: SupplierRef,
  leadDays: number,
  opts: { cost?: number | null } = {}
): Promise<DeliveryResult> {
  const days = Math.max(0, Math.trunc(leadDays));
  const existing = await db
    .from("supplier_offers")
    .select("id, active")
    .eq("part_id", partId)
    .eq("supplier_id", supplier.id)
    .order("active", { ascending: false })
    .order("created_at")
    .limit(1);
  if (existing.error) return { ok: false, reason: "offerSave" };

  let offerId: string | null = existing.data?.[0]?.id ?? null;
  const cost = opts.cost ?? null;
  if (offerId) {
    const patch: Record<string, unknown> = {
      lead_time_days: days,
      active: true,
      last_checked_at: new Date().toISOString(),
    };
    if (supplier.own) patch.availability = "in_stock";
    if (cost !== null) {
      patch.cost = cost;
      patch.currency = supplier.currency;
    }
    const up = await db.from("supplier_offers").update(patch).eq("id", offerId).eq("part_id", partId);
    if (up.error) return { ok: false, reason: "offerSave" };
  } else {
    const row = cleanOffer({
      supplier_id: supplier.id,
      cost,
      currency: supplier.currency,
      availability: supplier.own ? "in_stock" : "unknown",
      lead_time_days: days,
      active: true,
    });
    const ins = await db.from("supplier_offers").insert({ ...row, part_id: partId }).select("id").maybeSingle();
    if (ins.error || !ins.data) return { ok: false, reason: "offerSave" };
    offerId = String(ins.data.id);
  }

  // The offer trigger already re-derived the product; run it once more on
  // purpose (cheap, and the explicit "recompute" the owner asked for).
  const rpc = await db.rpc("refresh_part_sourcing", { p_part_id: partId });
  if (rpc.error) return { ok: false, reason: "recompute" };

  const cls = await leadClass(db, partId);
  if (cls === undefined) return { ok: false, reason: "recompute" };
  if (cls) return { ok: true };

  const pin = await db.from("parts").update({ pinned_offer_id: offerId }).eq("id", partId);
  if (pin.error) return { ok: false, reason: "recompute" };
  const after = await leadClass(db, partId);
  return after ? { ok: true } : { ok: false, reason: "stillMissing" };
}

/**
 * The shelf is empty again: keep this supplier's offer but mark it
 * unavailable, so the ranked rule (in stock first) falls back to Voltaat or
 * DigiKey instead of promising next day from an empty shelf.
 *
 * Nothing is deleted — the cost, SKU and link stay for the next delivery, and
 * refilling the count only flips availability back. A pin on that offer WOULD
 * beat availability (0095 picks a pinned active offer outright), so a pin on
 * this very offer is cleared as well; any other pin is left alone.
 *
 * `parked` is false when there was no offer to park (nothing to do).
 */
export async function parkSupplierOffer(
  db: Db,
  partId: string,
  supplier: SupplierRef
): Promise<{ ok: true; parked: boolean } | { ok: false; reason: string }> {
  const existing = await db
    .from("supplier_offers")
    .select("id")
    .eq("part_id", partId)
    .eq("supplier_id", supplier.id)
    .eq("active", true)
    .order("created_at")
    .limit(1);
  if (existing.error) return { ok: false, reason: "offerSave" };
  const offerId: string | null = existing.data?.[0]?.id ?? null;
  if (!offerId) return { ok: true, parked: false };

  const up = await db
    .from("supplier_offers")
    .update({ availability: "unavailable", last_checked_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("part_id", partId);
  if (up.error) return { ok: false, reason: "offerSave" };

  // pinned_offer_id is not readable by sessions (0105), so it cannot be a
  // filter of the update: read it through the admin view, then clear by id.
  const pinned = await readPartsAdmin((t) => db.from(t).select("pinned_offer_id").eq("id", partId).maybeSingle());
  if (pinned.error) return { ok: false, reason: "recompute" };
  if ((pinned.data as { pinned_offer_id?: string | null } | null)?.pinned_offer_id === offerId) {
    const unpin = await db.from("parts").update({ pinned_offer_id: null }).eq("id", partId);
    if (unpin.error) return { ok: false, reason: "recompute" };
  }

  const rpc = await db.rpc("refresh_part_sourcing", { p_part_id: partId });
  if (rpc.error) return { ok: false, reason: "recompute" };
  return { ok: true, parked: true };
}

/** Add / remove part ids on the "on request" list (store_settings). */
export async function updateOnRequest(db: Db, change: { add?: string[]; remove?: string[] }): Promise<boolean> {
  const { data, error } = await db.from("store_settings").select("value").eq("key", ON_REQUEST_KEY).maybeSingle();
  if (error) return false;
  const ids = parseOnRequest(data?.value);
  const before = ids.size;
  for (const id of change.add ?? []) ids.add(id);
  let removed = false;
  for (const id of change.remove ?? []) removed = ids.delete(id) || removed;
  if (ids.size === before && !removed && data) return true;
  const up = await db
    .from("store_settings")
    .upsert({ key: ON_REQUEST_KEY, value: { ids: [...ids].sort() }, updated_at: new Date().toISOString() });
  return !up.error;
}

/** Run `fn` over items, at most `limit` at a time, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
