// Plans and service prices (P1-06 / P1-07): the numbers are DATA, never
// component literals. They live in store_settings under two keys, seeded by
// supabase/migrations/0051_pricing_settings.sql with `on conflict do nothing`
// so an owner edit survives re-runs. These defaults are the SAME values as the
// seed: the page renders identically before 0051 runs, and any missing or
// invalid stored value falls back to them (lib/pricing/plans.ts).
//
// DEFAULTS — OWNER TO CONFIRM (2026-10-09). Plans are display-only until card
// payments exist (Phase 4): nothing here bills anyone. Change a number in the
// migration AND here, or edit the store_settings row directly.

export const PRICING_PLANS_KEY = "pricing_plans";
export const SERVICE_PRICES_KEY = "service_prices";

export type PlanId = "maker" | "builder" | "studio" | "institutions";
export type PaidPlanId = Exclude<PlanId, "institutions">;
export type HumanHelp = "whatsapp" | "priority_quotes" | "engineer_hour";

/** A plan with a published monthly price (Maker is the free one). */
export type PaidPlan = {
  id: PaidPlanId;
  price_qar_month: number;
  /** null = no limit. */
  active_projects: number | null;
  wiring_per_month: number;
  cad_per_month: number;
  first_circuit_free: boolean;
  bom: boolean;
  human: HumanHelp;
  kit_discount_pct: number;
  /** The plan we want most people to pick ("Most teams pick this"). */
  target?: boolean;
  /** Shown first on wide screens, so the others read against it. */
  anchor?: boolean;
};

/** Priced by conversation: no number on the page. */
export type ContactPlan = { id: "institutions"; contact: true };

export type Plan = PaidPlan | ContactPlan;

export type PricingPlans = {
  currency: "QAR";
  overage_per_credit_qar: number;
  refund_window_days: number;
  plans: Plan[];
};

export type ServicePrices = {
  currency: "QAR";
  enclosure_from: number;
  /** EDM work, "from" price on /design/quote. Added after 0051 (see 0062). */
  edm_from: number;
  drawing_simple: number;
  drawing_assembly: number;
  drawing_complex_from: number;
  sprint_from: number;
  pilot_from: number;
};

export const DEFAULT_PRICING_PLANS: PricingPlans = {
  currency: "QAR",
  overage_per_credit_qar: 20,
  refund_window_days: 30,
  plans: [
    {
      id: "maker",
      price_qar_month: 0,
      active_projects: 3,
      wiring_per_month: 0,
      cad_per_month: 0,
      first_circuit_free: true,
      bom: true,
      human: "whatsapp",
      kit_discount_pct: 0,
    },
    {
      id: "builder",
      price_qar_month: 149,
      active_projects: 10,
      wiring_per_month: 5,
      cad_per_month: 2,
      first_circuit_free: true,
      bom: true,
      human: "priority_quotes",
      kit_discount_pct: 5,
      target: true,
    },
    {
      id: "studio",
      price_qar_month: 399,
      active_projects: null,
      wiring_per_month: 15,
      cad_per_month: 6,
      first_circuit_free: true,
      bom: true,
      human: "engineer_hour",
      kit_discount_pct: 10,
      anchor: true,
    },
    { id: "institutions", contact: true },
  ],
};

export const DEFAULT_SERVICE_PRICES: ServicePrices = {
  currency: "QAR",
  enclosure_from: 800,
  edm_from: 350,
  drawing_simple: 200,
  drawing_assembly: 450,
  drawing_complex_from: 800,
  sprint_from: 20000,
  pilot_from: 15000,
};
