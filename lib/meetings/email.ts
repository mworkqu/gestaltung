/**
 * Meeting e-mails: one to the client (their language) and one to the owner
 * (English), both through renderBrandedEmail, which already carries the
 * company's legal name and C.R. in the brand strip. Pure — the caller sends.
 *
 * The IBAN never appears on a page or in a WhatsApp text; it goes only in the
 * invoice e-mail below.
 */

import { COMPANY_ADDRESS, PAYMENT_DETAILS } from "@/lib/company";
import { renderBrandedEmail, type BrandFact } from "@/lib/email/brand-layout";
import { leadsDashboardUrl, renderOwnerEmail } from "@/lib/email/lead-email";
import { formatQar } from "@/lib/format/money";
import { asLocale, type Locale } from "@/lib/locale";
import { formatPhoneDisplay } from "@/lib/phone";

import { companyLine, meetingLines, modeLabel, modeLine } from "./copy";
import type { MeetingSettings } from "./settings";
import { slotLabel } from "./slots";

export type MeetingMail = { subject: string; html: string; text: string };

export type MeetingMailInput = {
  booking: {
    starts_at: string;
    mode: "online" | "studio";
    name: string;
    phone: string;
    email?: string | null;
    locale?: string;
    topic?: string | null;
    source?: "plugin" | "website";
    invoice_qar?: number;
    meet_link?: string | null;
  };
  settings: MeetingSettings;
  manageUrl: string;
  siteUrl?: string;
};

/** "Mon 23 Nov · 4:00 pm" in the given language. */
const when = (input: MeetingMailInput, locale: Locale) => slotLabel(input.booking.starts_at, locale, input.settings);

// ── the client ───────────────────────────────────────────────────────────────

/** Confirmation of a booked meeting, in the client's language. */
export function renderMeetingClientEmail(input: MeetingMailInput): MeetingMail {
  const locale = asLocale(input.booking.locale);
  const ar = locale === "ar";
  const time = when(input, locale);

  const subject = ar ? `تم تأكيد اجتماعك — ${time}` : `Your meeting is booked — ${time}`;

  const facts: BrandFact[] = [
    { label: ar ? "الموعد" : "When", value: time },
    { label: ar ? "النوع" : "How", value: modeLabel(input.booking.mode, locale) },
    { label: ar ? "المدة والسعر" : "Length and price", value: meetingLines(input.settings, locale)[0]! },
  ];
  if (input.booking.mode === "studio") facts.push({ label: ar ? "المكان" : "Where", value: ar ? COMPANY_ADDRESS.ar : COMPANY_ADDRESS.en });

  const { html, text } = renderBrandedEmail({
    locale,
    title: ar ? "اجتماعك مع مهندسنا" : "Your meeting with our engineer",
    preheader: time,
    facts,
    paragraphs: [modeLine(input.booking.mode, locale), ...meetingLines(input.settings, locale).slice(1)],
    buttons: [{ label: ar ? "إدارة الاجتماع" : "Manage your meeting", url: input.manageUrl }],
    siteUrl: input.siteUrl,
  });
  return { subject, html, text };
}

/** A reminder the day before (the daily notifications job). */
export function renderMeetingReminderEmail(input: MeetingMailInput): MeetingMail {
  const locale = asLocale(input.booking.locale);
  const ar = locale === "ar";
  const time = when(input, locale);

  const facts: BrandFact[] = [
    { label: ar ? "الموعد" : "When", value: time },
    { label: ar ? "النوع" : "How", value: modeLabel(input.booking.mode, locale) },
  ];
  if (input.booking.mode === "studio") facts.push({ label: ar ? "المكان" : "Where", value: ar ? COMPANY_ADDRESS.ar : COMPANY_ADDRESS.en });

  const { html, text } = renderBrandedEmail({
    locale,
    title: ar ? "اجتماعك غدًا" : "Your meeting is tomorrow",
    preheader: time,
    facts,
    paragraphs: [modeLine(input.booking.mode, locale)],
    // Only the token's sha256 is stored, so a reminder sent by the cron has no
    // manage link to offer; the footer's WhatsApp line is how they reach us.
    buttons: input.manageUrl ? [{ label: ar ? "إدارة الاجتماع" : "Manage your meeting", url: input.manageUrl }] : [],
    siteUrl: input.siteUrl,
  });
  return { subject: ar ? `تذكير: اجتماعك غدًا — ${time}` : `Reminder: your meeting is tomorrow — ${time}`, html, text };
}

/**
 * The invoice e-mail the owner sends AFTER the meeting, only if the client is
 * happy. The one place the IBAN appears.
 */
