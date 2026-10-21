"use server";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateContactPhone } from "@/lib/cache/storefront";
import { CONTACT_PHONE_KEY, parseContactPhoneInput } from "@/lib/contact-phone";

// Dashboard → Settings → Contact info. One number for WhatsApp + tel:, stored
// as E.164 in store_settings.contact_phone (RLS: super_admin). Only the number's
// own cache tag is purged: every page that shows it still re-renders, but the
// catalogue reads behind the 2,600 product pages stay cached, where the old
// revalidateStorefront() + revalidatePath("/", "layout") pair threw the whole
// store away for a phone number (Vercel ISR writes).
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
  revalidateContactPhone();
  return { ok: true, e164 };
}
