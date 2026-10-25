// Pure helpers for the notification emails: links (and a cron-auth re-export).

import { peekContactPhone } from "@/lib/contact-phone-server";
import { ratingUrls } from "@/lib/orders/rating";
import { isUuid } from "@/lib/uuid";

export type NotificationLinks = {
  siteUrl: string;
  projectsUrl: string;
  storeUrl: string;
  projectUrl?: string;
  /** /<locale>/orders/<id>, order emails only. */
  orderUrl?: string;
  /** Five one-tap score links (1 → 5), order_delivered only. */
  ratingUrls?: string[];
  /** Empty for transactional (order) emails: no unsubscribe link. */
  unsubscribeUrl: string;
  whatsappUrl: string;
};

/** One-click / confirmation link: /api/notifications/unsubscribe?token=…&kind=…&locale=… */
export function unsubscribeUrl(siteUrl: string, token: string, kind: string, locale: "en" | "ar"): string {
  const base = siteUrl.replace(/\/+$/, "");
  const q = new URLSearchParams({ token, kind, locale });
  return `${base}/api/notifications/unsubscribe?${q.toString()}`;
}

/**
 * Every link a template may use, locale-prefixed. projectUrl only for a real
 * project id; orderUrl (and, with a rating secret, the five score links) only
 * for a real order id. `transactional` (order emails) → no unsubscribe link.
 */
export function buildLinks(opts: {
  siteUrl: string;
  locale: "en" | "ar";
  token: string;
  kind: string;
  projectId?: unknown;
  orderId?: unknown;
  ratingSecret?: string | null;
  transactional?: boolean;
}): NotificationLinks {
  const base = opts.siteUrl.replace(/\/+$/, "");
  const loc = `${base}/${opts.locale}`;
  const pid = isUuid(opts.projectId) ? opts.projectId : null;
  const oid = isUuid(opts.orderId) ? opts.orderId : null;
  const rating = oid && opts.ratingSecret ? ratingUrls(base, oid, opts.ratingSecret, opts.locale) : [];
  return {
    siteUrl: base,
    projectsUrl: `${loc}/projects`,
    storeUrl: `${loc}/store`,
    ...(pid ? { projectUrl: `${loc}/projects/${pid}` } : {}),
    ...(oid ? { orderUrl: `${loc}/orders/${oid}` } : {}),
    ...(rating.length ? { ratingUrls: rating } : {}),
    unsubscribeUrl: opts.transactional ? "" : unsubscribeUrl(base, opts.token, opts.kind, opts.locale),
    whatsappUrl: peekContactPhone().whatsappUrl,
  };
}

/** RFC 2369 / RFC 8058 headers for one email. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Cron auth lives in lib/auth/cron.ts; re-exported so existing imports keep working.
export { isAuthorizedCron } from "@/lib/auth/cron";

// Re-exported so existing imports keep working; the implementation is lib/uuid.ts.
export { isUuid };
