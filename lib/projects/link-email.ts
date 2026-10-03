// Server side: the bilingual "your project link" email (owner decision D6,
// migration 0045). Pure — the API routes send it through lib/email.ts.

import { escapeHtml } from "@/lib/email";
import { COMPANY, COMPANY_WHATSAPP } from "@/lib/company";

export type ProjectLinkEmailInput = {
  locale: "en" | "ar";
  projectName: string;
  url: string;
  /** "created": sent once when the project is made. "moved": the link was just used on another device, here is the new one. */
  kind: "created" | "moved";
};

const COPY = {
  en: {
    subject: "Your Gestaltung360 project link",
    project: "Your project:",
    open: "Open your project",
    keep: "Keep this email to open your project on any device.",
    moved:
      "Your project was just opened on another device, so here is a new link. Earlier links no longer work. If this wasn't you, message us on WhatsApp.",
    whatsapp: "WhatsApp",
  },
  ar: {
    subject: "رابط مشروعك في Gestaltung360",
    project: "مشروعك:",
    open: "افتح مشروعك",
    keep: "احتفظ بهذه الرسالة لفتح مشروعك على أي جهاز.",
    moved:
      "فُتح مشروعك للتو على جهاز آخر، لذا هذا رابط جديد. الروابط السابقة لم تعد تعمل. إن لم تكن أنت، راسلنا عبر واتساب.",
    whatsapp: "واتساب",
  },
} as const;

export function projectLinkEmail(input: ProjectLinkEmailInput): { subject: string; html: string; text: string } {
  const c = COPY[input.locale];
  const ar = input.locale === "ar";
  const brand = `${COMPANY.legalNameEn} · C.R. ${COMPANY.crNumber}`;
  const name = input.projectName.trim() || "—";
  const url = input.url;

  const html = [
    `<div dir="${ar ? "rtl" : "ltr"}" lang="${input.locale}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;text-align:${ar ? "right" : "left"}">`,
    input.kind === "moved" ? `<p>${escapeHtml(c.moved)}</p>` : "",
    `<p>${escapeHtml(c.project)} <b>${escapeHtml(name)}</b></p>`,
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(c.open)}</a></p>`,
    `<p dir="ltr" style="font-size:12px;color:#475569;word-break:break-all;text-align:left"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    `<p>${escapeHtml(c.keep)}</p>`,
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>`,
    `<p style="font-size:12px;color:#64748b"><span dir="ltr">${escapeHtml(brand)}</span><br/>${escapeHtml(c.whatsapp)} <a href="${COMPANY_WHATSAPP.url}" dir="ltr">${COMPANY_WHATSAPP.display}</a></p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    input.kind === "moved" ? c.moved : null,
    `${c.project} ${name}`,
    `${c.open}: ${url}`,
    c.keep,
    "",
    brand,
    `${c.whatsapp} ${COMPANY_WHATSAPP.display}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject: c.subject, html, text };
}
