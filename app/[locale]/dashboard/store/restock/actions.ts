"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { cleanWeights, type RestockWeights } from "@/lib/store/restock";

// Restock dashboard actions (Task 20). super_admin only (checked here and in the
// database functions).

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

export async function saveRestockWeights(locale: string, w: Partial<RestockWeights>) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "restock_weights", value: cleanWeights(w), updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath(`/${locale}/dashboard/store/restock`);
  return { ok: true };
}

export async function saveSupplierMinimum(locale: string, supplierId: string, value: number | null) {
  await requireAdmin();
  const v = value === null || !Number.isFinite(value) || value < 0 ? null : Math.round(value * 100) / 100;
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ min_order_value_qar: v }).eq("id", supplierId);
  if (error) return { error: error.message };
  revalidatePath(`/${locale}/dashboard/store/restock`);
  return { ok: true };
}

/** Stock arrived: record the receipt and mark the product's open signals served (never deleted). */
export async function markReceived(locale: string, partId: string, supplierId: string | null, quantity: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_restock_received", {
    p_part: partId,
    p_supplier: supplierId,
    p_quantity: Math.max(1, Math.trunc(quantity) || 1),
  });
  if (error) return { error: error.message };
  revalidatePath(`/${locale}/dashboard/store/restock`);
  return { ok: true, served: Number(data) || 0 };
}
