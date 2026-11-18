// Direct (uncached) read of the contact number for code outside Next — the Mac
// Mini worker. Sets the value that peekContactPhone() (lib/contact-phone-current)
// returns, so email footers rendered afterwards carry the current number.
// Next code keeps using lib/contact-phone-server.ts (cached, tagged).

import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTACT_PHONE_KEY, contactPhoneFromSetting, type ContactPhone } from "@/lib/contact-phone";
import { peekContactPhone, setCurrentContactPhone } from "@/lib/contact-phone-current";

export async function loadContactPhoneFrom(db: SupabaseClient | null): Promise<ContactPhone> {
  if (!db) return peekContactPhone();
  const { data, error } = await db.from("store_settings").select("value").eq("key", CONTACT_PHONE_KEY).maybeSingle();
  if (error) return peekContactPhone();
  const phone = contactPhoneFromSetting(data?.value ?? null);
  setCurrentContactPhone(phone);
  return phone;
}
