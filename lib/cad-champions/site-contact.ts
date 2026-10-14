// Server-side contact details for CAD Champions. Use from server components only
// (the "server-only" package is not installed, so this is a convention).

export interface CcContact {
  whatsappNumber: string | null;
  supportEmail: string;
}

export function getCcContact(): CcContact {
  return {
    whatsappNumber: process.env.WHATSAPP_NUMBER ?? process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? null,
    supportEmail: process.env.SUPPORT_EMAIL ?? "info@gestaltung360.com",
  };
}

/** wa.me link; returns null when the number has no digits. */
export function buildWhatsAppUrl(number: string | null | undefined, text: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
