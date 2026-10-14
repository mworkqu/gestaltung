// Plan, cohort and enrollment rules (Prompt 10 Steps A, B, F). PURE, tested.

export const RESERVATION_HOURS = 48;
export const RENEW_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanKind = "online" | "online_in_person" | "kit";

export interface PlanLike {
  kind: PlanKind | string | null;
  price_qar: number | string | null;
  duration_days: number | null;
  is_active: boolean;
  includes_in_person?: boolean | null;
}

export function priceOf(plan: Pick<PlanLike, "price_qar">): number | null {
  if (plan.price_qar == null || plan.price_qar === "") return null;
  const n = Number(plan.price_qar);
  return Number.isFinite(n) ? n : null;
}

export function needsCohort(plan: Pick<PlanLike, "kind" | "includes_in_person">): boolean {
  return plan.kind === "online_in_person" || !!plan.includes_in_person;
}

/** A training plan can be bought: active, priced above 0 and with a duration. */
export function isPurchasable(plan: PlanLike): boolean {
  if (!plan.is_active || plan.kind === "kit") return false;
  const price = priceOf(plan);
  return price != null && price > 0 && plan.duration_days != null && plan.duration_days > 0;
}

/** The kit add-on can be added: active and priced. */
export function isAddonAvailable(plan: PlanLike | null | undefined): boolean {
  if (!plan || !plan.is_active || plan.kind !== "kit") return false;
  const price = priceOf(plan);
  return price != null && price > 0;
}

/** Prices show only after a submitted diagnostic test (staff always). */
export function canSeePrices(input: { firstTestSubmittedAt: string | null | undefined; isStaff: boolean }): boolean {
  return input.isStaff || !!input.firstTestSubmittedAt;
}

export type CohortAvailability = "open" | "full" | "closed";

export function cohortAvailability(cohort: { status: string; seats_total: number }, taken: number): CohortAvailability {
  if (cohort.status === "full") return "full";
  if (cohort.status !== "open") return "closed";
  return taken >= cohort.seats_total ? "full" : "open";
}

export function seatsLeft(cohort: { seats_total: number }, taken: number): number {
  return Math.max(0, cohort.seats_total - Math.max(0, taken));
}

export function reservationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESERVATION_HOURS * 60 * 60 * 1000);
}

/** Whole days left (rounded up), 0 when ended. */
export function daysLeft(endsAt: string | Date, now: Date = new Date()): number {
  const ms = new Date(endsAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** The renewal path opens when fewer than 14 days are left (or it has ended). */
export function canRenew(endsAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!endsAt) return true;
  return daysLeft(endsAt, now) < RENEW_WINDOW_DAYS;
}

export type ReminderKind = "7d" | "1d";

/** The expiry reminder due now for an active enrollment, or null. 1 d wins over 7 d. */
export function reminderDue(
  e: { ends_at: string; status: string; reminder_7d_sent_at: string | null; reminder_1d_sent_at: string | null },
  now: Date = new Date(),
): ReminderKind | null {
  if (e.status !== "active") return null;
  const ms = new Date(e.ends_at).getTime() - now.getTime();
  if (ms <= 0) return null;
  if (ms <= DAY_MS) return e.reminder_1d_sent_at ? null : "1d";
  if (ms <= 7 * DAY_MS) return e.reminder_7d_sent_at ? null : "7d";
  return null;
}
