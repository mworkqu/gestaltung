// Locale helpers. `Locale` itself is declared once, in i18n/routing.ts; this
// module only adds the narrowing and formatting helpers every page repeats.
// Pure, safe in server and client code.

import type { Locale } from "@/i18n/routing";

export type { Locale };

/**
 * Narrow any input to a supported locale: "ar" only when it is exactly "ar",
 * otherwise "en". Same rule as the per-file `safeLocale(formData)` copies
 * (`String(formData.get("locale")) === "ar"`), for route params, form values and
 * JSON bodies alike.
 */
export function asLocale(x: unknown): Locale {
  return x === "ar" ? "ar" : "en";
}

export function isRtl(locale: Locale): boolean {
  return locale === "ar";
}

/**
 * BCP 47 tag for Intl.* formatters. Arabic uses Qatar conventions with Western
 * (Latin) digits, English uses en-GB (day-month-year). These are the two
 * literals written inline in ~46 files.
 */
export function intlTag(locale: Locale): "ar-QA-u-nu-latn" | "en-GB" {
  return locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB";
}

/** Choose between two translations of a literal: `pick(locale, { en: "Save", ar: "حفظ" })`. */
export function pick<T>(locale: Locale, choices: { en: T; ar: T }): T {
  return locale === "ar" ? choices.ar : choices.en;
}
