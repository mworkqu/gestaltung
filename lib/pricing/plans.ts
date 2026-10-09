// Pure rules for the plans and service prices (P1-06 / P1-07). The stored
// store_settings values are public (anon-readable) but still validated: any
// shape that does not match falls back to the defaults as a whole, so the page
// never shows half a plan or a NaN price.

import { z } from "zod";

import {
  DEFAULT_PRICING_PLANS,
  DEFAULT_SERVICE_PRICES,
  type Plan,
  type PricingPlans,
  type ServicePrices,
} from "@/lib/pricing/defaults";

const money = z.number().nonnegative();
const count = z.number().int().nonnegative();

const paidPlanSchema = z.object({
  id: z.enum(["maker", "builder", "studio"]),
  price_qar_month: money,
  active_projects: z.number().int().positive().nullable(),
  wiring_per_month: count,
  cad_per_month: count,
  first_circuit_free: z.boolean(),
  bom: z.boolean(),
  human: z.enum(["whatsapp", "priority_quotes", "engineer_hour"]),
  kit_discount_pct: z.number().min(0).max(100),
  target: z.boolean().optional(),
  anchor: z.boolean().optional(),
});

const contactPlanSchema = z.object({ id: z.literal("institutions"), contact: z.literal(true) });

const pricingPlansSchema = z.object({
  currency: z.literal("QAR"),
  overage_per_credit_qar: z.number().positive(),
  refund_window_days: z.number().int().positive(),
  plans: z
    .array(z.union([contactPlanSchema, paidPlanSchema]))
    .min(1)
    .max(4)
    .refine((plans) => new Set(plans.map((p) => p.id)).size === plans.length, "duplicate plan id"),
});

const servicePricesSchema = z.object({
  currency: z.literal("QAR"),
  enclosure_from: money,
  drawing_simple: money,
  drawing_assembly: money,
  drawing_complex_from: money,
  sprint_from: money,
  pilot_from: money,
});

/** A jsonb value as PostgREST returns it (object), or a JSON string typed in by hand. */
function asJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** store_settings.pricing_plans → validated plans; anything invalid → the defaults. */
export function parsePricingPlans(raw: unknown): PricingPlans {
  const r = pricingPlansSchema.safeParse(asJson(raw));
  return r.success ? (r.data as PricingPlans) : DEFAULT_PRICING_PLANS;
}

/** store_settings.service_prices → validated prices; anything invalid → the defaults. */
export function parseServicePrices(raw: unknown): ServicePrices {
  const r = servicePricesSchema.safeParse(asJson(raw));
  return r.success ? (r.data as ServicePrices) : DEFAULT_SERVICE_PRICES;
}

export const isContactPlan = (p: Plan): p is Extract<Plan, { contact: true }> => "contact" in p;

const priceOf = (p: Plan): number => (isContactPlan(p) ? Number.POSITIVE_INFINITY : p.price_qar_month);

/**
 * Wide screens: the anchor (Studio) first, so the others read against it,
 * then the target (Builder), then the other priced plans from dearest to
 * cheapest, then the contact plan(s). Defaults: studio, builder, maker, institutions.
 */
export function planOrderDesktop(plans: readonly Plan[]): Plan[] {
  const rank = (p: Plan): number => (isContactPlan(p) ? 3 : p.anchor ? 0 : p.target ? 1 : 2);
  return [...plans].sort((a, b) => rank(a) - rank(b) || priceOf(b) - priceOf(a));
}

/** Phones: cheapest first (Maker), contact plan(s) last. Defaults: maker, builder, studio, institutions. */
export function planOrderMobile(plans: readonly Plan[]): Plan[] {
  return [...plans].sort((a, b) => priceOf(a) - priceOf(b));
}

/** A QAR amount with Western digits in both locales and no decimals unless there are fils: 20000 → "20,000". */
export function formatQar(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
}

/** The price of one extra output (one credit) for the "QAR {price} per credit" lines. */
export function formatPerOutput(overagePerCredit: number): string {
  return formatQar(overagePerCredit);
}
