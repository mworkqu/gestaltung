// Date helpers shared by pages, emails and the delivery maths. Pure.

import { intlTag, type Locale } from "@/lib/locale";

/** Milliseconds in one day (the `86400000` / `24 * 60 * 60 * 1000` literals). */
export const DAY_MS = 86_400_000;

/**
 * ISO date (YYYY-MM-DD) plus a number of days, in UTC so DST and the server's
 * time zone never matter. Byte-identical to the private copies in
 * lib/store/working-days.ts and lib/store/delivery.ts (those two import this in R4).
 */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Option choice: the admin pages (customers, customers/[id], payments,
// engineering-jobs, ai-costs) all build the same pair. "day" = 05 Mar 2026,
// "time" = 05 Mar, 14:30. Both pin Asia/Qatar so a server running in UTC
// (Vercel) shows the shop's wall-clock time; usage/page.tsx is the one outlier
// (timeZone "UTC", no year) and keeps its own formatter. ai-costs/[userId] also
// adds seconds to its time format; that page keeps a local formatter too.
const TIME_ZONE = "Asia/Qatar";

const dayCache = new Map<Locale, Intl.DateTimeFormat>();
const timeCache = new Map<Locale, Intl.DateTimeFormat>();

/** `05 Mar 2026` in Asia/Qatar, with Western digits in Arabic. */
export function dayFormatter(locale: Locale): Intl.DateTimeFormat {
  let f = dayCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlTag(locale), { day: "2-digit", month: "short", year: "numeric", timeZone: TIME_ZONE });
    dayCache.set(locale, f);
  }
  return f;
}

/** `05 Mar, 14:30` (day, short month, hour, minute) in Asia/Qatar. */
export function timeFormatter(locale: Locale): Intl.DateTimeFormat {
  let f = timeCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(intlTag(locale), {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIME_ZONE,
    });
    timeCache.set(locale, f);
  }
  return f;
}
