"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { digikeyConfigured, digikeyPart, digikeySearch } from "@/lib/sourcing/adapters/digikey";
import { mouserConfigured, mouserPart, mouserSearch } from "@/lib/sourcing/adapters/mouser";
import { fillMissing, parametersToAttributes } from "@/lib/sourcing/spec-map";
import type { SupplierProduct } from "@/lib/sourcing/types";
import { fetchImage, storeImage } from "@/lib/store/store-image";
import type { Attributes } from "@/lib/store/attributes";

// Mouser + DigiKey lookups (Task 19b). Catalogue content (name, description,
// photo, specifications) comes from the supplier's official API and is used
// only when creating a NEW product; an existing product only ever receives
// offer numbers and attributes it doesn't have yet. super_admin only.

const API_SUPPLIERS = ["mouser", "digikey"] as const;
type ApiSupplier = (typeof API_SUPPLIERS)[number];
const IMAGE_HOSTS = /(^|\.)(mouser\.com|digikey\.com)$/i;

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

const isApi = (c: string): c is ApiSupplier => (API_SUPPLIERS as readonly string[]).includes(c);

async function lookup(code: ApiSupplier, sku: string) {
  return code === "mouser" ? mouserPart(sku) : digikeyPart(sku);
}

export type LookupResult = SupplierProduct & {
  attributes: Attributes;
  linked: { partId: string; partName: string; partSku: string } | null;
};

export async function searchSuppliers(query: string): Promise<{
  results: LookupResult[];
  errors: { supplier: ApiSupplier; message: string }[];
}> {
  await requireAdmin();
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return { results: [], errors: [] };

  const errors: { supplier: ApiSupplier; message: string }[] = [];
  const run = async (code: ApiSupplier, fn: () => Promise<SupplierProduct[]>, ok: boolean) => {
    if (!ok) {
      errors.push({ supplier: code, message: "not_configured" });
      return [];
    }
    try {
      return await fn();
    } catch (e) {
      errors.push({ supplier: code, message: e instanceof Error ? e.message : "failed" });
      return [];
    }
  };
  const [m, d] = await Promise.all([
    run("mouser", () => mouserSearch(q, 8), mouserConfigured()),
    run("digikey", () => digikeySearch(q, 8), digikeyConfigured()),
  ]);
  const all = [...d, ...m];

  // Which of these do we already carry?
  const supabase = await createClient();
  const { data: sups } = await supabase.from("suppliers").select("id, code").in("code", [...API_SUPPLIERS]);
  const idOf = new Map((sups ?? []).map((s) => [s.code as string, s.id as string]));
  const skus = all.map((r) => r.supplierSku);
  const { data: offers } = skus.length
    ? await supabase
        .from("supplier_offers")
        .select("supplier_id, supplier_sku, part:parts!supplier_offers_part_id_fkey(id, name, sku)")
        .in("supplier_sku", skus)
    : { data: [] };
  type Row = { supplier_id: string; supplier_sku: string; part: { id: string; name: string; sku: string } | null };
  const linked = new Map(
    ((offers ?? []) as unknown as Row[]).filter((o) => o.part).map((o) => [`${o.supplier_id}|${o.supplier_sku}`, o.part!])
  );

  return {
    results: all.map((r) => {
      const p = linked.get(`${idOf.get(r.supplierCode)}|${r.supplierSku}`);
      return {
        ...r,
        attributes: parametersToAttributes(r.parameters, { category: r.category, description: r.description }),
        linked: p ? { partId: p.id, partName: p.name, partSku: p.sku } : null,
      };
    }),
    errors,
  };
}

function makeSku(prefix: string) {
  const p = (prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "SUP").toUpperCase();
  return `${p}-${(Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)).toUpperCase()}`;
}

function offerRow(supplierId: string, partId: string, r: SupplierProduct) {
  return {
    part_id: partId,
    supplier_id: supplierId,
    supplier_sku: r.supplierSku,
    supplier_url: r.url,
    cost: r.cost,
    currency: r.currency,
    pack_size: 1,
    moq: r.moq,
    availability: r.availability,
    lead_time_days: r.leadTimeDays,
    last_checked_at: new Date().toISOString(),
  };
}

/**
 * Add a supplier part to our store. With `existingSku`, the part becomes a new
 * offer on that product (and fills attributes it's missing). Without it, a new
 * product is created from the supplier's catalogue data at the given price.
 */
