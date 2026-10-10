"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { createClient } from "@/lib/supabase/server";

// "I bought these" on /dashboard/store/stock. Reuses the 0037 receipt flow
// (mark_restock_received): it records the receipt, marks the product's open
// signals served, and (after migration 0069) adds the units to own stock.
// super_admin only (checked here and inside the database function).

export type BoughtLine = { partId: string; supplierId: string | null; qty: number };

export async function markBought(locale: string, lines: BoughtLine[]): Promise<{ ok: true; count: number } | { error: string }> {
  const s = await getSessionContext();
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
  for (const path of ["/dashboard", "/dashboard/store/stock", "/dashboard/store/restock"]) revalidatePath(`/${locale}${path}`);
  revalidateStorefront();
  return { ok: true, count };
}
