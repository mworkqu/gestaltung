"use server";

import { revalidatePath } from "next/cache";

import { getSessionContextCached } from "@/lib/auth/guards";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { applyShelfUnits, type ShelfResult } from "@/lib/admin/shelf-apply";
import { createClient } from "@/lib/supabase/server";

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

export type { ShelfOffer, ShelfResult } from "@/lib/admin/shelf-apply";

export async function setShelfUnits(locale: string, partId: string, qtyRaw: string | number): Promise<ShelfResult> {
  const s = await getSessionContextCached();
  if (s?.profile.role !== "super_admin") return { error: "forbidden" };

  const supabase = await createClient();
  const res = await applyShelfUnits(supabase, partId, qtyRaw);
  if ("ok" in res) revalidateStock(locale);
  return res;
}
