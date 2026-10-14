// Locale-aware formatting for CAD Champions. Pure functions, Western digits (0-9) in both locales.

import type { Locale } from "@/i18n/routing";

const CC_TIME_ZONE = "Asia/Qatar";

function numberLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en-US";
}
function dateLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-US";
}

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(numberLocale(locale), opts).format(n);
}

/** Date in Qatar time (Asia/Qatar). Returns "" for invalid dates. */
export function formatDate(
  date: Date | string | number,
  locale: Locale,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...opts,
    timeZone: CC_TIME_ZONE,
  }).format(d);
}

/** Date + time in Qatar time, 24-hour clock. */
export function formatDateTime(
  date: Date | string | number,
  locale: Locale,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return formatDate(date, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...opts,
  });
}

/** en: "QAR 1,250" · ar: "1,250 ر.ق." (whole riyals; decimals only when present). */
export function formatQAR(amount: number, locale: Locale): string {
  if (!Number.isFinite(amount)) return "";
  const num = formatNumber(amount, locale, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return locale === "ar" ? `${num} ر.ق.` : `QAR ${num}`;
}

/** B, KB, MB, GB (1024-based). */
export function formatFileSize(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const num = formatNumber(value, locale, { maximumFractionDigits: i === 0 ? 0 : 1 });
  return `${num} ${units[i]}`;
}
