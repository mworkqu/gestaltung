"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { CONTACT_PHONE_KEY, parseContactPhoneInput } from "@/lib/contact-phone";

// Dashboard → Settings → Contact info. One number for WhatsApp + tel:, stored
// as E.164 in store_settings.contact_phone (RLS: super_admin). The storefront
// tags are purged so every cached page shows the new number at once.
export async function saveContactPhone(locale: string, raw: string): Promise<{ ok: true; e164: string } | { error: string }> {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
  const e164 = parseContactPhoneInput(raw);
  if (!e164) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: CONTACT_PHONE_KEY, value: e164, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidateStorefront();
  revalidatePath("/", "layout");
  return { ok: true, e164 };
}
