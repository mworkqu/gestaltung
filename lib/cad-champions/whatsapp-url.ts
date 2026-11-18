/** wa.me link; returns null when the number has no digits. Pure: safe in client bundles. */
export function buildWhatsAppUrl(number: string | null | undefined, text: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
