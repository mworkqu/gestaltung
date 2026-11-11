// Server-side contact details for CAD Champions. Use from server components only
// (the "server-only" package is not installed, so this is a convention).
//
// The WhatsApp number is the site-wide contact number the owner edits in
// Dashboard → Settings → Contact info (store_settings.contact_phone, read by
// lib/contact-phone-server.ts) — one number for the whole site, no env var.

import { getContactPhone } from "@/lib/contact-phone-server";

export interface CcContact {
  whatsappNumber: string | null;
  supportEmail: string;
}

export async function getCcContact(): Promise<CcContact> {
  const phone = await getContactPhone();
  return {
    whatsappNumber: phone.e164,
    supportEmail: process.env.SUPPORT_EMAIL ?? "info@gestaltung360.com",
  };
}

/** wa.me link; returns null when the number has no digits. */
export function buildWhatsAppUrl(number: string | null | undefined, text: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
