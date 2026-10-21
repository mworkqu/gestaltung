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

// ── The two floors ───────────────────────────────────────────────────────────
// "Income" means two different things, so one floor cannot judge both. On a
// markup part the income is OUR margin (price − landed cost), and the floor is
// a decision we can act on: raise the price or pick another supplier. On a
// mirror part the income IS the supplier's commission — income_pct always
// equals commission_percent exactly — so the only lever is the supplier's
// terms. Comparing Voltaat's 10% commission to a 15% margin floor flagged
// every mirror product forever (911 of them) and buried the markup parts where
// the floor means something. Migration 0098 gives each its own floor.

/** store_settings.margin_floor_pct — the lowest margin we accept on a part we price. */
export const DEFAULT_MARGIN_FLOOR_PCT = 15;

/** store_settings.commission_floor_pct — the lowest commission we accept from a mirror supplier. */
export const DEFAULT_COMMISSION_FLOOR_PCT = 8;

export type Floors = {
  /** margin_floor_pct, for markup parts. */
  marginFloorPct: number;
  /** commission_floor_pct, for mirror parts. */
  commissionFloorPct: number;
};

/** A setting read out of store_settings.value, which may be missing or junk. */
export function floorSetting(value: unknown, fallback: number): number {
  // Number("") is 0, which would silently turn a blank input into "flag nothing".
  const n = typeof value === "string" ? (value.trim() === "" ? null : Number(value)) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** Both floors from the two store_settings rows (missing or junk → the defaults). */
export function readFloors(margin: unknown, commission: unknown): Floors {
  return {
    marginFloorPct: floorSetting(margin, DEFAULT_MARGIN_FLOOR_PCT),
    commissionFloorPct: floorSetting(commission, DEFAULT_COMMISSION_FLOOR_PCT),
  };
}

/** The floor a part of this pricing mode is measured against. Mirrors the SQL in 0098. */
export function floorFor(mode: PricingMode, floors: Floors): number {
  return mode === "mirror" ? floors.commissionFloorPct : floors.marginFloorPct;
}

/**
 * Whether a part's income is under its own floor. The database keeps
 * parts.below_floor in step with this (migration 0098); this is for the admin
 * UI, which needs the same answer before a refresh has run.
 */
export function isBelowFloor(mode: PricingMode, incomePct: number | null, floors: Floors): boolean {
  return incomePct !== null && incomePct < floorFor(mode, floors);
}
