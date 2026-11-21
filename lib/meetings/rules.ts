/**
 * The meeting rules, mirroring migration 0113 exactly: the move / cancel
 * window, the forward-only status ladder and the order-credit window. The SQL
 * is the authority; these are for the UI, the tools and the e-mails, and
 * rules.test.ts checks both agree. Pure.
 */

import { DAY_MS } from "@/lib/format/date";

import type { MeetingSettings } from "./settings";

export const MEETING_STATUSES = ["booked", "cancelled", "done", "no_show", "invoiced", "paid"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Forward only, exactly as set_meeting_status() allows. */
const FORWARD: Record<MeetingStatus, readonly MeetingStatus[]> = {
  booked: ["done", "no_show", "cancelled"],
  done: ["invoiced"],
  invoiced: ["paid"],
  cancelled: [],
  no_show: [],
  paid: [],
};

export function nextStatuses(from: MeetingStatus): readonly MeetingStatus[] {
  return FORWARD[from];
}

export function canSetStatus(from: MeetingStatus, to: MeetingStatus): boolean {
  return FORWARD[from].includes(to);
}

/** A meeting still ahead of us that has not been cancelled or missed. */
export function isLive(status: MeetingStatus): boolean {
  return status !== "cancelled" && status !== "no_show";
}

/**
 * Free to move or cancel until `cancel_free_hours` before the start — and only
 * while the meeting is still 'booked'. After that the client messages us on
 * WhatsApp; no invoice follows a cancelled meeting either way.
 */
export function canChangeOnline(
  input: { startsAt: string | number; status: MeetingStatus },
  settings: MeetingSettings,
  nowMs: number,
): boolean {
  if (input.status !== "booked") return false;
  const ms = typeof input.startsAt === "number" ? input.startsAt : Date.parse(input.startsAt);
  if (!Number.isFinite(ms)) return false;
  return nowMs <= ms - settings.cancel_free_hours * 3_600_000;
}

/** The instant the free-change window closes. */
export function changeDeadline(startsAt: string | number, settings: MeetingSettings): string {
  const ms = typeof startsAt === "number" ? startsAt : Date.parse(startsAt);
  return new Date(ms - settings.cancel_free_hours * 3_600_000).toISOString();
}

/** Far enough ahead to book (the notice window). */
export function hasEnoughNotice(startsAt: string | number, settings: MeetingSettings, nowMs: number): boolean {
  const ms = typeof startsAt === "number" ? startsAt : Date.parse(startsAt);
  return Number.isFinite(ms) && ms >= nowMs + settings.min_notice_hours * 3_600_000;
}

/** How many future live meetings one phone number may hold. */
export const MAX_FUTURE_PER_PHONE = 2;

export type CreditInput = {
  status: MeetingStatus;
  /** When the meeting took place. */
  startsAt: string | number;
  /** When the order was created. */
  orderCreatedAt: string | number;
  /** Set once the credit has been used. */
  creditOrderId?: string | null;
};

export type CreditCheck = { ok: true } | { ok: false; reason: "not_paid" | "already_used" | "out_of_window" };

/**
 * The QAR 150 comes off a manufacturing order placed within `order_credit_days`
 * AFTER a meeting the client paid for, once per meeting. Mirrors
 * apply_meeting_credit(); it changes no order total — the owner deducts it when
 * he confirms the price.
 */
export function creditCheck(input: CreditInput, settings: MeetingSettings): CreditCheck {
  if (input.status !== "paid") return { ok: false, reason: "not_paid" };
  if (input.creditOrderId) return { ok: false, reason: "already_used" };

  const met = typeof input.startsAt === "number" ? input.startsAt : Date.parse(input.startsAt);
  const made = typeof input.orderCreatedAt === "number" ? input.orderCreatedAt : Date.parse(input.orderCreatedAt);
  if (!Number.isFinite(met) || !Number.isFinite(made)) return { ok: false, reason: "out_of_window" };
  if (made < met || made > met + settings.order_credit_days * DAY_MS) return { ok: false, reason: "out_of_window" };

  return { ok: true };
}

/** The credit amount to take off, or 0 when none applies. */
export function creditAmount(input: CreditInput, settings: MeetingSettings): number {
  return creditCheck(input, settings).ok ? settings.price_qar : 0;
}
