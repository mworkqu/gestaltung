// Server side: the bilingual "your project link" email (owner decision D6,
// migration 0045). Pure — the API routes send it through lib/email.ts.

import { renderBrandedEmail } from "@/lib/email/brand-layout";

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
  const name = input.projectName.trim() || "—";
  const { html, text } = renderBrandedEmail({
    locale: input.locale,
    title: c.subject,
    preheader: c.keep,
    paragraphs: [...(input.kind === "moved" ? [c.moved] : []), c.keep],
    facts: [{ label: c.project.replace(/:$/, ""), value: name }],
    // The link is in the button's href only; the plain-text part spells it out.
    buttons: [{ label: c.open, url: input.url }],
    footer: { reason: undefined },
  });
  return { subject: c.subject, html, text };
}
