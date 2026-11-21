/**
 * Server data access for meetings (migration 0113). Server-only.
 *
 * Degrades on purpose: before 0113 runs, every read answers with the defaults
 * or an empty list and every write answers `not_set_up` — PGRST202 (missing
 * function) and 42P01 (missing relation) are detected, never a 500.
 *
 * The manage page authorises by the token itself: only its sha256 is stored, so
 * the lookup hashes the token and reads through the service client.
 */
import "server-only";

import { createHash } from "node:crypto";

import { asLocale } from "@/lib/locale";
import { isMissingFunction, isMissingRelation } from "@/lib/supabase/errors";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";

import { settingsAvailability, type AvailabilityProvider } from "./availability";
import { DEFAULT_MEETING_SETTINGS, MEETING_SETTINGS_KEY, readMeetingSettings, type MeetingMode, type MeetingSettings } from "./settings";
import { qatarDate } from "./slots";
import type { MeetingStatus } from "./rules";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const notSetUp = (e: unknown) => isMissingRelation(e) || isMissingFunction(e);

export type MeetingBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  mode: MeetingMode;
  status: MeetingStatus;
  name: string;
  phone: string;
  email: string | null;
  locale: "en" | "ar";
  topic: string | null;
  project_id: string | null;
  handoff_id: string | null;
  source: "plugin" | "website";
  meet_link: string | null;
  owner_note: string | null;
  invoice_qar: number;
  credit_order_id: string | null;
  created_at: string;
  is_test: boolean;
};

const BOOKING_COLUMNS =
  "id, starts_at, ends_at, mode, status, name, phone, email, locale, topic, project_id, handoff_id, source, meet_link, owner_note, invoice_qar, credit_order_id, created_at, is_test";

// ── settings ─────────────────────────────────────────────────────────────────

/** The owner's meeting rules, or the built-in defaults before 0113 / without a client. */
export async function loadMeetingSettings(): Promise<MeetingSettings> {
  const supabase = createPublicClient();
  if (!supabase) return DEFAULT_MEETING_SETTINGS;
  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select<string, { value: unknown }>("value")
      .eq("key", MEETING_SETTINGS_KEY)
      .maybeSingle();
    if (error) {
      if (notSetUp(error)) return DEFAULT_MEETING_SETTINGS;
      throw error;
    }
    return readMeetingSettings(data?.value);
  } catch (err) {
    if (notSetUp(err)) return DEFAULT_MEETING_SETTINGS;
    console.error("[meetings] settings read failed:", err);
    return DEFAULT_MEETING_SETTINGS;
  }
}

