"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { AI_PRICE_QAR } from "@/lib/credits/constants";
import { createClient } from "@/lib/supabase/server";

// AI generation pricing (0038): price per AI call and whether it's charged.
// super_admin only (and RLS on store_settings).
export async function saveAiPricing(locale: string, perCallQar: number, charging: boolean) {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
  const price = Number.isFinite(perCallQar) && perCallQar >= 0 ? Math.round(perCallQar * 100) / 100 : AI_PRICE_QAR;
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "ai_pricing", value: { per_call_qar: price, charging }, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath(`/${locale}/dashboard/usage`);
  return { ok: true };
}
