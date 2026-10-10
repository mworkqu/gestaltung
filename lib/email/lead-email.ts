// The owner's lead alert (quote request, contact message, callback, BOM quote,
// CAD file on a project) and the small owner-only notices (cron reports,
// demand signals). Always English: the owner reads these. Built on the shared
// branded shell. Pure.

import { toWhatsAppDigits, formatPhoneDisplay } from "@/lib/phone";
import { formatFileSize } from "@/lib/format-bytes";
import { renderBrandedEmail, defaultSiteUrl, type BrandButton, type BrandEmailDoc, type BrandFact } from "@/lib/email/brand-layout";

export type LeadEmailInput = {
  /** "New quote request", "New contact message" ... */
  title: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** Kind of lead ("Contact form", "Partnership"), shown as the Type row. */
  type?: string | null;
  /** Manufacturing method, shown as the Method row. */
  method?: string | null;
  file?: {
    name: string;
    /** Real bytes (formatted here); omit when unknown. */
    sizeBytes?: number;
    /** The upload never reached storage. */
    failed?: boolean;
  } | null;
  /** Signed link behind the "Download file" button (never shown as text). */
  downloadUrl?: string | null;
  projectName?: string | null;
  /** The customer's language, shown so the owner replies in it. */
  language?: string | null;
  /** Free text: notes / message / BOM lines. */
  notes?: { label: string; text: string } | null;
  siteUrl?: string;
};

/** Where "Open in dashboard" goes (the owner's Messages & requests page). */
export function leadsDashboardUrl(siteUrl: string = defaultSiteUrl()): string {
  return `${siteUrl.replace(/\/+$/, "")}/en/dashboard/leads`;
}

/** The "Reason" line of every owner email. */
export const OWNER_REASON = "You are receiving this because it came in through the Gestaltung360 website.";

export function renderLeadEmail(input: LeadEmailInput): { html: string; text: string } {
  const site = (input.siteUrl || defaultSiteUrl()).replace(/\/+$/, "");
  const waDigits = input.phone ? toWhatsAppDigits(input.phone) : null;
  const phoneShown = formatPhoneDisplay(input.phone);

  const facts: BrandFact[] = [{ label: "Name", value: input.name, ltr: false }];
  if (phoneShown) {
    facts.push({
      label: "WhatsApp",
      value: phoneShown,
      ltr: true,
      ...(waDigits ? { action: { label: "Open WhatsApp", url: `https://wa.me/${waDigits}` } } : {}),
    });
  }
  if (input.email) facts.push({ label: "Email", value: input.email, href: `mailto:${input.email}`, ltr: true });
  if (input.type) facts.push({ label: "Type", value: input.type });
  if (input.method) facts.push({ label: "Method", value: input.method });
  if (input.file?.name) {
    const size = formatFileSize(input.file.sizeBytes);
    const note = input.file.failed ? "upload failed, the customer will send it another way" : "";
    facts.push({
      label: "File",
      value: [input.file.name, size && `(${size})`, note && `— ${note}`].filter(Boolean).join(" "),
      ltr: !input.file.failed,
    });
  }
  if (input.projectName) facts.push({ label: "Project", value: input.projectName });
  if (input.language) facts.push({ label: "Language", value: input.language === "ar" ? "Arabic" : input.language === "en" ? "English" : input.language });

  const buttons: BrandButton[] = [];
  if (input.downloadUrl) buttons.push({ label: "Download file", url: input.downloadUrl });
  buttons.push({ label: "Open in dashboard", url: leadsDashboardUrl(site), variant: input.downloadUrl ? "secondary" : "primary" });

  return renderBrandedEmail({
    locale: "en",
    title: input.title,
    preheader: `${input.name}${phoneShown ? ` · ${phoneShown}` : ""}`,
    facts,
    quote: input.notes && input.notes.text.trim() ? input.notes : undefined,
    buttons,
    footer: { reason: OWNER_REASON, help: false },
    siteUrl: site,
  });
}

/**
 * A plain owner notice (cron summaries, demand signals): title, optional
 * paragraphs / facts / a table of rows, optional buttons. English.
 */
export function renderOwnerEmail(
  doc: Omit<BrandEmailDoc, "locale" | "footer"> & { reason?: string }
): { html: string; text: string } {
  const { reason, ...rest } = doc;
  return renderBrandedEmail({ ...rest, locale: "en", footer: { reason: reason ?? OWNER_REASON, help: false } });
}
