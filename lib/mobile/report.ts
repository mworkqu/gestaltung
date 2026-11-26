// The shape of the phone/iPad dashboard's "whole website" report, and the pure
// helpers every section is built with.
//
// WHY A GENERIC SHAPE. The app ships through TestFlight, so a new metric that
// needs a new screen is days away from the owner's hand. Every section here is
// tiles + charts + tables + plain-language notes, and the app renders any
// section it is given without knowing what it means. Adding a figure is then a
// server change only: deploy the site, pull to refresh, it is there.
//
// Nothing in this file touches the database or the clock beyond what it is
// handed, so every section is unit-testable from plain rows.

/** A headline number. `value` is already formatted — the app never does maths. */
export type Tile = {
  label: string;
  value: string;
  /** Change against the previous window, pre-formatted (e.g. "+12%", "-3"). */
  delta?: string;
  /** Colours the tile. "flat" is the default and means "just a number". */
  tone?: "good" | "warn" | "bad" | "flat";
  /** One short line under the number, for what the label cannot say. */
  hint?: string;
  /**
   * The key of a `DetailView` in the same section. When set, the app makes the
   * tile tappable and pushes that list; when absent the tile is just a number.
   * So making a figure open up is a server change, like the figure itself.
   */
  detail?: string;
};

export type Point = { x: string; y: number };

export type Series = {
  title: string;
  kind: "line" | "bar";
  /** Appended to axis values in the app ("QAR", "%", ""). */
  unit?: string;
  points: Point[];
};

export type Table = {
  title: string;
  columns: string[];
  rows: string[][];
  /** Per column: "l" left, "r" right (numbers). Defaults to left everywhere. */
  align?: ("l" | "r")[];
  /** Shown instead of the table when `rows` is empty. */
  empty?: string;
  /**
   * Per row, the key of a `DetailView` in the same section, or null for a row
   * that leads nowhere. Same idea as `Tile.detail`: which rows open is the
   * site's decision, so a new drill-down is a deploy and not a new build.
   *
   * Shorter than `rows` is fine — the rows past its end simply do not open.
   */
  links?: (string | null)[];
};

/**
 * What is behind a tile: the rows that make the number up — which orders are
 * open, who left a basket — so a figure can be opened instead of merely read.
 *
 * It is a table with a key and a sentence of its own. Keeping it the same shape
 * as `Table` means the app draws it with the view it already has.
 */
export type DetailView = {
  /** Matches `Tile.detail`. Unique within the section. */
  key: string;
  title: string;
  /** One sentence: what this list is, and what the owner might do about it. */
  blurb?: string;
  columns: string[];
  rows: string[][];
  align?: ("l" | "r")[];
  empty?: string;
  /** As `Table.links`: a row here can open another detail in the section. */
  links?: (string | null)[];
};

export type Section = {
  key: string;
  title: string;
  /** An SF Symbol name, so the app needs no key-to-icon table of its own. */
  symbol: string;
  /** One sentence: what this section is about. */
  blurb: string;
  tiles: Tile[];
  series: Series[];
  tables: Table[];
  /** Plain-language findings: what stands out, what needs doing. */
  notes: string[];
  /** The lists behind this section's tiles, if any tile has one. */
  details?: DetailView[];
};

export type Report = {
  generatedAt: string;
  /** Days covered by the trend charts. */
  windowDays: number;
  sections: Section[];
  /** Sections that could not be read at all (missing table, failed query). */
  unavailable: string[];
};

// ---------------------------------------------------------------- formatting

/** Thousands-separated integer. */
export function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** `1,250` / `1,250.50` — money without a currency word (the label carries it). */
export function money(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? int(r) : r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

/** A signed change for a tile. Returns undefined when there is nothing to compare. */
export function delta(now: number, before: number): string | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return undefined;
  if (before === 0) return now === 0 ? undefined : `+${int(now)}`;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return "0%";
  return `${change > 0 ? "+" : ""}${change}%`;
}

/** Good when up, bad when down (revenue, orders, visits). */
export function toneUp(now: number, before: number): Tile["tone"] {
  if (now === before) return "flat";
  return now > before ? "good" : "warn";
}

// ------------------------------------------------------------------- buckets

const DAY_TZ = "Asia/Qatar";
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** `2026-11-23` in the shop's own time zone, so "today" means today in Doha. */
export function dayKey(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return dayKeyFormat.format(d);
}

/** The last `days` day keys, oldest first, ending today. */
export function lastDays(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(dayKey(now - i * 86_400_000));
  return out;
}

/**
 * Count rows into one point per day over the window, zero-filled so a chart
 * never draws a gap as a slope. `weight` sums a number instead of counting.
 */
export function daily(
  rows: { at: string | null | undefined; weight?: number }[],
  days: number,
  now = Date.now(),
): Point[] {
  const keys = lastDays(days, now);
  const tally = new Map(keys.map((k) => [k, 0]));
  for (const row of rows) {
    if (!row.at) continue;
    const k = dayKey(row.at);
    const current = tally.get(k);
    if (current === undefined) continue;
    tally.set(k, current + (row.weight ?? 1));
  }
  return keys.map((k) => ({ x: k, y: tally.get(k) ?? 0 }));
}

/** Rows at or after `days` ago. */
export function since(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString();
}

/** `23 Nov, 14:05` in Asia/Qatar — a moment a person can act on. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "\u2014";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DAY_TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(at)
    .replace(",", ",");
}

/** Whole days between `iso` and now, or null when there is no date. */
export function ageDays(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.floor((now - at) / 86_400_000);
}

export function within(iso: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= now - days * 86_400_000;
}

/** In the window that ended where the current one began (for deltas). */
export function inPreviousWindow(iso: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= now - 2 * days * 86_400_000 && t < now - days * 86_400_000;
}

// --------------------------------------------------------------------- misc

/** Number from a Postgres numeric, which arrives as a string. */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Count by a key, biggest first. */
export function tally<T>(rows: T[], key: (row: T) => string | null | undefined): [string, number][] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Sum by a key, biggest first. */
export function sumBy<T>(rows: T[], key: (row: T) => string | null | undefined, weight: (row: T) => number): [string, number][] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + weight(row));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** A status / category breakdown as a table. */
export function breakdown(title: string, counts: [string, number][], columns = ["", "Count"], empty = "Nothing yet."): Table {
  return {
    title,
    columns,
    rows: counts.map(([k, n]) => [k, int(n)]),
    align: ["l", "r"],
    empty,
  };
}

/** Readable label for a snake_case status. */
export function label(value: string | null | undefined): string {
  if (!value) return "unknown";
  return value.replace(/[_-]+/g, " ");
}
