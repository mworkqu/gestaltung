// Pure rules for the notification drainer (app/api/cron/notifications).
// No I/O here: the route claims rows from notification_outbox (0046), asks
// these functions what to do, and records the outcome.
//
// Dedupe is NOT done here: the unique index notification_outbox_dedupe on
// (user_id, kind, payload->>'ref') stops an event being queued twice, in the
// database. dedupeKey() only mirrors that key for display and tests.

export const OUTBOX_KINDS = [
  "credits_order_delivered",
  "credits_admin_grant",
  "first_project",
  "first_circuit",
  "discount_ready",
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const MAX_ATTEMPTS = 3;

/** Owner defaults when store_settings.notifications is missing a kind. */
export const DEFAULT_KIND_SETTINGS: Record<OutboxKind, boolean> = {
  credits_order_delivered: true,
  credits_admin_grant: true,
  first_project: true,
  first_circuit: true,
  // Disabled until the "30 days from the day the credit is earned" rule
  // exists in the ledger (see 0046 header).
  discount_ready: false,
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

export type SkipReason = "disabled" | "unsubscribed" | "no_email" | "unknown_kind" | "no_token";
export type Decision = "send" | { skip: SkipReason };

export function isOutboxKind(v: unknown): v is OutboxKind {
  return typeof v === "string" && (OUTBOX_KINDS as readonly string[]).includes(v);
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
export function decide(row: OutboxRow, settings: Record<OutboxKind, boolean>, prefs: Prefs | null): Decision {
  if (!isOutboxKind(row.kind)) return { skip: "unknown_kind" };
  if (!settings[row.kind]) return { skip: "disabled" };
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
