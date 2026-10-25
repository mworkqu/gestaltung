// School pricing. store_settings.school_pricing (seeded by migration 0096,
// edited in Dashboard → Store → Schools):
//
//   team_pack   { credits, qar }   credits a teacher buys for one team
//   class_pack  { credits, qar }   credits for a whole class
//   print       { base_qar, per_gram_qar }   the school 3D-print rule
//   free_delivery_class_order      Economy delivery is QAR 0 on a class order
//
// Credits are still granted by hand by the admin (there is no card payment), so
// these numbers are what the teacher is QUOTED — on /schools and on the class
// page's "Buy credits" WhatsApp message.
//
// Pure (no Next runtime, no I/O): tested in lib/schools/pricing.test.ts. The
// public read is getSchoolPricing() in lib/store/public-catalog.ts; the admin
// editor validates with the same schema (validateSchoolPricing). Keep the
// defaults identical to the 0096 seed.

import { z } from "zod";
import { round2 } from "@/lib/format/money";

export const SCHOOL_PRICING_KEY = "school_pricing";

const packSchema = z.object({
  credits: z.number().int().min(1).max(500),
  qar: z.number().min(0).max(100_000),
});

const printSchema = z.object({
  base_qar: z.number().min(0).max(10_000),
  per_gram_qar: z.number().min(0).max(100),
});

export const schoolPricingSchema = z.object({
  team_pack: packSchema,
  class_pack: packSchema,
  print: printSchema,
  free_delivery_class_order: z.boolean(),
});

export type SchoolPricing = z.infer<typeof schoolPricingSchema>;
export type SchoolCreditPack = z.infer<typeof packSchema>;
export type SchoolPrintRule = z.infer<typeof printSchema>;

/** Identical to the migration 0096 seed. */
export const DEFAULT_SCHOOL_PRICING: SchoolPricing = {
  team_pack: { credits: 3, qar: 49 },
  class_pack: { credits: 15, qar: 199 },
  print: { base_qar: 30, per_gram_qar: 0.7 },
  free_delivery_class_order: true,
};

/** Never throws: anything unreadable falls back to the defaults. */
export function parseSchoolPricing(raw: unknown): SchoolPricing {
  const parsed = schoolPricingSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SCHOOL_PRICING;
}

export type SchoolPricingError = { field: string; code: string };

/** The admin editor's check: the value to store, or the fields to fix. */
export function validateSchoolPricing(
  raw: unknown,
): { ok: true; value: SchoolPricing } | { ok: false; errors: SchoolPricingError[] } {
  const parsed = schoolPricingSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.slice(0, 12).map((i) => ({
      field: i.path.join("."),
      code: i.code,
    })),
  };
}

/** QAR per credit in a pack, for the "works out at …" line. Rounded to fils. */
export function perCreditQar(pack: SchoolCreditPack): number {
  if (pack.credits <= 0) return 0;
  return round2(pack.qar / pack.credits);
}

/**
 * The school 3D-print price for a class project: base + per gram, to fils.
 * Mirrors printPrice() in lib/studio/request-summary.ts, with the school rule
 * instead of the studio one.
 */
export function schoolPrintPrice(grams: number, rule: SchoolPrintRule): number {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
  return round2(rule.base_qar + rule.per_gram_qar * g);
}
