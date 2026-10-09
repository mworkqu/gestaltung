// Pure rules for the notification drainer (app/api/cron/notifications).
// No I/O here: the route claims rows from notification_outbox (0046), asks
// these functions what to do, and records the outcome.
//
// Dedupe is NOT done here: the unique index notification_outbox_dedupe on
// (user_id, kind, payload->>'ref') stops an event being queued twice, in the
// database. dedupeKey() only mirrors that key for display and tests.
//
// Kind names live in THREE places that must stay in sync: the
// notification_outbox_kind_check constraint (0046, replaced by 0053),
// OUTBOX_KINDS here and NOTIFICATION_KINDS in lib/email/templates/index.ts.

import { redeemableUntil } from "@/lib/credits/redeem-window";

export const ORDER_KINDS = [
  "order_confirmed",
  "order_paid",
  "order_sourcing",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const OUTBOX_KINDS = [
  "credits_order_delivered",
  "credits_admin_grant",
  "first_project",
  "first_circuit",
  "discount_ready",
  ...ORDER_KINDS,
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const MAX_ATTEMPTS = 3;

/** Owner defaults when store_settings.notifications is missing a kind. */
export const DEFAULT_KIND_SETTINGS: Record<OutboxKind, boolean> = {
  credits_order_delivered: true,
  credits_admin_grant: true,
  first_project: true,
  first_circuit: true,
  // On since 0053: the window runs from the day the credit was EARNED.
  discount_ready: true,
  order_confirmed: true,
  order_paid: true,
  order_sourcing: true,
  order_shipped: true,
  order_delivered: true,
  order_cancelled: true,
};

export type OutboxStatus = "queued" | "sent" | "failed" | "skipped";

export type OutboxRow = {
  id: string;
  user_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  locale: string | null;
  email: string | null;
  status: OutboxStatus | string;
  attempts: number;
};

export type Prefs = {
  token: string | null;
  unsubscribed_kinds: string[] | null;
  all_off: boolean | null;
};

export type SkipReason = "disabled" | "unsubscribed" | "no_email" | "unknown_kind" | "no_token" | "expired";
export type Decision = "send" | { skip: SkipReason };

export function isOutboxKind(v: unknown): v is OutboxKind {
  return typeof v === "string" && (OUTBOX_KINDS as readonly string[]).includes(v);
}

/**
 * Order status emails are transactional: no per-kind opt-out, no unsubscribe
 * link or token needed (the unsubscribe page says order emails are not
 * affected). The owner switch in store_settings.notifications still applies.
 */
export function isTransactional(kind: unknown): kind is OrderKind {
  return typeof kind === "string" && (ORDER_KINDS as readonly string[]).includes(kind);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A payload date → epoch ms. A bare YYYY-MM-DD (Qatar day) counts to the END of that day, Qatar time. */
function dateMs(v: unknown, endOfDay: boolean): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const t = DATE_ONLY.test(s) ? Date.parse(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}+03:00`) : Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * The discount_ready window, dated from the EARN day (0053): valid_until from
 * the payload (what redeem_credits honours), else earned_at + 30 days
 * (redeemableUntil, the TS mirror of spend_credit). `expired` = the window
 * closed before `now`; the email is then skipped.
 */
export function discountWindow(
  payload: unknown,
  now: Date = new Date()
): { earnedAt: string | null; validUntil: string | null; expired: boolean } {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const earnedMs = dateMs(p.earned_at, false);
  const earnedAt = earnedMs === null ? null : new Date(earnedMs).toISOString();
  let untilMs = dateMs(p.valid_until, true);
  if (untilMs === null && earnedAt) untilMs = redeemableUntil(earnedAt).getTime();
  const validUntil = untilMs === null ? null : new Date(untilMs).toISOString();
  return { earnedAt, validUntil, expired: untilMs !== null && untilMs <= now.getTime() };
}

/** store_settings.notifications (any shape) → a full on/off map. */
export function kindSettings(value: unknown): Record<OutboxKind, boolean> {
  const out = { ...DEFAULT_KIND_SETTINGS };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of OUTBOX_KINDS) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

/** True when a row may be (re)tried: queued, or failed with attempts left. */
export function isRetryable(row: Pick<OutboxRow, "status" | "attempts">): boolean {
  if (row.attempts >= MAX_ATTEMPTS) return false;
  return row.status === "queued" || row.status === "failed";
}

export function isPlausibleEmail(v: string | null | undefined): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * What to do with one claimed row. Order matters: an owner-disabled kind is
 * skipped before anything else, then the user's opt-out, then a missing email.
 */
export function decide(
  row: OutboxRow,
  settings: Record<OutboxKind, boolean>,
  prefs: Prefs | null,
  now: Date = new Date()
): Decision {
  if (!isOutboxKind(row.kind)) return { skip: "unknown_kind" };
  if (!settings[row.kind]) return { skip: "disabled" };
  if (isTransactional(row.kind)) return isPlausibleEmail(row.email) ? "send" : { skip: "no_email" };
  if (row.kind === "discount_ready" && discountWindow(row.payload, now).expired) return { skip: "expired" };
  if (prefs && (prefs.all_off || (prefs.unsubscribed_kinds ?? []).includes(row.kind))) return { skip: "unsubscribed" };
  if (!isPlausibleEmail(row.email)) return { skip: "no_email" };
  if (!prefs?.token) return { skip: "no_token" };
  return "send";
}

/** The ref the unique index dedupes on (payload->>'ref'), or null. */
export function refOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const ref = (payload as Record<string, unknown>).ref;
  if (typeof ref === "string") return ref.trim() || null;
  if (typeof ref === "number" && Number.isFinite(ref)) return String(ref);
  return null;
}

/** Mirrors the DB key (user_id, kind, payload->>'ref'); null when there is no ref. */
export function dedupeKey(row: Pick<OutboxRow, "user_id" | "kind" | "payload">): string | null {
  const ref = refOf(row.payload);
  return ref ? `${row.user_id}:${row.kind}:${ref}` : null;
}

export function normaliseLocale(v: unknown): "en" | "ar" {
  return v === "ar" ? "ar" : "en";
}
