"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { AVAILABILITIES, type Supplier } from "@/lib/store/sourcing";
import type { ColumnMapping } from "@/lib/sourcing/adapters/csv";
import type { SourcedOffer } from "@/lib/sourcing/types";

// Supplier price-list import (Task 19a). The browser parses the CSV through
// the column mapping; the server re-plans from those rows and the database,
// shows the plan (preview), and applies it only when asked. Existing offers
// get numbers only (cost, retail price, currency, availability, lead time).
// A row that matches nothing can become a DRAFT product from the supplier's
// own file — never published, never overwriting our catalogue.
// super_admin only (and RLS).

const MAX_ROWS = 5000;
type Compared = "cost" | "retail_price" | "currency" | "availability" | "lead_time_days";

export type Change = { field: Compared; from: string | number | null; to: string | number };
export type PlanUpdate = { offerId: string; partId: string; partName: string; supplierSku: string; changes: Change[] };
export type PlanAttach = { partId: string; partSku: string; partName: string; offer: SourcedOffer };
export type PlanNew = { offer: SourcedOffer };
export type ImportPlan = {
  supplier: { id: string; name: string; code: string; mirror: boolean };
  updates: PlanUpdate[];
  unchanged: number;
  attach: PlanAttach[];
  unmatched: PlanNew[];
};

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

function clean(o: SourcedOffer): SourcedOffer | null {
  const sku = String(o?.supplierSku ?? "").trim().slice(0, 120);
  if (!sku) return null;
  const n = (v: unknown, int = false) => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) return null;
    return int ? Math.round(x) : x;
  };
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const cur = s(o.currency, 3)?.toUpperCase() ?? null;
  const url = s(o.url, 500);
  return {
    supplierSku: sku,
    ourSku: s(o.ourSku, 60),
    name: s(o.name, 200),
    category: s(o.category, 80),
    cost: n(o.cost),
    retailPrice: n(o.retailPrice),
    currency: cur && /^[A-Z]{3}$/.test(cur) ? cur : null,
    availability: (AVAILABILITIES as readonly string[]).includes(String(o.availability)) ? o.availability! : null,
    leadTimeDays: n(o.leadTimeDays, true),
    packSize: n(o.packSize, true) || null,
    moq: n(o.moq, true) || null,
    url: url && /^https?:\/\//i.test(url) ? url : null,
  };
}

/** The sourced numbers a row carries, as offer columns. Blank cells change nothing. */
function sourcedValues(o: SourcedOffer): Partial<Record<Compared, string | number>> {
  const out: Partial<Record<Compared, string | number>> = {};
  if (o.cost != null) out.cost = o.cost;
  if (o.retailPrice != null) out.retail_price = o.retailPrice;
  if (o.currency) out.currency = o.currency;
  if (o.availability) out.availability = o.availability;
  if (o.leadTimeDays != null) out.lead_time_days = o.leadTimeDays;
  return out;
}

async function plan(supplierId: string, raw: SourcedOffer[]): Promise<ImportPlan | { error: string }> {
  const supabase = await createClient();
  const { data: sup } = await supabase.from("suppliers").select("*").eq("id", supplierId).maybeSingle();
  if (!sup) return { error: "supplier" };
  const supplier = sup as Supplier;

  const rows = (Array.isArray(raw) ? raw : []).slice(0, MAX_ROWS).map(clean).filter((x): x is SourcedOffer => !!x);

  const existing: {
    id: string;
    part_id: string;
    supplier_sku: string | null;
    cost: number | null;
    retail_price: number | null;
    currency: string;
    availability: string;
    lead_time_days: number | null;
    part: { name: string } | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("supplier_offers")
      .select("id, part_id, supplier_sku, cost, retail_price, currency, availability, lead_time_days, part:parts!supplier_offers_part_id_fkey(name)")
      .eq("supplier_id", supplier.id)
      .order("id")
      .range(from, from + 999);
    if (error) return { error: error.message };
    existing.push(...((data ?? []) as unknown as typeof existing));
    if ((data ?? []).length < 1000) break;
  }
  const bySku = new Map(existing.filter((e) => e.supplier_sku).map((e) => [e.supplier_sku!.toLowerCase(), e]));

  const ourSkus = [...new Set(rows.filter((r) => !bySku.has(r.supplierSku.toLowerCase()) && r.ourSku).map((r) => r.ourSku!))];
  const ours = new Map<string, { id: string; sku: string; name: string }>();
  for (let i = 0; i < ourSkus.length; i += 200) {
    const { data } = await supabase
      .from("parts")
      .select("id, sku, name")
      .in("sku", ourSkus.slice(i, i + 200))
      .is("merged_into", null);
    for (const p of data ?? []) ours.set(String(p.sku).toLowerCase(), p as { id: string; sku: string; name: string });
  }

  const result: ImportPlan = {
    supplier: { id: supplier.id, name: supplier.name, code: supplier.code, mirror: supplier.default_pricing_mode === "mirror" },
    updates: [],
    unchanged: 0,
    attach: [],
    unmatched: [],
  };
  for (const r of rows) {
    const e = bySku.get(r.supplierSku.toLowerCase());
    if (e) {
      const changes: Change[] = [];
      for (const [field, to] of Object.entries(sourcedValues(r)) as [Compared, string | number][]) {
        const from = e[field] as string | number | null;
        if (from === null ? true : typeof to === "number" ? Number(from) !== to : String(from) !== to) {
          changes.push({ field, from, to });
        }
      }
      if (changes.length)
        result.updates.push({ offerId: e.id, partId: e.part_id, partName: e.part?.name ?? "", supplierSku: e.supplier_sku ?? "", changes });
      else result.unchanged++;
      continue;
    }
    const p = r.ourSku ? ours.get(r.ourSku.toLowerCase()) : undefined;
    if (p) result.attach.push({ partId: p.id, partSku: p.sku, partName: p.name, offer: r });
    else result.unmatched.push({ offer: r });
  }
  return result;
}

