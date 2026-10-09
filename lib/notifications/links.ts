// Pure helpers for the notification emails: links and cron auth.

import { timingSafeEqual } from "node:crypto";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { ratingUrls } from "@/lib/orders/rating";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const pid = typeof opts.projectId === "string" && UUID.test(opts.projectId) ? opts.projectId : null;
  const oid = typeof opts.orderId === "string" && UUID.test(opts.orderId) ? opts.orderId : null;
  const rating = oid && opts.ratingSecret ? ratingUrls(base, oid, opts.ratingSecret, opts.locale) : [];
  return {
    siteUrl: base,
    projectsUrl: `${loc}/projects`,
    storeUrl: `${loc}/store`,
    ...(pid ? { projectUrl: `${loc}/projects/${pid}` } : {}),
    ...(oid ? { orderUrl: `${loc}/orders/${oid}` } : {}),
    ...(rating.length ? { ratingUrls: rating } : {}),
    unsubscribeUrl: opts.transactional ? "" : unsubscribeUrl(base, opts.token, opts.kind, opts.locale),
    whatsappUrl: COMPANY_WHATSAPP.url,
  };
}

/** RFC 2369 / RFC 8058 headers for one email. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Cron auth: the Authorization header must be exactly `Bearer <secret>`.
 * An unset/empty secret never authorizes (the route then refuses to run).
 */
export function isAuthorizedCron(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  if (!header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