/** Qatar public holidays (store_settings.holidays.dates), empty when unavailable. */
export async function loadHolidays(): Promise<string[]> {
  const supabase = createPublicClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select<string, { value: unknown }>("value")
      .eq("key", "holidays")
      .maybeSingle();
    if (error) {
      if (notSetUp(error)) return [];
      throw error;
    }
    const dates = (data?.value as { dates?: unknown } | null)?.dates;
    return Array.isArray(dates) ? dates.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

// ── availability ─────────────────────────────────────────────────────────────

/** Instants already held by a live booking in the window. */
async function takenSlots(fromIso: string, days: number): Promise<string[]> {
  const svc = createServiceClient() ?? createPublicClient();
  if (!svc) return [];
  const fromMs = Date.parse(`${fromIso}T00:00:00+03:00`);
  const toMs = fromMs + (days + 1) * 86_400_000;
  try {
    const { data, error } = await svc
      .from("meeting_bookings")
      .select<string, { starts_at: string }>("starts_at")
      .gte("starts_at", new Date(fromMs).toISOString())
      .lt("starts_at", new Date(toMs).toISOString())
      .not("status", "in", "(cancelled,no_show)");
    if (error) {
      if (notSetUp(error)) return [];
      throw error;
    }
    return (data ?? []).map((r) => r.starts_at);
  } catch (err) {
    if (notSetUp(err)) return [];
    console.error("[meetings] taken slots read failed:", err);
    return [];
  }
}

/**
 * Today's provider: the settings calendar minus live bookings. Swapping in a
 * Google Calendar provider later means changing only this function.
 */
export async function meetingAvailability(settings?: MeetingSettings): Promise<AvailabilityProvider> {
  const s = settings ?? (await loadMeetingSettings());
  const holidays = await loadHolidays();
  return settingsAvailability({ settings: s, holidays, takenSlots, now: () => new Date() });
}

/** Free slot instants for the next `days` (clamped to the horizon). */
export async function freeMeetingSlots(days?: number, fromIso?: string): Promise<string[]> {
  const provider = await meetingAvailability();
  return provider.freeSlots(fromIso, days);
}

// ── booking ──────────────────────────────────────────────────────────────────

export type BookInput = {
  startsAt: string;
  mode: MeetingMode;
  name: string;
  /** E.164, already validated by lib/phone. */
  phone: string;
  email?: string | null;
  locale?: string;
  topic?: string | null;
  projectId?: string | null;
  handoffId?: string | null;
  source?: "plugin" | "website";
  isTest?: boolean;
};

export type BookError = "slot_taken" | "too_soon" | "bad_slot" | "too_many" | "not_set_up" | "failed";

export type BookResult =
  | { ok: true; booking: MeetingBooking; token: string; manageUrl: string }
  | { ok: false; error: BookError };

const BOOK_ERRORS: BookError[] = ["slot_taken", "too_soon", "bad_slot", "too_many"];

/** The error word book_meeting() raised, if it is one of ours. */
function bookErrorOf(message: string): BookError | null {
  return BOOK_ERRORS.find((e) => message.includes(e)) ?? null;
}

/**
 * Books one meeting through the service-role RPC, which re-checks the weekday,
 * time, holiday, horizon, notice window, mode and the per-phone cap — the
 * database is the authority, so two callers cannot take the same slot.
 */
export async function bookMeeting(input: BookInput, siteUrl: string, token: string): Promise<BookResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, error: "not_set_up" };

  const locale = asLocale(input.locale);
  try {
    const { data, error } = await svc.rpc("book_meeting", {
      p_starts_at: input.startsAt,
      p_mode: input.mode,
      p_name: input.name,
      p_phone: input.phone,
      p_token_hash: sha256(token),
      p_email: input.email ?? null,
      p_locale: locale,
      p_topic: input.topic ?? null,
      p_project_id: input.projectId ?? null,
      p_handoff_id: input.handoffId ?? null,
      p_source: input.source ?? "website",
      p_is_test: input.isTest ?? false,
    });
    if (error) {
      if (notSetUp(error)) return { ok: false, error: "not_set_up" };
      const known = bookErrorOf(error.message ?? "");
      if (known) return { ok: false, error: known };
      throw error;
    }
    const booking = data as unknown as MeetingBooking;
    return { ok: true, booking, token, manageUrl: manageUrlFor(siteUrl, locale, token) };
  } catch (err) {
    if (notSetUp(err)) return { ok: false, error: "not_set_up" };
    const known = bookErrorOf(err instanceof Error ? err.message : "");
    if (known) return { ok: false, error: known };
    console.error("[meetings] book failed:", err);
    return { ok: false, error: "failed" };
  }
}