export async function previewImport(supplierId: string, offers: SourcedOffer[]) {
  await requireAdmin();
  return plan(supplierId, offers);
}

function makeSku(prefix: string) {
  const p = (prefix.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "SUP").toUpperCase();
  return `${p}-${(Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)).toUpperCase()}`;
}

export type ApplyResult = {
  updated: number;
  attached: number;
  drafts: number;
  failed: { supplierSku: string; reason: string }[];
};

export async function applyImport(
  locale: string,
  supplierId: string,
  offers: SourcedOffer[],
  mapping: ColumnMapping,
  createDrafts: boolean
): Promise<ApplyResult | { error: string }> {
  await requireAdmin();
  const p = await plan(supplierId, offers);
  if ("error" in p) return p;
  const supabase = await createClient();
  const { data: sup } = await supabase.from("suppliers").select("*").eq("id", supplierId).single();
  const supplier = sup as Supplier;
  const now = new Date().toISOString();
  const out: ApplyResult = { updated: 0, attached: 0, drafts: 0, failed: [] };

  // Numbers only on existing offers (SOURCED_OFFER_FIELDS). Chunks keep it quick.
  for (let i = 0; i < p.updates.length; i += 20) {
    await Promise.all(
      p.updates.slice(i, i + 20).map(async (u) => {
        const patch: Record<string, unknown> = { last_checked_at: now };
        for (const c of u.changes) patch[c.field] = c.to;
        const { error } = await supabase.from("supplier_offers").update(patch).eq("id", u.offerId);
        if (error) out.failed.push({ supplierSku: u.supplierSku, reason: error.message });
        else out.updated++;
      })
    );
  }
  // Rows that matched but changed nothing were still checked today.
  const checked = offers.map((o) => String(o?.supplierSku ?? "").trim()).filter(Boolean);
  for (let i = 0; i < checked.length; i += 200) {
    await supabase
      .from("supplier_offers")
      .update({ last_checked_at: now })
      .eq("supplier_id", supplierId)
      .in("supplier_sku", checked.slice(i, i + 200));
  }

  const newOffer = (partId: string, o: SourcedOffer) => ({
    part_id: partId,
    supplier_id: supplier.id,
    supplier_sku: o.supplierSku,
    supplier_url: o.url ?? null,
    cost: o.cost ?? null,
    retail_price: o.retailPrice ?? null,
    currency: o.currency ?? supplier.default_currency,
    pack_size: o.packSize ?? 1,
    moq: o.moq ?? 1,
    availability: o.availability ?? "unknown",
    lead_time_days: o.leadTimeDays ?? null,
    last_checked_at: now,
  });

  for (const a of p.attach) {
    const { error } = await supabase.from("supplier_offers").insert(newOffer(a.partId, a.offer));
    if (error) out.failed.push({ supplierSku: a.offer.supplierSku, reason: error.message });
    else out.attached++;
  }

  if (createDrafts) {
    for (const n of p.unmatched) {
      if (!n.offer.name) {
        out.failed.push({ supplierSku: n.offer.supplierSku, reason: "no_name" });
        continue;
      }
      const { data: part, error } = await supabase
        .from("parts")
        .insert({
          sku: makeSku(supplier.code),
          name: n.offer.name,
          category: n.offer.category ?? supplier.name,
          unit_price: n.offer.retailPrice ?? 0,
          min_order_qty: 1,
          stock_status: "in_stock",
          is_published: false,
          pricing_mode: supplier.default_pricing_mode,
        })
        .select("id")
        .single();
      if (error || !part) {
        out.failed.push({ supplierSku: n.offer.supplierSku, reason: error?.message ?? "insert" });
        continue;
      }
      const { error: oe } = await supabase.from("supplier_offers").insert(newOffer(part.id, n.offer));
      if (oe) out.failed.push({ supplierSku: n.offer.supplierSku, reason: oe.message });
      else out.drafts++;
    }
  }

  // Remember the mapping for this supplier.
  const saved: ColumnMapping = {};
  for (const [k, v] of Object.entries(mapping ?? {})) if (typeof v === "string" && v) saved[k as keyof ColumnMapping] = v.slice(0, 120);
  await supabase
    .from("store_settings")
    .upsert({ key: `csv_mapping:${supplier.code}`, value: saved, updated_at: now });

  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/dashboard/store/suppliers`);
  revalidatePath(`/${locale}/store`);
  return out;
}
