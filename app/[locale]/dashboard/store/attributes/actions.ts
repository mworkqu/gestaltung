"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { cleanAttributes, isAttrClass, type Attributes } from "@/lib/store/attributes";
import { deriveAttributes } from "@/lib/store/derive-attributes";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { revalidateStorefront } from "@/lib/cache/storefront";

// Product attributes and store settings. super_admin only — checked here and
// again by RLS (parts and store_settings writes are super_admin).

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

export async function savePartAttributes(locale: string, id: string, attributes: Attributes, packSize: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("parts")
    .update({ attributes: cleanAttributes(attributes), pack_size: Math.max(1, Math.trunc(packSize) || 1) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true };
}

/** Bulk edit: set a class and/or one field on many products at once. */
export async function bulkSetAttributes(
  locale: string,
  ids: string[],
  patch: { class?: string; field?: string; value?: unknown; packSize?: number }
) {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("parts").select("id, attributes").in("id", ids);
  if (error) return { error: error.message };
  for (const row of data ?? []) {
    const cur = (row.attributes ?? {}) as Attributes;
    const next: Attributes = { ...(patch.class && patch.class !== cur.class ? { class: patch.class } : cur) };
    if (patch.field) next[patch.field] = patch.value;
    const { error: e } = await supabase
      .from("parts")
      .update({ attributes: cleanAttributes(next), ...(patch.packSize ? { pack_size: Math.max(1, Math.trunc(patch.packSize)) } : {}) })
      .eq("id", row.id);
    if (e) return { error: e.message };
  }
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true, count: data?.length ?? 0 };
}

/**
 * Owner action (P5-01): save the type + key attributes read from each product
 * NAME (lib/store/derive-attributes) for products that have no class yet, and
 * their pack size when the name states one and the row still says 1. Never
 * touches a product the owner already typed. The BOM matcher reads names on
 * the fly anyway; saving makes them visible and editable here.
 */
export async function fillAttributesFromNames(locale: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { rows, error } = await fetchAllRows<{ id: string; name: string; attributes: Attributes | null; pack_size: number | null }>(
    (from, to) => supabase.from("parts").select("id, name, attributes, pack_size").order("id").range(from, to)
  );
  if (error) return { error: error.message ?? "read_failed" };
  let count = 0;
  for (const row of rows) {
    if (isAttrClass(row.attributes?.class)) continue;
    const d = deriveAttributes(row);
    if (!isAttrClass(d.attributes.class)) continue;
    const patch: { attributes: Attributes; pack_size?: number } = { attributes: cleanAttributes(d.attributes) };
    if (d.packSize && (row.pack_size ?? 1) <= 1) patch.pack_size = d.packSize;
    const { error: e } = await supabase.from("parts").update(patch).eq("id", row.id);
    if (e) return { error: e.message, count };
    count += 1;
  }
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true, count };
}

export async function saveKitDiscount(locale: string, pct: number) {
  await requireAdmin();
  const value = Math.min(Math.max(Number(pct) || 0, 0), 90);
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "kit_discount_pct", value, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true };
}
