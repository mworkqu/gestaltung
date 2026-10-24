"use server";

import { revalidatePath } from "next/cache";

import { getSessionContextCached } from "@/lib/auth/guards";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { ensureOwnStockSupplier, parkSupplierOffer, setPartDelivery } from "@/lib/admin/fix-delivery";
import { isMirror, parseShelfQty, shelfPlan } from "@/lib/admin/own-stock";
import { SUPPLIER_LEAD_DAYS } from "@/lib/sourcing/lead-times";
import { createClient } from "@/lib/supabase/server";
import { readPartsAdmin } from "@/lib/store/part-columns";

// "I bought these" on /dashboard/store/stock. Reuses the 0037 receipt flow
// (mark_restock_received): it records the receipt, marks the product's open
// signals served, and (after migration 0069) adds the units to own stock.
// super_admin only (checked here and inside the database function).

export type BoughtLine = { partId: string; supplierId: string | null; qty: number };

export async function markBought(locale: string, lines: BoughtLine[]): Promise<{ ok: true; count: number } | { error: string }> {
  const s = await getSessionContextCached();
  if (s?.profile.role !== "super_admin") return { error: "forbidden" };
  const clean = lines
    .map((l) => ({ partId: String(l.partId), supplierId: l.supplierId ? String(l.supplierId) : null, qty: Math.max(1, Math.trunc(Number(l.qty)) || 1) }))
    .slice(0, 200);
  if (clean.length === 0) return { error: "empty" };

  const supabase = await createClient();
  let count = 0;
  for (const l of clean) {
    const { error } = await supabase.rpc("mark_restock_received", { p_part: l.partId, p_supplier: l.supplierId, p_quantity: l.qty });
    if (error) return { error: count > 0 ? `partial:${count}` : error.message };
    count++;
  }
  revalidateStock(locale);
  return { ok: true, count };
}

function revalidateStock(locale: string) {
  for (const path of ["/dashboard", "/dashboard/store/stock", "/dashboard/store/restock"]) revalidatePath(`/${locale}${path}`);
  revalidateStorefront();
}

// "Units on the shelf" on /dashboard/store/stock: the owner types the real
// count after a stock take, a loss or a correction, and 0069's set_own_stock
// writes it. Above zero the product also gets the own-stock offer at 1 day
// (the same thing the Fix list's "Set delivery time -> Own stock in Lusail"
// does), because a count alone does not make us the supplier, AND a mirror
// product is switched to 'markup' first, because 0095 never lets our offer win
// for a mirror product (shelfPlan explains both). Back at zero the offer is
// PARKED, never deleted — see parkSupplierOffer.
// super_admin only (checked here and inside the database function).

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

export async function setShelfUnits(locale: string, partId: string, qtyRaw: string | number): Promise<ShelfResult> {
  const s = await getSessionContextCached();
  if (s?.profile.role !== "super_admin") return { error: "forbidden" };
  const id = String(partId ?? "").trim();
  const qty = parseShelfQty(qtyRaw);
  if (!id || qty === null) return { error: "quantity" };

  const supabase = await createClient();
  // The pricing mode decides whether our offer can win at all, so it is read
  // here rather than trusted from the page.
  const part = await readPartsAdmin((t) => supabase.from(t).select("pricing_mode, unit_price").eq("id", id).maybeSingle());
  if (part.error || !part.data) return { error: part.error?.message ?? "notFound" };

  const set = await supabase.rpc("set_own_stock", { p_part: id, p_qty: qty });
  if (set.error) return { error: set.error.message };

  // The count is saved from here on, so a failure of a later step is reported
  // as a saved count with a warning, never as "nothing happened".
  const plan = shelfPlan(qty, { mirror: isMirror(part.data.pricing_mode as string | null) });
  const supplier = await ensureOwnStockSupplier(supabase);
  if (!supplier) {
    revalidateStock(locale);
    return { ok: true, qty, offer: "failed", reason: "ownSupplier" };
  }

  let priceFixed: number | undefined;
  if (plan.fixPrice) {
    // The price stops following the supplier here. unit_price is left exactly
    // as it is: markup mode writes it back unchanged, so nothing moves for a
    // customer at this moment.
    const up = await supabase.from("parts").update({ pricing_mode: "markup" }).eq("id", id);
    if (up.error) {
      revalidateStock(locale);
      return { ok: true, qty, offer: "failed", reason: "priceMode" };
    }
    priceFixed = Number(part.data.unit_price) || 0;
  }

  let offer: ShelfOffer;
  let reason: string | undefined;
  if (plan.giveOwnOffer) {
    const res = await setPartDelivery(supabase, id, supplier, SUPPLIER_LEAD_DAYS.own_stock);
    offer = res.ok ? "added" : "failed";
    if (!res.ok) reason = res.reason;
  } else {
    const res = await parkSupplierOffer(supabase, id, supplier);
    offer = res.ok ? (res.parked ? "parked" : "none") : "failed";
    if (!res.ok) reason = res.reason;
  }

  revalidateStock(locale);
  return { ok: true, qty, offer, ...(reason ? { reason } : {}), ...(priceFixed === undefined ? {} : { priceFixed }) };
}
