import { formatPhoneDisplay, isValidPhone } from "@/lib/phone";
import { isPlausibleEmail } from "@/lib/store/shipping";

export type CheckoutPrefill = { name: string; phone: string; email: string };
export const NO_PREFILL: CheckoutPrefill = { name: "", phone: "", email: "" };

/** The slice of the studio profile checkout needs (same shape as Profile). */
type ProfileLike = {
  userId: string | null;
  fullName: string | null;
  phone: string | null;
  email?: string | null;
  guest?: boolean;
};

/**
 * What to put in the checkout form for this profile. Same rules as "Get it
 * made": a stored phone or email must still pass today's validation, and a
 * guest (anonymous) session has nothing worth prefilling.
 */
export function checkoutPrefill(p: ProfileLike | null | undefined): CheckoutPrefill {
  if (!p || !p.userId || p.guest) return NO_PREFILL;
  return {
    name: p.fullName?.trim() ?? "",
    phone: p.phone && isValidPhone(p.phone) ? formatPhoneDisplay(p.phone) : "",
    email: p.email && isPlausibleEmail(p.email) ? p.email : "",
  };
}

/** Fill only the fields the visitor has not typed in yet. */
export function fillEmpty(current: CheckoutPrefill, prefill: CheckoutPrefill): CheckoutPrefill {
  return {
    name: current.name.trim() ? current.name : prefill.name,
    phone: current.phone.trim() ? current.phone : prefill.phone,
    email: current.email.trim() ? current.email : prefill.email,
  };
}
