// The customer's confirmation of a quote request (F-021): reference + file name.
// Pure; /api/design-quote sends it only when the visitor gave an email.

import { renderBrandedEmail } from "@/lib/email/brand-layout";

const COPY = {
  en: {
    subject: "We received your quote request",
    title: "Request received",
    body: "Our engineer replies within one working day.",
    reference: "Reference",
    file: "File",
    noFile: "No file attached",
    fileMissing: "Not uploaded - please send it to us on WhatsApp or email",
  },
  ar: {
    subject: "استلمنا طلب عرض السعر",
    title: "تم استلام الطلب",
    body: "يرد عليك مهندسنا خلال يوم عمل واحد.",
    reference: "رقم الطلب",
    file: "الملف",
    noFile: "لا يوجد ملف مرفق",
    fileMissing: "لم يُرفع - أرسله لنا عبر واتساب أو البريد",
  },
} as const;

export function quoteReceivedEmail(input: {
  locale: "en" | "ar";
  reference: string;
  fileName: string;
  fileUploaded: boolean;
  siteUrl?: string;
}): { subject: string; html: string; text: string } {
  const c = COPY[input.locale];
  const fileValue = !input.fileName ? c.noFile : input.fileUploaded ? input.fileName : `${input.fileName} - ${c.fileMissing}`;
  const { html, text } = renderBrandedEmail({
    locale: input.locale,
    title: c.title,
    preheader: `${c.reference}: ${input.reference}`,
    paragraphs: [c.body],
    facts: [
      { label: c.reference, value: input.reference, ltr: true },
      { label: c.file, value: fileValue, ltr: true },
    ],
    siteUrl: input.siteUrl,
  });
  return { subject: `${c.subject} (${input.reference})`, html, text };
}
