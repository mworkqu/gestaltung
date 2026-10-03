"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import {
  BlockedError,
  handleFromUrl,
  pickVariant,
  VOLTAAT_BASE,
  VOLTAAT_IN_STOCK_DAYS,
  VoltaatClient,
} from "@/lib/sourcing/adapters/voltaat";
import { revalidateStorefront } from "@/lib/cache/storefront";

// Voltaat sync admin (Task 19g): the one-click switch, and mapping one of our
// products to one Voltaat product (explicit — unmapped products are never
// touched). Mapping reads that one product page's numbers; it never copies
// Voltaat's name, description or photos. super_admin only.

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

export async function setVoltaatSync(locale: string, enabled: boolean) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "voltaat_sync", value: { enabled }, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/suppliers/voltaat`);
  return { ok: true };
}

export type MapResult =
  | { ok: true; price: number; available: boolean }
  | { error: string; variants?: { id: number; title: string; price: number }[] };

export async function mapVoltaatProduct(locale: string, ourSku: string, url: string, variantId?: number): Promise<MapResult> {
  await requireAdmin();
  const handle = handleFromUrl(url);
  if (!handle || !/voltaat\.com/i.test(url)) return { error: "bad_url" };

  const supabase = await createClient();
  const { data: part } = await supabase.from("parts").select("id").eq("sku", ourSku.trim()).is("merged_into", null).maybeSingle();
  if (!part) return { error: "product_not_found" };
  const { data: sup } = await supabase.from("suppliers").select("id").eq("code", "voltaat").single();

  let product;
  try {
    product = await new VoltaatClient().product(handle);
  } catch (e) {
    return { error: e instanceof BlockedError ? "blocked" : "fetch_failed" };
  }
  if (!product) return { error: "not_on_voltaat" };

  const v = variantId
    ? product.variants.find((x) => x.id === variantId) ?? null
    : pickVariant(product, { supplier_sku: null, supplier_url: url });
  if (!v) {
    return { error: "choose_variant", variants: product.variants.map((x) => ({ id: x.id, title: x.title, price: x.price })) };
  }

  const row = {
    supplier_url: `${VOLTAAT_BASE}/products/${handle}?variant=${v.id}`,
    supplier_sku: v.sku ?? String(v.id),
    retail_price: v.price,
    currency: "QAR",
    availability: v.available ? "in_stock" : "unavailable",
    ...(v.available ? { lead_time_days: VOLTAAT_IN_STOCK_DAYS } : {}),
    last_checked_at: new Date().toISOString(),
    active: v.available,
  };
  // One Voltaat offer per product: update it if it exists, else create it.
  const { data: existing } = await supabase
    .from("supplier_offers")
    .select("id")
    .eq("part_id", part.id)
    .eq("supplier_id", sup!.id)
    .limit(1)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("supplier_offers").update(row).eq("id", existing.id)
    : await supabase.from("supplier_offers").insert({ ...row, part_id: part.id, supplier_id: sup!.id, pack_size: 1, moq: 1 });
  if (error) return { error: error.message };

  // Voltaat products are sold at Voltaat's price; the trigger sets ours from the offer.
  await supabase.from("parts").update({ pricing_mode: "mirror" }).eq("id", part.id);

  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/suppliers/voltaat`);
  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/store`);
  return { ok: true, price: v.price, available: v.available };
}
