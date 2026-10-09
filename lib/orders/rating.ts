// One-tap order rating from the "delivered" email (P2-02).
//
// Each score link is /api/orders/rate?order=<id>&score=<1-5>&l=<locale>&t=<token>
// where token = HMAC-SHA256("rating:<order id>") with a server secret, so a
// link can only rate the order it was sent for and nobody can mint one.
// Secret: ORDER_RATING_SECRET, else CRON_SECRET (both server-only). No secret
// → no rating links in the email and the route refuses every token.
// The route records the score with record_order_rating (0053, service role):
// one row per order in demand_signals (kind "rating"); a second tap changes it.

import { createHmac, timingSafeEqual } from "node:crypto";

export const RATING_SCORES = [1, 2, 3, 4, 5] as const;
export type RatingScore = (typeof RATING_SCORES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ratingSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.ORDER_RATING_SECRET || env.CRON_SECRET || null;
}

/** The token for one order: 32 base64url characters of the HMAC. */
export function ratingToken(orderId: string, secret: string): string {
  return createHmac("sha256", secret).update(`rating:${orderId.toLowerCase()}`).digest("base64url").slice(0, 32);
}

/** Constant-time check of a token against the order id. False on any junk. */
export function verifyRatingToken(orderId: unknown, token: unknown, secret: string | null): boolean {
  if (!secret || typeof orderId !== "string" || !UUID.test(orderId) || typeof token !== "string") return false;
  const want = Buffer.from(ratingToken(orderId, secret));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function parseScore(v: unknown): RatingScore | null {
  const n = typeof v === "string" && /^[1-5]$/.test(v.trim()) ? Number(v.trim()) : typeof v === "number" ? v : NaN;
  return (RATING_SCORES as readonly number[]).includes(n) ? (n as RatingScore) : null;
}

export function ratingUrl(siteUrl: string, orderId: string, score: RatingScore, secret: string, locale: "en" | "ar"): string {
  const base = siteUrl.replace(/\/+$/, "");
  const q = new URLSearchParams({ order: orderId, score: String(score), l: locale, t: ratingToken(orderId, secret) });
  return `${base}/api/orders/rate?${q.toString()}`;
}

/** The five score links (1 → 5), or [] without a valid order id or secret. */
export function ratingUrls(siteUrl: string, orderId: unknown, secret: string | null, locale: "en" | "ar"): string[] {
  if (!secret || typeof orderId !== "string" || !UUID.test(orderId)) return [];
  return RATING_SCORES.map((s) => ratingUrl(siteUrl, orderId, s, secret, locale));
}
