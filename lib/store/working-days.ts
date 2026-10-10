// Qatar working days (P2-06, migration 0054). The database is the authority —
// public.add_working_days / working_days_config — and these pure helpers
// mirror it exactly, so "Arrives by" on cards and product pages and the daily
// delivery-promises re-check give the same date as order_delivery_quote.
//
// Rule: the weekend (ISO weekdays, Mon 1 … Sun 7; Qatar Fri 5 + Sat 6) and the
// listed public-holiday dates are not working days. addWorkingDays(d, n) is
// the n-th working day AFTER d (d itself never counts); n <= 0 returns d when
// it is a working day, else the next one (roll forward). Dates are ISO
// "YYYY-MM-DD" strings, handled in UTC (no time zone drift).

export const HOLIDAYS_KEY = "holidays";

export type Holidays = {
  /** ISO weekdays that are the weekend (1 = Monday … 7 = Sunday). */
  weekend: number[];
  /** Public holidays, ISO dates, sorted, unique. */
  dates: string[];
};

export const DEFAULT_WEEKEND: readonly number[] = [5, 6];

/**
 * Qatar public holidays 2026–2027, editable defaults (migration 0066 merges the
 * same list into store_settings.holidays without removing owner entries).
 * National Day 18 Dec (+ the 19th kept from 0054); National Sports Day = 2nd
 * Tuesday of February (2027-02-09; the 2026 one, 10 Feb, has passed).
 */
export const QATAR_FIXED_HOLIDAYS: readonly string[] = [
  "2026-12-18",
  "2026-12-19",
  "2027-02-09",
  "2027-12-18",
];

/** Eid dates are moon-sighted: expected, to be confirmed when announced. */
export const QATAR_EXPECTED_HOLIDAYS: readonly string[] = [
  "2027-03-09",
  "2027-03-10",
  "2027-03-11", // Eid al-Fitr
  "2027-05-16",
  "2027-05-17",
  "2027-05-18", // Eid al-Adha
];

export const DEFAULT_HOLIDAYS: Holidays = {
  weekend: [...DEFAULT_WEEKEND],
  dates: [...QATAR_FIXED_HOLIDAYS, ...QATAR_EXPECTED_HOLIDAYS].sort(),
};

// Same cap as the SQL loop: unreachable in practice (at most six weekend days
// and a finite holiday list), it only stops a corrupt setting from hanging.
const GUARD = 100000;

const ISO_DATE = /^2\d{3}-\d{2}-\d{2}$/;

/** A real calendar date "YYYY-MM-DD" (years 2000–2999), same test as SQL. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * store_settings.holidays → Holidays (mirrors working_days_config()).
 * weekend: the JSON integers 1..7 in the array, unique, sorted; missing or not
 * an array → [5, 6]; all seven days → [5, 6]. dates: the valid ISO date
 * strings, unique, sorted; anything else is ignored.
 */
export function parseHolidays(raw: unknown): Holidays {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { weekend: [...DEFAULT_WEEKEND], dates: [] };
  const cfg = raw as { weekend?: unknown; dates?: unknown };

  let weekend = [...DEFAULT_WEEKEND];
  if (Array.isArray(cfg.weekend)) {
    const days = Array.from(
      new Set(cfg.weekend.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7)),
    ).sort((a, b) => a - b);
    if (days.length < 7) weekend = days;
  }

  const dates = Array.isArray(cfg.dates) ? Array.from(new Set(cfg.dates.filter(isIsoDate))).sort() : [];
  return { weekend, dates };
}

/** ISO weekday of an ISO date: 1 = Monday … 7 = Sunday (Postgres isodow). */
export function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The weekend to apply: all seven days would make every date impossible → default (as SQL). */
function effectiveWeekend(h: Holidays): number[] {
  const days = new Set(h.weekend.filter((v) => Number.isInteger(v) && v >= 1 && v <= 7));
  return days.size >= 7 ? [...DEFAULT_WEEKEND] : [...days];
}

function checker(h: Holidays): (iso: string) => boolean {
  const weekend = effectiveWeekend(h);
  const dates = new Set(h.dates);
  return (iso) => !weekend.includes(isoWeekday(iso)) && !dates.has(iso);
}

/** Not a weekend day and not a listed holiday. */
export function isWorkingDay(iso: string, holidays: Holidays): boolean {
  return checker(holidays)(iso);
}

/** The date itself when it is a working day, else the first working day after it. */
export function nextWorkingDay(iso: string, holidays: Holidays): string {
  const working = checker(holidays);
  let d = iso;
  for (let guard = 0; !working(d) && guard < GUARD; guard++) d = addDays(d, 1);
  return d;
}

/**
 * The n-th working day after `iso` (mirrors public.add_working_days). n <= 0
 * (or not a number) → nextWorkingDay(iso). The result is never a weekend day
 * or a holiday.
 */
export function addWorkingDays(iso: string, n: number, holidays: Holidays): string {
  const count = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (count <= 0) return nextWorkingDay(iso, holidays);
  const working = checker(holidays);
  let d = iso;
  let k = 0;
  for (let guard = 0; k < count && guard < GUARD; guard++) {
    d = addDays(d, 1);
    if (working(d)) k++;
  }
  return d;
}
