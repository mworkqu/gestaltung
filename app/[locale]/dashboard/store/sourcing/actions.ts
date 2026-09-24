"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { AVAILABILITIES, PRICING_MODES, type Availability, type PricingMode } from "@/lib/store/sourcing";

// Suppliers, supplier offers and pricing modes (Task 16). super_admin only —
// checked here and again by RLS. The derived product fields are recomputed by
// database triggers whenever an offer, a supplier or the product changes.

async function requireAdmin() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

function revalidate(locale: string, partId?: string) {
  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/dashboard/store/suppliers`);
  if (partId) revalidatePath(`/${locale}/dashboard/store/${partId}/edit`);
}

const num = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const int1 = (v: unknown) => Math.max(1, Math.trunc(Number(v)) || 1);
const text = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export type OfferInput = {
  supplier_id: string;
  supplier_sku?: string;
  supplier_url?: string;
  cost?: number | string | null;
  retail_price?: number | string | null;
  currency?: string;
  pack_size?: number | string;
  moq?: number | string;
  availability?: string;
  lead_time_days?: number | string | null;
  active?: boolean;
};

function cleanOffer(o: OfferInput) {
  const url = text(o.supplier_url);
  const lead = num(o.lead_time_days);
  return {
    supplier_id: o.supplier_id,
    supplier_sku: text(o.supplier_sku),
    supplier_url: url && /^https?:\/\//i.test(url) ? url : null,
    cost: num(o.cost),
    retail_price: num(o.retail_price),
    currency: (text(o.currency) ?? "USD").toUpperCase().slice(0, 3),
    pack_size: int1(o.pack_size),
    moq: int1(o.moq),
    availability: ((AVAILABILITIES as readonly string[]).includes(String(o.availability))
      ? o.availability
      : "unknown") as Availability,
    lead_time_days: lead === null ? null : Math.trunc(lead),
    active: o.active !== false,
    last_checked_at: new Date().toISOString(),
  };
}

export async function saveOffer(locale: string, partId: string, offerId: string | null, input: OfferInput) {
  await requireAdmin();
  if (!input.supplier_id) return { error: "supplier" };
  const supabase = await createClient();
  const row = cleanOffer(input);
  const { error } = offerId
    ? await supabase.from("supplier_offers").update(row).eq("id", offerId).eq("part_id", partId)
    : await supabase.from("supplier_offers").insert({ ...row, part_id: partId });
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };
  revalidate(locale, partId);
  return { ok: true };
}

export async function deleteOffer(locale: string, partId: string, offerId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_offers").delete().eq("id", offerId).eq("part_id", partId);
  if (error) return { error: error.message };
  revalidate(locale, partId);
  return { ok: true };
}

/** Pin an offer as preferred (null = back to the rule). Survives refreshes. */
export async function pinOffer(locale: string, partId: string, offerId: string | null) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("parts").update({ pinned_offer_id: offerId }).eq("id", partId);
  if (error) return { error: error.message };
  revalidate(locale, partId);
  return { ok: true };
}

export async function setPricingMode(locale: string, partId: string, mode: PricingMode) {
  await requireAdmin();
  if (!(PRICING_MODES as readonly string[]).includes(mode)) return { error: "mode" };
  const supabase = await createClient();
  const { error } = await supabase.from("parts").update({ pricing_mode: mode }).eq("id", partId);
  if (error) return { error: error.message };
  revalidate(locale, partId);
  return { ok: true };
}

export type SupplierInput = {
  id?: string;
  code: string;
  name: string;
  default_pricing_mode: string;
  commission_percent: number | string | null;
  landed_overhead_pct: number | string;
  default_currency: string;
  active: boolean;
};

export async function saveSupplier(locale: string, s: SupplierInput) {
  await requireAdmin();
  const code = String(s.code ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = String(s.name ?? "").trim();
  if (!code || !name) return { error: "required" };
  const commission = num(s.commission_percent);
  const row = {
    code,
    name,
    default_pricing_mode: s.default_pricing_mode === "mirror" ? "mirror" : "markup",
    commission_percent: commission === null ? null : Math.min(100, commission),
    landed_overhead_pct: num(s.landed_overhead_pct) ?? 0,
    default_currency: (text(s.default_currency) ?? "USD").toUpperCase().slice(0, 3),
    active: s.active !== false,
  };
  const supabase = await createClient();
  const { error } = s.id
    ? await supabase.from("suppliers").update(row).eq("id", s.id)
    : await supabase.from("suppliers").insert(row);
  if (error) return { error: error.code === "23505" ? "duplicate" : error.message };
  revalidate(locale);
  return { ok: true };
}

/** Margin floor + exchange rates, then re-derive every product. */
export async function saveSourcingSettings(locale: string, floorPct: number, fx: Record<string, number>) {
  await requireAdmin();
  const cleanFx: Record<string, number> = { QAR: 1 };
  for (const [k, v] of Object.entries(fx)) {
    const code = k.trim().toUpperCase().slice(0, 3);
    const n = Number(v);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(n) && n > 0) cleanFx[code] = n;
  }
  const floor = Number.isFinite(Number(floorPct)) ? Number(floorPct) : 15;
  const supabase = await createClient();
  const { error } = await supabase.from("store_settings").upsert([
    { key: "margin_floor_pct", value: floor, updated_at: new Date().toISOString() },
    { key: "fx_to_qar", value: cleanFx, updated_at: new Date().toISOString() },
  ]);
  if (error) return { error: error.message };
  const { error: rpcError } = await supabase.rpc("refresh_all_part_sourcing");
  if (rpcError) return { error: rpcError.message };
  revalidate(locale);
  return { ok: true };
}

export type ShippingSettings = {
  handling_fee_qar: number;
  handling_days: number;
  buffer_days: number;
  tiers: Record<"express" | "standard" | "economy", { carrier_cost_qar: number; transit_days: number }>;
};

/** Shipping tiers (real carrier cost + transit), handling fee/days, buffer (Task 18f). */
export async function saveShippingSettings(locale: string, s: ShippingSettings) {
  await requireAdmin();
  const n = (v: unknown, min = 0) => Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min);
  const d = (v: unknown) => Math.trunc(n(v));
  const tier = (k: "express" | "standard" | "economy") => ({
    carrier_cost_qar: n(s.tiers?.[k]?.carrier_cost_qar),
    transit_days: d(s.tiers?.[k]?.transit_days),
  });
  const value = {
    handling_fee_qar: n(s.handling_fee_qar),
    handling_days: d(s.handling_days),
    buffer_days: d(s.buffer_days),
    tiers: { express: tier("express"), standard: tier("standard"), economy: tier("economy") },
  };
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "shipping", value, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidate(locale);
  return { ok: true };
}