export function manageUrlFor(siteUrl: string, locale: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${asLocale(locale)}/meetings/${encodeURIComponent(token)}`;
}

// ── the manage page ──────────────────────────────────────────────────────────

/** The booking a manage token names, or null. The token is the authorisation. */
export async function meetingByToken(token: string): Promise<MeetingBooking | null> {
  const svc = createServiceClient();
  if (!svc || !token || token.length < 20 || token.length > 200) return null;
  try {
    const { data, error } = await svc
      .from("meeting_bookings")
      .select<string, MeetingBooking>(BOOKING_COLUMNS)
      .eq("manage_token_hash", sha256(token))
      .maybeSingle();
    if (error) {
      if (notSetUp(error)) return null;
      throw error;
    }
    return data ?? null;
  } catch (err) {
    if (notSetUp(err)) return null;
    console.error("[meetings] token read failed:", err);
    return null;
  }
}

export type TokenActionResult = { ok: true; startsAt?: string } | { ok: false; reason: string };

/** {ok, reason, starts_at} from one of the jsonb-returning RPCs. */
function readActionJson(data: unknown): TokenActionResult {
  const r = (data ?? {}) as { ok?: boolean; reason?: string; starts_at?: string };
  return r.ok ? { ok: true, startsAt: r.starts_at } : { ok: false, reason: r.reason ?? "failed" };
}

/** Wraps one RPC call: missing function / relation means "not set up yet", never a 500. */
// PostgrestFilterBuilder is thenable, not a Promise, so PromiseLike it is.
async function guardedAction(what: string, run: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<TokenActionResult> {
  try {
    const { data, error } = await run();
    if (error) {
      if (notSetUp(error)) return { ok: false, reason: "not_set_up" };
      throw error;
    }
    return readActionJson(data);
  } catch (err) {
    if (notSetUp(err)) return { ok: false, reason: "not_set_up" };
    console.error(`[meetings] ${what} failed:`, err);
    return { ok: false, reason: "failed" };
  }
}

export async function cancelMeeting(token: string): Promise<TokenActionResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, reason: "not_set_up" };
  return guardedAction("cancel", () => svc.rpc("cancel_meeting", { p_token: token }));
}

export async function moveMeeting(token: string, startsAt: string): Promise<TokenActionResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, reason: "not_set_up" };
  return guardedAction("move", () => svc.rpc("move_meeting", { p_token: token, p_starts_at: startsAt }));
}

// ── admin ────────────────────────────────────────────────────────────────────

/** Upcoming or past meetings for Dashboard → Sell → Meetings (super admin, RLS enforced). */
export async function listMeetings(opts: { past?: boolean; limit?: number } = {}): Promise<MeetingBooking[] | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const nowIso = new Date().toISOString();
  try {
    let q = svc.from("meeting_bookings").select<string, MeetingBooking>(BOOKING_COLUMNS);
    q = opts.past
      ? q.lt("starts_at", nowIso).order("starts_at", { ascending: false })
      : q.gte("starts_at", nowIso).order("starts_at", { ascending: true });
    const { data, error } = await q.limit(opts.limit ?? 100);
    if (error) {
      if (notSetUp(error)) return null;
      throw error;
    }
    return data ?? [];
  } catch (err) {
    if (notSetUp(err)) return null;
    console.error("[meetings] list failed:", err);
    return null;
  }
}

/** Meetings starting inside the next 7 days — the Sell → Meetings nav badge. */
export async function upcomingMeetingCount(): Promise<number> {
  const svc = createServiceClient();
  if (!svc) return 0;
  const now = new Date();
  try {
    const { count, error } = await svc
      .from("meeting_bookings")
      .select("id", { count: "exact", head: true })
      .gte("starts_at", now.toISOString())
      .lt("starts_at", new Date(now.getTime() + 7 * 86_400_000).toISOString())
      .not("status", "in", "(cancelled,no_show)")
      .eq("is_test", false);
    if (error) {
      if (notSetUp(error)) return 0;
      throw error;
    }
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function setMeetingStatus(id: string, status: MeetingStatus, note?: string | null): Promise<TokenActionResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, reason: "not_set_up" };
  try {
    const { data, error } = await svc.rpc("set_meeting_status", { p_id: id, p_status: status, p_note: note ?? null });
    if (error) {
      if (notSetUp(error)) return { ok: false, reason: "not_set_up" };
      throw error;
    }
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "failed" };
  } catch (err) {
    if (notSetUp(err)) return { ok: false, reason: "not_set_up" };
    console.error("[meetings] status failed:", err);
    return { ok: false, reason: "failed" };
  }
}

/** The owner's Meet link for an online meeting. */
export async function setMeetLink(id: string, link: string | null): Promise<TokenActionResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, reason: "not_set_up" };
  try {
    const { error } = await svc.from("meeting_bookings").update({ meet_link: link }).eq("id", id);
    if (error) {
      if (notSetUp(error)) return { ok: false, reason: "not_set_up" };
      throw error;
    }
    return { ok: true };
  } catch (err) {
    if (notSetUp(err)) return { ok: false, reason: "not_set_up" };
    return { ok: false, reason: "failed" };
  }
}

/** Records the QAR 150 credit against one order. Changes no order total. */
export async function applyMeetingCredit(meetingId: string, orderId: string): Promise<TokenActionResult> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, reason: "not_set_up" };
  try {
    const { data, error } = await svc.rpc("apply_meeting_credit", { p_meeting: meetingId, p_order: orderId });
    if (error) {
      if (notSetUp(error)) return { ok: false, reason: "not_set_up" };
      throw error;
    }
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "failed" };
  } catch (err) {
    if (notSetUp(err)) return { ok: false, reason: "not_set_up" };
    return { ok: false, reason: "failed" };
  }
}

/**
 * A paid meeting for this customer whose credit is still unused — the
 * "Meeting credit available" row on an admin order page. Matches on phone or
 * e-mail, and only inside the credit window after the meeting.
 */
export async function creditableMeetingFor(
  contact: { phone?: string | null; email?: string | null },
  orderCreatedAt: string,
  settings?: MeetingSettings,
): Promise<MeetingBooking | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const phone = contact.phone?.trim();
  const email = contact.email?.trim();
  if (!phone && !email) return null;

  const s = settings ?? (await loadMeetingSettings());
  const made = Date.parse(orderCreatedAt);
  if (!Number.isFinite(made)) return null;

  try {
    const or = [phone ? `phone.eq.${phone}` : null, email ? `email.eq.${email}` : null].filter(Boolean).join(",");
    const { data, error } = await svc
      .from("meeting_bookings")
      .select<string, MeetingBooking>(BOOKING_COLUMNS)
      .eq("status", "paid")
      .is("credit_order_id", null)
      .gte("starts_at", new Date(made - s.order_credit_days * 86_400_000).toISOString())
      .lte("starts_at", new Date(made).toISOString())
      .or(or)
      .order("starts_at", { ascending: false })
      .limit(1);
    if (error) {
      if (notSetUp(error)) return null;
      throw error;
    }
    return data?.[0] ?? null;
  } catch (err) {
    if (notSetUp(err)) return null;
    console.error("[meetings] credit lookup failed:", err);
    return null;
  }
}

/** Meetings starting tomorrow (Qatar) — the daily reminder job. */
export async function meetingsOnQatarDay(dayIso: string): Promise<MeetingBooking[]> {
  const svc = createServiceClient();
  if (!svc) return [];
  const fromMs = Date.parse(`${dayIso}T00:00:00+03:00`);
  try {
    const { data, error } = await svc
      .from("meeting_bookings")
      .select<string, MeetingBooking>(BOOKING_COLUMNS)
      .gte("starts_at", new Date(fromMs).toISOString())
      .lt("starts_at", new Date(fromMs + 86_400_000).toISOString())
      .not("status", "in", "(cancelled,no_show)")
      .order("starts_at", { ascending: true });
    if (error) {
      if (notSetUp(error)) return [];
      throw error;
    }
    return data ?? [];
  } catch {
    return [];
  }
}

/** Tomorrow's Qatar date. */
export function tomorrowInQatar(now: Date = new Date()): string {
  return qatarDate(now.getTime() + 86_400_000);
}
