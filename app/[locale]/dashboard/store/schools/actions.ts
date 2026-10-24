"use server";

import { revalidatePath } from "next/cache";

import { getSessionContextCached } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import {
  SCHOOL_PRICING_KEY,
  validateSchoolPricing,
  type SchoolPricing,
  type SchoolPricingError,
} from "@/lib/schools/pricing";
import { asLocale } from "@/lib/locale";

// School prices: store_settings.school_pricing. super_admin only — checked here
// and again by RLS (store_settings_write). Validated with the same schema the
// public read uses (lib/schools/pricing.ts), so a saved row is always one
// /schools can show in full.
export type SaveSchoolPricingResult =
  | { ok: true; value: SchoolPricing }
  | { ok: false; errors: SchoolPricingError[]; message?: string };

export async function saveSchoolPricing(locale: string, input: unknown): Promise<SaveSchoolPricingResult> {
  const session = await getSessionContextCached();
  if (session?.profile.role !== "super_admin") return { ok: false, errors: [], message: "forbidden" };

  const checked = validateSchoolPricing(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: SCHOOL_PRICING_KEY, value: checked.value, updated_at: new Date().toISOString() });
  // 42P01 = store_settings missing entirely (migration 0096 not run yet).
  if (error) return { ok: false, errors: [], message: error.code === "42P01" ? "run_migration" : error.message };

  revalidateStorefront();
  const safeLocale = asLocale(locale);
  revalidatePath(`/${safeLocale}/dashboard/store/schools`);
  revalidatePath(`/${safeLocale}/schools`);
  return { ok: true, value: checked.value };
}
