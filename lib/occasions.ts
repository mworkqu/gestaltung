// Occasion collections (P3-07 / WF-08). store_settings.occasions (seeded by
// migration 0056, edited in Dashboard → Store → Occasions) is a JSON array of
// seasonal store campaigns:
//
//   { id, title_en, title_ar, start, end, query, skus, banner_en, banner_ar }
//
//   start / end  "MM-DD" repeats EVERY year, inclusive, and may wrap the new
//                year ("12-20" → "01-05"). "YYYY-MM-DD" applies only in that
//                year (moving dates such as Ramadan and Eid). Both ends use
//                the same form.
//   query        a store search string, used as /store?q=<query>
//   skus         optional explicit product list; when non-empty it WINS over query
//   banner_*     one short line, <= 90 characters
//
// "Today" is the Qatar calendar date (Asia/Qatar, no daylight saving), so an
// occasion switches on and off at Doha midnight whatever the server's zone.
//
// Pure (no Next runtime, no I/O): tested in lib/occasions.test.ts. The public
// read is getOccasions() in lib/store/public-catalog.ts; the admin editor
// validates with the same schema (validateOccasions).

import { z } from "zod";

export const OCCASIONS_KEY = "occasions";
export const OCCASIONS_MAX = 12;
export const BANNER_MAX = 90;
export const TITLE_MAX = 80;
export const QUERY_MAX = 100;
export const SKUS_MAX = 24;

export type Occasion = {
  id: string;
  title_en: string;
  title_ar: string;
  start: string;
  end: string;
  query: string;
  skus: string[];
  banner_en: string;
  banner_ar: string;
};

// ── Dates ────────────────────────────────────────────────────────────────────

const MD = /^(\d{2})-(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days per month with February = 29 (a yearly "02-29" is allowed). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "MM-DD" with a real month and day ("02-29" counts; "02-30" and "13-01" do not). */
export function isMonthDay(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const m = MD.exec(s);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1];
}

/** "YYYY-MM-DD", years 2000–2999, a real calendar date. */
export function isFullDate(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const m = YMD.exec(s);
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2999) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Either form of an occasion date. */
export const isOccasionDate = (s: unknown): boolean => isMonthDay(s) || isFullDate(s);

/** The Qatar calendar date, "YYYY-MM-DD" (Asia/Qatar is UTC+3 all year). */
export function qatarToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Does an occasion repeat every year (MM-DD) or apply to one span (YYYY-MM-DD)? */
export const isYearly = (o: Pick<Occasion, "start">): boolean => isMonthDay(o.start);

// ── Parse / validate ─────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);

const occasionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  title_en: text(TITLE_MAX),
  title_ar: text(TITLE_MAX),
  start: z.string().trim().refine(isOccasionDate),
  end: z.string().trim().refine(isOccasionDate),
  query: z.string().trim().max(QUERY_MAX).default(""),
  skus: z
    .array(z.string().trim().regex(/^[^\s,]{1,64}$/))
    .max(SKUS_MAX)
    .default([]),
  banner_en: z.string().trim().max(BANNER_MAX).default(""),
  banner_ar: z.string().trim().max(BANNER_MAX).default(""),
});

export type OccasionErrorCode =
  | "id"
  | "title_en"
  | "title_ar"
  | "start"
  | "end"
  | "range"
  | "query"
  | "skus"
  | "target"
  | "banner_en"
  | "banner_ar"
  | "duplicate_id"
  | "row";

export type OccasionError = { index: number; code: OccasionErrorCode };

const FIELD_CODES: Record<string, OccasionErrorCode> = {
  id: "id",
  title_en: "title_en",
  title_ar: "title_ar",
  start: "start",
  end: "end",
  query: "query",
  skus: "skus",
  banner_en: "banner_en",
  banner_ar: "banner_ar",
};

/** One entry → a clean Occasion or the codes of everything wrong with it. */
function checkOne(raw: unknown): { ok: true; value: Occasion } | { ok: false; codes: OccasionErrorCode[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, codes: ["row"] };
  const r = raw as Record<string, unknown>;
  // A single sku written as a string is accepted as a one-item list.
  const input = { ...r, skus: typeof r.skus === "string" ? [r.skus] : r.skus };
  const parsed = occasionSchema.safeParse(input);
  if (!parsed.success) {
    const codes = new Set<OccasionErrorCode>();
    for (const issue of parsed.error.issues) codes.add(FIELD_CODES[String(issue.path[0])] ?? "row");
    return { ok: false, codes: [...codes] };
  }
  const o = parsed.data;
  const codes: OccasionErrorCode[] = [];
  const skus = [...new Set(o.skus)];
  if (isMonthDay(o.start) !== isMonthDay(o.end)) codes.push("range");
  else if (isFullDate(o.start) && o.start > o.end) codes.push("range");
  if (!o.query && skus.length === 0) codes.push("target");
  if (codes.length) return { ok: false, codes };
  return { ok: true, value: { ...o, skus } };
}

/**
 * Public read: the stored value → the valid occasions. Invalid entries (and
 * repeated ids after the first) are dropped; never throws. More than
 * OCCASIONS_MAX entries are cut.
 */
export function parseOccasions(raw: unknown): Occasion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Occasion[] = [];
  for (const item of raw) {
    const r = checkOne(item);
    if (!r.ok || seen.has(r.value.id)) continue;
    seen.add(r.value.id);
    out.push(r.value);
    if (out.length >= OCCASIONS_MAX) break;
  }
  return out;
}

