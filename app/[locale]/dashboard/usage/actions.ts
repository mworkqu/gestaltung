"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { AI_PRICE_QAR } from "@/lib/credits/constants";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { TURNSTILE_KEY } from "@/lib/turnstile";
import { CLEANUP_KEY, clampDays, cleanupSettingsValue } from "@/lib/cleanup/anonymous";

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

// P2-08: the Turnstile switch (store_settings.turnstile). revalidateStorefront()
// so cached pages and the server check pick it up at once (tag "store-settings").
export async function saveTurnstileSwitch(locale: string, enabled: boolean) {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: TURNSTILE_KEY, value: { enabled: enabled === true }, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/usage`);
  return { ok: true };
}

// P2-09: the weekly guest cleanup (store_settings.anonymous_cleanup).
export async function saveCleanupSettings(locale: string, next: { enabled: boolean; dryRun: boolean; days: number }) {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
  const value = cleanupSettingsValue({ enabled: next.enabled === true, dryRun: next.dryRun !== false, days: clampDays(next.days) });
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: CLEANUP_KEY, value, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/usage`);
  return { ok: true };
}