export function renderMeetingInvoiceEmail(input: MeetingMailInput): MeetingMail {
  const locale = asLocale(input.booking.locale);
  const ar = locale === "ar";
  const amount = formatQar(input.booking.invoice_qar ?? input.settings.price_qar, locale);
  const time = when(input, locale);

  const { html, text } = renderBrandedEmail({
    locale,
    title: ar ? "فاتورة الاجتماع" : "Invoice for your meeting",
    preheader: `${amount} · ${time}`,
    facts: [
      { label: ar ? "الاجتماع" : "Meeting", value: time },
      { label: ar ? "المبلغ" : "Amount", value: amount },
      { label: ar ? "فوران" : "Fawran", value: PAYMENT_DETAILS.fawranAlias, ltr: true },
      { label: ar ? "البنك" : "Bank", value: PAYMENT_DETAILS.bank },
      { label: ar ? "اسم الحساب" : "Account name", value: PAYMENT_DETAILS.accountName, ltr: true },
      { label: "IBAN", value: PAYMENT_DETAILS.iban, ltr: true },
    ],
    paragraphs: [
      ar
        ? `يمكنك الدفع عبر فوران أو تحويل بنكي. ويُحتسب هذا المبلغ من طلب تصنيع خلال ${input.settings.order_credit_days} يومًا.`
        : `You can pay by Fawran or bank transfer. This amount counts towards a manufacturing order placed within ${input.settings.order_credit_days} days.`,
    ],
    siteUrl: input.siteUrl,
  });
  return { subject: ar ? `فاتورة الاجتماع — ${amount}` : `Invoice for your meeting — ${amount}`, html, text };
}

// ── the owner ────────────────────────────────────────────────────────────────

const CHAT_SOURCE = { plugin: "the chat plugin", website: "the website" } as const;

/** "New meeting booked — <name> · <time>". */
export function meetingBookedSubject(name: string, timeLabel: string): string {
  return `New meeting booked — ${name} · ${timeLabel}`;
}

export function renderMeetingOwnerEmail(input: MeetingMailInput): MeetingMail {
  const time = when(input, "en");
  const clientLocale = asLocale(input.booking.locale);
  const subject = meetingBookedSubject(input.booking.name, time);

  const facts: BrandFact[] = [
    { label: "When", value: time },
    { label: "Mode", value: modeLabel(input.booking.mode, "en") },
    { label: "Name", value: input.booking.name },
    { label: "WhatsApp", value: formatPhoneDisplay(input.booking.phone), ltr: true, action: { label: "Open WhatsApp", url: `https://wa.me/${input.booking.phone.replace(/\D/g, "")}` } },
  ];
  if (input.booking.email) facts.push({ label: "Email", value: input.booking.email, href: `mailto:${input.booking.email}`, ltr: true });
  facts.push(
    { label: "Language", value: clientLocale === "ar" ? "Arabic" : "English" },
    { label: "Booked from", value: CHAT_SOURCE[input.booking.source ?? "website"] },
    { label: "Price", value: formatQar(input.booking.invoice_qar ?? input.settings.price_qar, "en") },
  );

  const { html, text } = renderOwnerEmail({
    title: subject,
    preheader: `${modeLabel(input.booking.mode, "en")} · ${time}`,
    facts,
    paragraphs: [
      input.booking.mode === "online"
        ? "Online meeting: send the Google Meet link on WhatsApp before it starts (Dashboard → Sell → Meetings)."
        : `At the studio: ${COMPANY_ADDRESS.en}.`,
      "Invoice it after the meeting, and only if the client is happy.",
    ],
    quote: input.booking.topic ? { label: "What they want to talk about", text: input.booking.topic } : undefined,
    buttons: [{ label: "Open in dashboard", url: `${(input.siteUrl ?? leadsDashboardUrl()).replace(/\/en\/dashboard\/leads$/, "")}/en/dashboard/meetings` }],
    siteUrl: input.siteUrl,
  });
  return { subject, html, text };
}

/** The lead row's message body (inquiries.message), first line keyed by lib/admin/lead-kind.ts. */
export function meetingLeadMessage(input: MeetingMailInput): string {
  const time = when(input, "en");
  return [
    `Meeting booked: ${time}`,
    `Mode: ${modeLabel(input.booking.mode, "en")}`,
    `Booked from: ${CHAT_SOURCE[input.booking.source ?? "website"]}`,
    input.booking.topic ? `Topic: ${input.booking.topic}` : null,
    `Price: ${formatQar(input.booking.invoice_qar ?? input.settings.price_qar, "en")} — invoiced after the meeting, only if the client is happy.`,
    companyLine("en"),
  ]
    .filter((l): l is string => Boolean(l))
    .join("\n");
}