export async function addFromSupplier(
  locale: string,
  input: { supplier: string; supplierSku: string; existingSku?: string; category?: string; price?: number; publish?: boolean }
): Promise<{ ok: true; partId: string; partSku: string; imageSaved: boolean } | { error: string }> {
  await requireAdmin();
  if (!isApi(input.supplier)) return { error: "supplier" };
  const supabase = await createClient();
  const { data: sup } = await supabase.from("suppliers").select("id, code, default_pricing_mode").eq("code", input.supplier).maybeSingle();
  if (!sup) return { error: "supplier" };

  let r: SupplierProduct | null;
  try {
    r = await lookup(input.supplier, input.supplierSku);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "lookup" };
  }
  if (!r) return { error: "not_found" };
  const attrs = parametersToAttributes(r.parameters, { category: r.category, description: r.description });

  // Link to an existing product.
  if (input.existingSku?.trim()) {
    const { data: part } = await supabase
      .from("parts")
      .select("id, sku, attributes")
      .eq("sku", input.existingSku.trim())
      .is("merged_into", null)
      .maybeSingle();
    if (!part) return { error: "product_not_found" };
    const { error } = await supabase.from("supplier_offers").insert(offerRow(sup.id, part.id, r));
    if (error) return { error: error.code === "23505" ? "already_linked" : error.message };
    const merged = fillMissing(part.attributes as Attributes, attrs);
    if (JSON.stringify(merged) !== JSON.stringify(part.attributes)) {
      await supabase.from("parts").update({ attributes: merged }).eq("id", part.id);
    }
    revalidatePath(`/${locale}/dashboard/store`);
    return { ok: true, partId: part.id, partSku: part.sku, imageSaved: false };
  }

  // Create a new product from the supplier's catalogue data.
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) return { error: "price" };
  const category = (input.category ?? "").trim().slice(0, 80) || "Components";
  const name = [r.mpn, r.description].filter(Boolean).join(" · ").slice(0, 160) || r.name;
  const description = [
    r.description,
    r.manufacturer && r.mpn ? `Manufacturer part: ${r.manufacturer} ${r.mpn}` : null,
    r.datasheetUrl ? `Datasheet: ${r.datasheetUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: part, error } = await supabase
    .from("parts")
    .insert({
      sku: makeSku(category),
      name,
      description,
      category,
      unit_price: price,
      min_order_qty: 1,
      stock_status: "in_stock",
      is_published: Boolean(input.publish),
      attributes: attrs,
      pricing_mode: sup.default_pricing_mode,
    })
    .select("id, sku")
    .single();
  if (error || !part) return { error: error?.message ?? "insert" };

  const { error: oe } = await supabase.from("supplier_offers").insert(offerRow(sup.id, part.id, r));
  if (oe) return { error: `offer: ${oe.message}` };

  let imageSaved = false;
  if (r.imageUrl) {
    try {
      const buf = await fetchImage(r.imageUrl, IMAGE_HOSTS);
      if (buf) {
        const img = await storeImage(supabase, buf, `supplier/${input.supplier}/${part.id}/${Date.now()}`);
        await supabase.from("parts").update({ images: [img], image_url: img.web }).eq("id", part.id);
        imageSaved = true;
      }
    } catch {
      // The product stands without a photo; the owner can add one in Quick add.
    }
  }

  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/store`);
  return { ok: true, partId: part.id, partSku: part.sku, imageSaved };
}

/** Re-reads one Mouser/DigiKey offer: numbers only, plus attributes the product lacks. */
export async function refreshApiOffer(locale: string, offerId: string): Promise<{ ok: true; changed: string[] } | { error: string }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("supplier_offers")
    .select("id, part_id, supplier_sku, cost, currency, availability, lead_time_days, supplier:suppliers(code), part:parts!supplier_offers_part_id_fkey(attributes)")
    .eq("id", offerId)
    .maybeSingle();
  type Row = {
    id: string;
    part_id: string;
    supplier_sku: string | null;
    cost: number | null;
    currency: string;
    availability: string;
    lead_time_days: number | null;
    supplier: { code: string } | null;
    part: { attributes: Attributes | null } | null;
  };
  const row = o as unknown as Row | null;
  if (!row?.supplier_sku || !row.supplier || !isApi(row.supplier.code)) return { error: "not_api" };

  let r: SupplierProduct | null;
  try {
    r = await lookup(row.supplier.code, row.supplier_sku);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "lookup" };
  }
  if (!r) return { error: "not_found" };

  const next = { cost: r.cost, currency: r.currency, availability: r.availability, lead_time_days: r.leadTimeDays };
  const changed: string[] = (Object.keys(next) as (keyof typeof next)[]).filter((k) => String(row[k] ?? "") !== String(next[k] ?? ""));
  await supabase.from("supplier_offers").update({ ...next, last_checked_at: new Date().toISOString() }).eq("id", row.id);

  const attrs = parametersToAttributes(r.parameters, { category: r.category, description: r.description });
  const merged = fillMissing(row.part?.attributes, attrs);
  if (JSON.stringify(merged) !== JSON.stringify(row.part?.attributes ?? {})) {
    await supabase.from("parts").update({ attributes: merged }).eq("id", row.part_id);
    changed.push("attributes");
  }

  revalidatePath(`/${locale}/dashboard/store/${row.part_id}/edit`);
  revalidatePath(`/${locale}/dashboard/store`);
  return { ok: true, changed };
}
