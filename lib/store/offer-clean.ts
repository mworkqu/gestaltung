// One supplier offer as the admin typed it → the row written to
// supplier_offers. Shared by the product Sourcing panel ("Add offer") and the
// Fix list (D1: "Set delivery time", drawer mini-form). Pure.

import { AVAILABILITIES, type Availability } from "@/lib/store/sourcing";

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

export const offerNum = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const int1 = (v: unknown) => Math.max(1, Math.trunc(Number(v)) || 1);
export const offerText = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export function cleanOffer(o: OfferInput) {
  const url = offerText(o.supplier_url);
  const lead = offerNum(o.lead_time_days);
  return {
    supplier_id: o.supplier_id,
    supplier_sku: offerText(o.supplier_sku),
    supplier_url: url && /^https?:\/\//i.test(url) ? url : null,
    cost: offerNum(o.cost),
    retail_price: offerNum(o.retail_price),
    currency: (offerText(o.currency) ?? "USD").toUpperCase().slice(0, 3),
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
