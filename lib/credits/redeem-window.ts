// The QAR 20 redemption window of a spent credit (owner rule, migration 0053):
// it runs for REDEEM_DAYS from the day the credit was EARNED, not from the
// spend. Mirrors public.credit_next_earned_at + spend_credit in SQL:
//   - earn rows = delta > 0 (purchase:, admin_grant, topup:) of that kind, in
//     created_at order (id breaks ties), one unit per credit;
//   - units already used = −sum of the negative rows (spends and negative
//     admin corrections) of that kind;
//   - a new spend consumes the next unit (FIFO); its window ends earned_at +
//     REDEEM_DAYS days. It may already be over: then it is not redeemable.
// Pure; used by tests and by lib/notifications/decide.ts to date the
// discount_ready email when the payload has no valid_until.

import { REDEEM_DAYS, type CreditKind } from "./constants";

export type LedgerRow = { id: string; kind: CreditKind | string; delta: number; created_at: string };

const DAY_MS = 24 * 3600 * 1000;

const byTime = (a: LedgerRow, b: LedgerRow) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** The earn date of the next unit to spend of `kind`, or null when none is left. */
export function nextEarnedAt(rows: readonly LedgerRow[], kind: CreditKind): string | null {
  const mine = rows.filter((r) => r.kind === kind && Number.isFinite(r.delta));
  const used = -mine.filter((r) => r.delta < 0).reduce((s, r) => s + r.delta, 0);
  let cum = 0;
  for (const r of mine.filter((x) => x.delta > 0).sort(byTime)) {
    cum += r.delta;
    if (cum > used) return r.created_at;
  }
  return null;
}

/** earned_at + REDEEM_DAYS days. */
export function redeemableUntil(earnedAt: string | Date): Date {
  const t = typeof earnedAt === "string" ? Date.parse(earnedAt) : earnedAt.getTime();
  return new Date(t + REDEEM_DAYS * DAY_MS);
}

/**
 * What spend_credit writes for a spend made now: the earn date (falls back to
 * `now` when the ledger has no unit left, like the SQL), the end of the window
 * and whether it is still open.
 */
export function spendWindow(
  rows: readonly LedgerRow[],
  kind: CreditKind,
  now: Date = new Date()
): { earnedAt: string; redeemableUntil: string; redeemable: boolean } {
  const earnedAt = nextEarnedAt(rows, kind) ?? now.toISOString();
  const until = redeemableUntil(earnedAt);
  return { earnedAt, redeemableUntil: until.toISOString(), redeemable: until.getTime() > now.getTime() };
}
