// GA4 funnel events (P1-08 / WF-10). Client-safe and consent-gated.
//
// `track()` does nothing unless ALL of these hold on this very call:
//   - the visitor's stored cookie choice is "accepted" (read from localStorage
//     and the first-party cookie each time, so an Accept pressed a minute ago
//     counts without a reload; the cost is two string reads);
//   - window.gtag exists (components/cookie-notice.tsx defines it only after an
//     Accept and only when a GA ID is configured, so with no ID nothing fires).
// It never throws: a blocked storage, a throwing gtag or a server render all
// end in a silent no-op. Parameters are limited to small scalars (short
// strings, finite numbers, booleans); everything else is dropped, so no object,
// array or personal free text can reach Google by accident.
//
// Events are the funnel from "chose a path" to "order placed". `order_delivered`
// happens in an admin server action, never in a visitor's browser, so it has no
// client event (the admin Funnel card counts it from part_orders instead).

import { CONSENT_COOKIE, CONSENT_STORAGE_KEY, readCookie, resolveConsent } from "@/lib/analytics/consent";

export type AnalyticsEvents = {
  path_chosen: { path: "shop" | "make" | "plan" };
  project_created: { method: "chat" | "form" | "drawing" | "quote" };
  bom_generated: { lines: number };
  circuit_generated: { cost: "credit" | "blocked" };
  cad_generated: Record<string, never>;
  add_to_cart: { sku: string; qty: number };
  checkout_started: { items: number; total_qar: number };
  order_placed: { order_id: string; total_qar: number; method: string };
  phone_captured: { where: "bom" | "save-link" | "quote" };
  pricing_viewed: { plan?: string };
  // P3-06 kit attach rate: a whole BOM added as one project kit, and an
  // upsell product added from the BOM ("Also useful") or a product page
  // ("Frequently bought together" / "You may also need").
  kit_added: { lines: number; total_qar: number };
  upsell_added: { sku: string; where: "bom" | "product" };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

type Scalar = string | number | boolean;

const MAX_STRING = 100;
const MAX_PARAMS = 10;

/** Keep only small scalars: strings (cut to 100 chars), finite numbers, booleans. */
export function cleanParams(params: unknown): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!params || typeof params !== "object" || Array.isArray(params)) return out;
  let n = 0;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (n >= MAX_PARAMS) break;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else continue;
    n++;
  }
  return out;
}

/** True when the visitor pressed Accept (read fresh from both stores). */
export function consentAccepted(): boolean {
  try {
    if (typeof window === "undefined") return false;
    let local: string | null = null;
    try {
      local = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    } catch {
      // Storage blocked: the cookie may still be there.
    }
    const cookie = typeof document === "undefined" ? null : readCookie(document.cookie, CONSENT_COOKIE);
    return resolveConsent({ local, cookie }, Date.now()) === "accepted";
  } catch {
    return false;
  }
}

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

/** Send one funnel event to GA4. A no-op before Accept, without gtag, or on any error. */
export function track<E extends AnalyticsEvent>(event: E, params?: AnalyticsEvents[E]): void {
  try {
    if (!consentAccepted()) return;
    const gtag = (window as GtagWindow).gtag;
    if (typeof gtag !== "function") return;
    gtag("event", event, cleanParams(params));
  } catch {
    // Analytics must never break the page.
  }
}
