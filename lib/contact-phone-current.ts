// Last-known contact number, safe to import anywhere (client bundles too).
// lib/contact-phone-server.ts fills it and registers the loader; shared sync
// code (the branded email shell, which the CAD Champions announcement
// composer also renders in the browser) reads it here so it never pulls
// next/cache into a client component.

import { DEFAULT_CONTACT_PHONE, type ContactPhone } from "@/lib/contact-phone";

let current: ContactPhone | null = null;
let loader: (() => void) | null = null;

export function setCurrentContactPhone(phone: ContactPhone): void {
  current = phone;
}

export function registerContactPhoneLoader(load: () => void): void {
  loader = load;
}

/** Sync best effort: last loaded value, else the default (and a load is started on the server). */
export function peekContactPhone(): ContactPhone {
  if (current) return current;
  loader?.();
  return DEFAULT_CONTACT_PHONE;
}
