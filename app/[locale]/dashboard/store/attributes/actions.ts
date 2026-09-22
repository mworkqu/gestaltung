"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { fieldsOf, isAttrClass, parseEng, type Attributes } from "@/lib/store/attributes";

// Product attributes and store settings. super_admin only — checked here and
// again by RLS (parts and store_settings writes are super_admin).

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

/** Keeps only the class's own fields, with numbers parsed ("10k" → 10000). */
function clean(raw: Attributes): Attributes {
  if (!isAttrClass(raw.class)) return {};
  const out: Attributes = { class: raw.class };
  for (const f of fieldsOf(raw.class)) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") {
      const n = typeof v === "number" ? v : parseEng(String(v));
      if (n !== null && Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === "list") {
      const list = (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      if (list.length) out[f.key] = list;
    } else out[f.key] = String(v).trim();
  }
  return out;
}

export async function savePartAttributes(locale: string, id: string, attributes: Attributes, packSize: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("parts")
    .update({ attributes: clean(attributes), pack_size: Math.max(1, Math.trunc(packSize) || 1) })
    .eq("id", id);
  if (error) return { error: error.message };
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
      .update({ attributes: clean(next), ...(patch.packSize ? { pack_size: Math.max(1, Math.trunc(patch.packSize)) } : {}) })
      .eq("id", row.id);
    if (e) return { error: e.message };
  }
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true, count: data?.length ?? 0 };
}

export async function saveKitDiscount(locale: string, pct: number) {
  await requireAdmin();
  const value = Math.min(Math.max(Number(pct) || 0, 0), 90);
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "kit_discount_pct", value, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath(`/${locale}/dashboard/store/attributes`);
  return { ok: true };
}
