/**
 * The meeting price and cancellation lines, in EN and AR, built FROM the
 * settings so they stay true if the owner changes a number. Used by the MCP
 * tools, the e-mails and the pages (the pages also carry them as messages for
 * next-intl, which must say the same thing).
 *
 * House rules kept here on purpose: QAR on every price, the company legal name
 * and C.R. on every card that books, no "free" in a CTA ("free to move or
 * cancel" describes the rule, it is not a call to action), no reprint promise,
 * one SLA phrase, and never a CAD program name.
 */

import { COMPANY, COMPANY_ADDRESS } from "@/lib/company";
import { formatQar } from "@/lib/format/money";
import type { Locale } from "@/lib/locale";

import type { MeetingMode, MeetingSettings } from "./settings";

/** "Gestaltung for Trading and Services W.L.L · C.R. 236988" — on every card that books or sends. */
export const COMPANY_LINE_EN = `${COMPANY.legalNameEn} · C.R. ${COMPANY.crNumber}`;
export const COMPANY_LINE_AR = `${COMPANY.legalNameAr} · س.ت. ${COMPANY.crNumber}`;

export function companyLine(locale: Locale): string {
  return locale === "ar" ? COMPANY_LINE_AR : COMPANY_LINE_EN;
}

const hours = (n: number, locale: Locale): string =>
  locale === "ar" ? (n === 1 ? "ساعة واحدة" : `${n} ساعات`) : `${n} hour${n === 1 ? "" : "s"}`;

/** "1 hour · QAR 150" */
export function priceLine(settings: MeetingSettings, locale: Locale): string {
  const h = settings.slot_minutes / 60;
  const length = Number.isInteger(h) ? hours(h, locale) : `${settings.slot_minutes} ${locale === "ar" ? "دقيقة" : "minutes"}`;
  return `${length} · ${formatQar(settings.price_qar, locale)}`;
}

/** "Invoiced after the meeting, only if you are happy" */
export function invoiceLine(locale: Locale): string {
  return locale === "ar"
    ? "تُرسل الفاتورة بعد الاجتماع، وفقط إذا كنت راضيًا."
    : "Invoiced after the meeting, only if you are happy.";
}

/** "Free to move or cancel up to 24 hours before. Counts towards an order within 30 days." */
export function changeLine(settings: MeetingSettings, locale: Locale): string {
  return locale === "ar"
    ? `يمكنك تغيير الموعد أو إلغاؤه دون مقابل حتى ${settings.cancel_free_hours} ساعة قبل الموعد. ويُحتسب المبلغ من طلب تصنيع خلال ${settings.order_credit_days} يومًا.`
    : `Free to move or cancel up to ${settings.cancel_free_hours} hours before. Counts towards an order within ${settings.order_credit_days} days.`;
}

/** The three lines, in order, that go wherever a meeting is offered. */
export function meetingLines(settings: MeetingSettings, locale: Locale): string[] {
  return [priceLine(settings, locale), invoiceLine(locale), changeLine(settings, locale)];
}

/** What happens for each mode — the studio address, or how the online link arrives. */
export function modeLine(mode: MeetingMode, locale: Locale): string {
  if (mode === "studio") {
    return locale === "ar" ? `في الاستوديو: ${COMPANY_ADDRESS.ar}` : `At the studio: ${COMPANY_ADDRESS.en}`;
  }
  return locale === "ar"
    ? "عبر الإنترنت: نرسل رابط الاجتماع على واتساب قبل الموعد."
    : "Online: we send the meeting link on WhatsApp before the meeting.";
}

export function modeLabel(mode: MeetingMode, locale: Locale): string {
  if (locale === "ar") return mode === "studio" ? "في الاستوديو" : "عبر الإنترنت";
  return mode === "studio" ? "At the studio" : "Online";
}

/** Too late to change without us: the one SLA-free fallback sentence. */
export function tooLateLine(locale: Locale): string {
  return locale === "ar"
    ? "لم يعد تغيير الموعد متاحًا هنا — راسلنا على واتساب."
    : "Too late to change online — message us on WhatsApp.";
}
