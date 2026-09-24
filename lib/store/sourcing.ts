// Our product vs. our suppliers' offers (migration 0028). The customer only
// ever sees the product; offers are admin-only. The preferred offer, landed
// cost, income and lead-time class are derived in the database by
// public.refresh_part_sourcing() — this file is only the shapes and labels.

export const PRICING_MODES = ["markup", "mirror"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const AVAILABILITIES = ["in_stock", "limited", "backorder", "unavailable", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const LEAD_TIME_CLASSES = ["in_stock", "3_5_days", "1_2_weeks", "2_4_weeks"] as const;
export type LeadTimeClass = (typeof LEAD_TIME_CLASSES)[number];

export type Supplier = {
  id: string;
  code: string;
  name: string;
  default_pricing_mode: PricingMode;
  commission_percent: number | null;
  landed_overhead_pct: number;
  default_currency: string;
  website: string | null;
  active: boolean;
};

export type SupplierOffer = {
  id: string;
  part_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_url: string | null;
  cost: number | null;
  retail_price: number | null;
  currency: string;
  pack_size: number;
  moq: number;
  availability: Availability;
  lead_time_days: number | null;
  last_checked_at: string | null;
  active: boolean;
};

/** The derived sourcing columns on public.parts. */
export type PartSourcing = {
  pricing_mode: PricingMode;
  pinned_offer_id: string | null;
  preferred_offer_id: string | null;
  landed_cost_qar: number | null;
  expected_income_qar: number | null;
  income_pct: number | null;
  below_floor: boolean;
  lead_time_class: LeadTimeClass | null;
};

/** The only offer fields sourced data (adapters, CSV, daily refresh) may write. */
export const SOURCED_OFFER_FIELDS = [
  "cost",
  "retail_price",
  "currency",
  "availability",
  "lead_time_days",
  "last_checked_at",
] as const;
