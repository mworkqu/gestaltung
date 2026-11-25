/**
 * Meeting slot generation and labels, in Qatar time. Pure, and the mirror of
 * meeting_free_slots() / meeting_slot_on_grid() in migration 0113 — the SQL is
 * the authority (it also holds the unique index), this is what the pages, the
 * tools and the e-mails use to show the same times.
 *
 * Asia/Qatar has no DST, so every instant is built with the fixed +03:00
 * offset. Arabic labels keep Western digits (intlTag -> ar-QA-u-nu-latn).
 */

import { DAY_MS, addDays } from "@/lib/format/date";
import { intlTag, type Locale } from "@/lib/locale";

import { minutesOfDay, hhmm, QATAR_OFFSET, type MeetingSettings } from "./settings";

/** ISO weekday (1 = Monday … 7 = Sunday) of an ISO date, in UTC so no drift. */
export function isoWeekday(isoDate: string): number {
  return ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** The Qatar calendar date (YYYY-MM-DD) an instant falls on. */
export function qatarDate(ms: number): string {
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** The instant of a Qatar-local date + "HH:MM". */
export function qatarInstant(isoDate: string, time: string): number {
  return Date.parse(`${isoDate}T${time}:00${QATAR_OFFSET}`);
}

/** Every slot start time a day offers by the rules alone (no notice, no bookings). */
export function slotTimesOfDay(settings: MeetingSettings): string[] {
  const out: string[] = [];
  const end = minutesOfDay(settings.end);
  for (let m = minutesOfDay(settings.start); m + settings.slot_minutes <= end; m += settings.slot_minutes) {
    out.push(hhmm(m));
  }
  return out;
}

export type SlotQuery = {
  settings: MeetingSettings;
  /** First Qatar date to consider; defaults to today in Qatar. */
  fromIso?: string;
  /** How many days to cover; clamped to horizon_days. */
  days?: number;
  nowMs: number;
  /** Public holiday ISO dates (store_settings.holidays.dates). */
  holidays?: readonly string[];
  /** Instants already taken by a live booking (ISO strings or ms). */
  taken?: readonly (string | number)[];
};

/**
 * Free slot start times as ISO instants, ordered. Applies: open weekday, the
 * time grid, holidays, the notice window, the horizon and the taken list.
 */
export function freeSlots(q: SlotQuery): string[] {
  const { settings, nowMs } = q;
  const from = q.fromIso ?? qatarDate(nowMs);
  const days = Math.min(Math.max(q.days ?? settings.horizon_days, 1), settings.horizon_days);
  const holidays = new Set(q.holidays ?? []);
  const taken = new Set((q.taken ?? []).map((t) => (typeof t === "number" ? t : Date.parse(t))));

  const earliest = nowMs + settings.min_notice_hours * 3_600_000;
  const latest = nowMs + settings.horizon_days * DAY_MS;
  const times = slotTimesOfDay(settings);
  const out: string[] = [];

  for (let off = 0; off < days; off++) {
    const date = addDays(from, off);
    if (!settings.weekdays.includes(isoWeekday(date))) continue;
    if (holidays.has(date)) continue;
    for (const t of times) {
      const ms = qatarInstant(date, t);
      if (ms < earliest || ms > latest || taken.has(ms)) continue;
      out.push(new Date(ms).toISOString());
    }
  }
  return out;
}

/** True when an instant is an allowed slot by weekday, grid, holiday and horizon. */
export function slotOnGrid(
  startsAt: string | number,
  settings: MeetingSettings,
  opts: { nowMs: number; holidays?: readonly string[] },
): boolean {
  const ms = typeof startsAt === "number" ? startsAt : Date.parse(startsAt);
  if (!Number.isFinite(ms)) return false;
  if (ms > opts.nowMs + settings.horizon_days * DAY_MS) return false;

  const date = qatarDate(ms);
  if (!settings.weekdays.includes(isoWeekday(date))) return false;
  if ((opts.holidays ?? []).includes(date)) return false;

  return slotTimesOfDay(settings).some((t) => qatarInstant(date, t) === ms);
}

const labelCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, kind: "day" | "time", timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}:${kind}:${timeZone}`;
  let f = labelCache.get(key);
  if (!f) {
    f =
      kind === "day"
        ? new Intl.DateTimeFormat(intlTag(locale), { weekday: "short", day: "numeric", month: "short", timeZone })
        : new Intl.DateTimeFormat(intlTag(locale), { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
    labelCache.set(key, f);
  }
  return f;
}

/**
 * "Mon 23 Nov · 4:00 pm" / "الاثنين 23 نوفمبر · 4:00 م".
 * Always Qatar wall-clock time, Western digits in Arabic.
 */
export function slotLabel(startsAt: string | number, locale: Locale, settings: MeetingSettings): string {
  const d = new Date(typeof startsAt === "number" ? startsAt : Date.parse(startsAt));
  const tz = settings.timezone || "Asia/Qatar";
  const day = formatter(locale, "day", tz).format(d).replace(/,/g, "");
  const time = formatter(locale, "time", tz).format(d);
  return `${day} · ${time}`;
}

export type SlotOption = { starts_at: string; label_en: string; label_ar: string };

/** Slots with both labels, the shape the MCP tool and the booking UI return. */
export function slotOptions(iso: readonly string[], settings: MeetingSettings): SlotOption[] {
  return iso.map((s) => ({ starts_at: s, label_en: slotLabel(s, "en", settings), label_ar: slotLabel(s, "ar", settings) }));
}
