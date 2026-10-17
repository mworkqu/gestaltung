// The company contact number (WhatsApp + tel) as ONE value. The owner edits it
// in Dashboard → Settings → Contact info (store_settings.contact_phone); every
// page, email and client component derives its display text, wa.me link and
// tel: link from here. Pure and client-safe; the database read lives in
// lib/contact-phone-server.ts.

import { COMPANY_PHONE } from "@/lib/company";
import { normalizePhone } from "@/lib/phone";

export const CONTACT_PHONE_KEY = "contact_phone";

export type ContactPhone = {
  /** Bare E.164, e.g. "+97466567410" (what is stored). */
  e164: string;
  /** How it is shown: "+974 6656 7410". */
  display: string;
  /** "https://wa.me/97466567410" (no text; use whatsappLink() for a prefilled message). */
  whatsappUrl: string;
  /** "tel:+97466567410" */
  tel: string;
};

/** Build every form of the number from one E.164 value. */
export function contactPhoneFrom(e164: string): ContactPhone {
  const digits = e164.replace(/\D/g, "");
  const m = /^\+974(\d{4})(\d{4})$/.exec(e164);
  return {
    e164,
    display: m ? `+974 ${m[1]} ${m[2]}` : e164,
    whatsappUrl: `https://wa.me/${digits}`,
    tel: `tel:${e164}`,
  };
}

/** Used until the owner saves a number (and whenever the database is unreachable). */
export const DEFAULT_CONTACT_PHONE: ContactPhone = contactPhoneFrom(COMPANY_PHONE.tel.replace(/^tel:/, ""));

/** Normalise what the owner typed; null when it is not a number we can dial. */
export function parseContactPhoneInput(raw: string): string | null {
  const n = normalizePhone(raw);
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

/** The stored store_settings value → ContactPhone (default when missing or malformed). */
export function contactPhoneFromSetting(value: unknown): ContactPhone {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "e164" in value
        ? String((value as { e164: unknown }).e164)
        : "";
  const e164 = raw ? parseContactPhoneInput(raw) : null;
  return e164 ? contactPhoneFrom(e164) : DEFAULT_CONTACT_PHONE;
}

/** wa.me link with a prefilled message. */
export function whatsappLink(phone: ContactPhone, text: string): string {
  return `${phone.whatsappUrl}?text=${encodeURIComponent(text)}`;
}
