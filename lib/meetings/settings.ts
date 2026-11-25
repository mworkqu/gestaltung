/**
 * Meeting settings: the owner's rules for paid engineer meetings, read from
 * store_settings.meetings (migration 0113) with the same defaults the SQL
 * carries. Pure — no Supabase, no React.
 *
 * Owner decisions behind the defaults: Monday and Wednesday, 16:00 and 17:00
 * Qatar time, one hour, QAR 150, invoiced after the meeting and only if the
 * client is happy, free to move or cancel up to 24 h before, and the 150 comes
 * off a manufacturing order placed within 30 days.
 */

export const MEETING_SETTINGS_KEY = "meetings";

/** Asia/Qatar is UTC+3 all year — no DST, so a fixed offset is exact. */
export const QATAR_OFFSET = "+03:00";

export type MeetingMode = "online" | "studio";

export type MeetingSettings = {
  timezone: string;
  /** ISO weekdays that are open (1 = Monday … 7 = Sunday). */
  weekdays: number[];
  /** "HH:MM" local opening and closing time. */
  start: string;
  end: string;
  slot_minutes: number;
  price_qar: number;
  min_notice_hours: number;
  horizon_days: number;
  cancel_free_hours: number;
  order_credit_days: number;
  modes: MeetingMode[];
};

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  timezone: "Asia/Qatar",
  weekdays: [1, 3],
  start: "16:00",
  end: "18:00",
  slot_minutes: 60,
  price_qar: 150,
  min_notice_hours: 24,
  horizon_days: 21,
  cancel_free_hours: 24,
  order_credit_days: 30,
  modes: ["online", "studio"],
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : fallback;
};

const time = (v: unknown, fallback: string): string => (typeof v === "string" && HHMM.test(v) ? v : fallback);

/**
 * Settings from the stored jsonb, defaults filled in and every value clamped,
 * so a hand-edited row can never produce an impossible calendar.
 */
export function readMeetingSettings(value: unknown): MeetingSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MEETING_SETTINGS;

  // Out-of-range weekdays are DROPPED, never clamped: a stray 9 must not
  // quietly open Sunday.
  const weekdays = Array.isArray(v.weekdays)
    ? [...new Set(v.weekdays.map((x) => (typeof x === "number" ? x : Number(x))).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort(
        (a, b) => a - b,
      )
    : d.weekdays;

  const modes = Array.isArray(v.modes)
    ? (v.modes.filter((m): m is MeetingMode => m === "online" || m === "studio") as MeetingMode[])
    : d.modes;

  const start = time(v.start, d.start);
  let end = time(v.end, d.end);
  if (minutesOfDay(end) <= minutesOfDay(start)) end = d.end;

  return {
    timezone: typeof v.timezone === "string" && v.timezone ? v.timezone : d.timezone,
    weekdays: weekdays.length ? weekdays : d.weekdays,
    start,
    end,
    slot_minutes: num(v.slot_minutes, d.slot_minutes, 15, 480),
    price_qar: num(v.price_qar, d.price_qar, 0, 100_000),
    min_notice_hours: num(v.min_notice_hours, d.min_notice_hours, 0, 720),
    horizon_days: num(v.horizon_days, d.horizon_days, 1, 365),
    cancel_free_hours: num(v.cancel_free_hours, d.cancel_free_hours, 0, 720),
    order_credit_days: num(v.order_credit_days, d.order_credit_days, 0, 365),
    modes: modes.length ? modes : d.modes,
  };
}

/** "16:00" -> 960. */
export function minutesOfDay(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** 960 -> "16:00". */
export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
