"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { cleanAttributes, type Attributes } from "@/lib/store/attributes";
import { findSimilar } from "@/lib/store/similar";
import type { ProductImage } from "@/lib/google/drive-picker";
import type { Supplier } from "@/lib/store/sourcing";

// Fast product entry (Task 17c/d/e). One call saves one product or a batch:
// the product (ours: name, category, attributes, price, images) plus one
// supplier offer (cost, lead time). A name very like an existing product in
// the same category comes back as a warning instead of being saved, unless
// the row says confirmDuplicate. super_admin only (and RLS).

export type QuickRow = {
  key: string;
  name: string;
  category: string;
  attributes?: Attributes;
  supplierId: string;
  cost: string | number;
  price: string | number;
  leadDays: string | number;
  images: ProductImage[];
  publish: boolean;
  confirmDuplicate?: boolean;
};

export type QuickResult =
  | { key: string; ok: true; sku: string; id: string }
  | { key: string; duplicate: { id: string; sku: string; name: string }[] }
  | { key: string; error: string };

const num = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function makeSku(category: string) {
  const prefix = (category.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "GST").toUpperCase();
  const tail = (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)).toUpperCase();
  return `${prefix}-${tail}`;
}

export async function saveQuickProducts(locale: string, rows: QuickRow[]): Promise<QuickResult[]> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") throw new Error("forbidden");
  const supabase = await createClient();

  const { data: supplierRows } = await supabase.from("suppliers").select("*");
  const suppliers = new Map(((supplierRows ?? []) as Supplier[]).map((s) => [s.id, s]));

  const categories = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))];
  const { data: existing } = categories.length
    ? await supabase.from("parts").select("id, sku, name, category").in("category", categories).limit(10000)
    : { data: [] };
  const pool = (existing ?? []) as { id: string; sku: string; name: string; category: string }[];

  const results: QuickResult[] = [];
  for (const r of rows.slice(0, 200)) {
    const name = r.name.trim();
    const category = r.category.trim();
    const price = num(r.price);
    const cost = num(r.cost);
    const lead = num(r.leadDays);
    const supplier = suppliers.get(r.supplierId);
    if (!name || !category) {
      results.push({ key: r.key, error: "required" });
      continue;
    }
    if (!supplier) {
      results.push({ key: r.key, error: "supplier" });
      continue;
    }
    if (price === null) {
      results.push({ key: r.key, error: "price" });
      continue;
    }

    if (!r.confirmDuplicate) {
      const similar = findSimilar(name, pool.filter((p) => p.category === category));
      if (similar.length) {
        results.push({ key: r.key, duplicate: similar.map(({ id, sku, name }) => ({ id, sku, name })) });
        continue;
      }
    }

    const mirror = supplier.default_pricing_mode === "mirror";
    const images = (r.images ?? []).slice(0, 12);
    let inserted: { id: string; sku: string } | null = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const sku = makeSku(category);
      const { data, error } = await supabase
        .from("parts")
        .insert({
          sku,
          name,
          category,
          unit_price: price,
          min_order_qty: 1,
          stock_status: "in_stock",
          is_published: r.publish,
          attributes: cleanAttributes(r.attributes ?? {}),
          images,
          image_url: images[0]?.web ?? null,
          pricing_mode: mirror ? "mirror" : "markup",
        })
        .select("id, sku")
        .single();
      if (data) inserted = data;
      else if (error?.code !== "23505") {
        results.push({ key: r.key, error: error?.message ?? "insert" });
        break;
      }
    }
    if (!inserted) {
      if (!results.find((x) => x.key === r.key)) results.push({ key: r.key, error: "sku" });
      continue;
    }

    const { error: offerError } = await supabase.from("supplier_offers").insert({
      part_id: inserted.id,
      supplier_id: supplier.id,
      cost,
      retail_price: mirror ? price : null,
      currency: supplier.default_currency,
      pack_size: 1,
      moq: 1,
      lead_time_days: lead === null ? null : Math.trunc(lead),
      availability: lead !== null && lead <= 2 ? "in_stock" : "unknown",
      last_checked_at: new Date().toISOString(),
    });
    if (offerError) {
      results.push({ key: r.key, error: `offer: ${offerError.message}` });
      continue;
    }

    pool.push({ id: inserted.id, sku: inserted.sku, name, category });
    results.push({ key: r.key, ok: true, sku: inserted.sku, id: inserted.id });
  }

  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/store`);
  return results;
}