/** Admin save: every row must be valid; errors name the row (index) and the field. */
export function validateOccasions(
  raw: unknown,
): { ok: true; value: Occasion[] } | { ok: false; errors: OccasionError[] } {
  if (!Array.isArray(raw)) return { ok: false, errors: [{ index: 0, code: "row" }] };
  const errors: OccasionError[] = [];
  const value: Occasion[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const r = checkOne(item);
    if (!r.ok) {
      for (const code of r.codes) errors.push({ index, code });
      return;
    }
    if (seen.has(r.value.id)) errors.push({ index, code: "duplicate_id" });
    seen.add(r.value.id);
    value.push(r.value);
  });
  if (raw.length > OCCASIONS_MAX) errors.push({ index: OCCASIONS_MAX, code: "row" });
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// ── Active window ────────────────────────────────────────────────────────────

/** Is the occasion on for this Qatar date ("YYYY-MM-DD")? Bad input = false. */
export function isOccasionActive(o: Pick<Occasion, "start" | "end">, date: string): boolean {
  if (!isFullDate(date)) return false;
  if (isMonthDay(o.start) && isMonthDay(o.end)) {
    const md = date.slice(5);
    // A range that wraps the new year is on from start to Dec 31 and from Jan 1 to end.
    return o.start <= o.end ? md >= o.start && md <= o.end : md >= o.start || md <= o.end;
  }
  if (isFullDate(o.start) && isFullDate(o.end)) return date >= o.start && date <= o.end;
  return false;
}

/** The occasions on for this date, earliest start first (month-day, then id). */
export function activeOccasions<T extends Pick<Occasion, "id" | "start" | "end">>(list: readonly T[], date: string): T[] {
  const key = (o: T) => o.start.slice(-5);
  return list
    .filter((o) => isOccasionActive(o, date))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type OccasionStatus = "on" | "back" | "upcoming" | "ended";

/**
 * On now; "back" (a yearly range that is off today, returns next season);
 * "upcoming" / "ended" (a one-off range before / after its dates).
 */
export function occasionStatus(o: Pick<Occasion, "start" | "end">, date: string): OccasionStatus {
  if (isOccasionActive(o, date)) return "on";
  if (isMonthDay(o.start)) return "back";
  return date < o.start ? "upcoming" : "ended";
}

// ── Links and store state ────────────────────────────────────────────────────

/** Locale-less path of the collection page. */
export const occasionHref = (o: Pick<Occasion, "id">): string => `/store/collections/${o.id}`;

/**
 * What the collection shows, as store parameters: explicit skus win over the
 * search query ({ skus } in the given order, else { q }).
 */
export function occasionSearchState(o: Pick<Occasion, "query" | "skus">): { skus: string[] } | { q: string } {
  return o.skus.length > 0 ? { skus: [...o.skus] } : { q: o.query };
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * One date for the banner / hero, Western digits in both languages. A yearly
 * "MM-DD" shows day and month ("1 February"); a dated one adds the year.
 */
export function formatOccasionDate(value: string, locale: string): string {
  const yearly = isMonthDay(value);
  // 2024 is a leap year, so a yearly "02-29" formats.
  const d = new Date(`${yearly ? "2024-" : ""}${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    ...(yearly ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(d);
}

export const occasionTitle = (o: Pick<Occasion, "title_en" | "title_ar">, locale: string): string =>
  locale === "ar" ? o.title_ar : o.title_en;

/** The banner line for the locale; falls back to the other language, then "". */
export const occasionBanner = (o: Pick<Occasion, "banner_en" | "banner_ar">, locale: string): string =>
  (locale === "ar" ? o.banner_ar || o.banner_en : o.banner_en || o.banner_ar) || "";

// ── Admin editor rows ────────────────────────────────────────────────────────

/** One editor row: every field is text; the SKU list is comma separated. */
export type OccasionDraft = Omit<Occasion, "skus"> & { skus: string };

export const emptyDraft = (): OccasionDraft => ({
  id: "",
  title_en: "",
  title_ar: "",
  start: "",
  end: "",
  query: "",
  skus: "",
  banner_en: "",
  banner_ar: "",
});

/** "A-1, B-2\nA-1" → ["A-1", "B-2"]: split on commas / whitespace, trimmed, no repeats, no blanks. */
export function parseSkuList(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * The stored value → editor rows, leniently (an entry that would not pass
 * validation still shows, so the owner can fix it instead of losing it).
 */
export function toDrafts(raw: unknown): OccasionDraft[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .map((r) => ({
      id: str(r.id),
      title_en: str(r.title_en),
      title_ar: str(r.title_ar),
      start: str(r.start),
      end: str(r.end),
      query: str(r.query),
      skus: Array.isArray(r.skus) ? r.skus.filter((s): s is string => typeof s === "string").join(", ") : str(r.skus),
      banner_en: str(r.banner_en),
      banner_ar: str(r.banner_ar),
    }));
}

/** Editor rows → the shape validateOccasions() checks. */
export const draftsToInput = (drafts: readonly OccasionDraft[]): unknown[] =>
  drafts.map((d) => ({ ...d, skus: parseSkuList(String(d.skus ?? "")) }));
