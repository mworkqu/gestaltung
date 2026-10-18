// Server read of the contact number (store_settings.contact_phone, anon
// readable). Cached like the shipping settings: React cache() within a render,
// unstable_cache across renders under the "store-settings" tag, so the
// dashboard save (revalidateStorefront) refreshes every page at once.
//
// peekContactPhone() is for synchronous code (email shells, the rating page):
// it returns the last value this server instance loaded, else the default, and
// starts a load so the next call is current. Async callers that send email
// should `await getContactPhone()` first (the notification drain does).

import { cache } from "react";
import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { CONTACT_PHONE_KEY, contactPhoneFromSetting, DEFAULT_CONTACT_PHONE, type ContactPhone } from "@/lib/contact-phone";
import { peekContactPhone, registerContactPhoneLoader, setCurrentContactPhone } from "@/lib/contact-phone-current";

export { peekContactPhone };

const readContactPhoneValue = unstable_cache(
  async (): Promise<unknown> => {
    const supabase = createPublicClient();
    if (!supabase) return null;
    const { data } = await supabase.from("store_settings").select("value").eq("key", CONTACT_PHONE_KEY).maybeSingle();
    return data?.value ?? null;
  },
  ["store-settings:contact_phone"],
  { revalidate: STOREFRONT_REVALIDATE, tags: [SETTINGS_TAG] },
);

let last: ContactPhone | null = null;
let loading: Promise<ContactPhone> | null = null;

export const getContactPhone = cache(async (): Promise<ContactPhone> => {
  try {
    const phone = contactPhoneFromSetting(await readContactPhoneValue());
    last = phone;
    setCurrentContactPhone(phone);
    return phone;
  } catch {
    return last ?? DEFAULT_CONTACT_PHONE;
  }
});

// peekContactPhone (re-exported from lib/contact-phone-current) starts this
// load when nothing has been read yet on this server instance.
registerContactPhoneLoader(() => {
  if (loading) return;
  loading = getContactPhone().finally(() => {
    loading = null;
  });
  loading.catch(() => undefined);
});
