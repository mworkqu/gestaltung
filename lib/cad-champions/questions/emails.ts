// "A trainer answered your question" email (Prompt 8 Step E). Bilingual
// (the student's language first), one button to the results or lesson page,
// built with the site's renderBrandedEmail() shell.
// renderAnswerEmail is PURE (tested); sendAnswerEmail is SERVER ONLY.

import { sendEmailResult } from "@/lib/email";
import { BRAND, escapeHtmlText, renderBrandedEmail } from "@/lib/email/brand-layout";

export interface AnswerEmailData {
  locale: "en" | "ar";
  name: string | null;
  kind: "grade_query" | "lesson";
  question: string;
  answer: string;
  /** Absolute URL of the results page (grade query) or the lesson / training page. */
  url: string;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const COPY = {
  en: {
    title: "A trainer answered your question",
    hi: (n: string | null) => (n ? `Hi ${n},` : "Hi,"),
    lead: { grade_query: "A trainer has answered your question about your result.", lesson: "A trainer has answered your question about a lesson." },
    yourQ: "Your question",
    answer: "The answer",
    button: { grade_query: "Open my results", lesson: "Open the lesson" },
    reason: "You get this email because you asked a question in CAD Champions.",
  },
  ar: {
    title: "أجاب المدرّب عن سؤالك",
    hi: (n: string | null) => (n ? `مرحبًا ${n}،` : "مرحبًا،"),
    lead: { grade_query: "أجاب المدرّب عن سؤالك حول نتيجتك.", lesson: "أجاب المدرّب عن سؤالك حول أحد الدروس." },
    yourQ: "سؤالك",
    answer: "الإجابة",
    button: { grade_query: "افتح نتائجي", lesson: "افتح الدرس" },
    reason: "وصلتك هذه الرسالة لأنك طرحت سؤالًا في CAD Champions.",
  },
} as const;

function otherBlock(locale: "en" | "ar", d: AnswerEmailData): { html: string; text: string } {
  const c = COPY[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const align = locale === "ar" ? "right" : "left";
  const paras = [c.title, c.hi(d.name), c.lead[d.kind]];
  const html = `<div dir="${dir}" lang="${locale}" style="margin:18px 0 6px;padding:14px 0 0;border-top:1px solid ${BRAND.border};text-align:${align};font-family:Arial,Helvetica,sans-serif">${paras
    .map((p, i) => `<p style="margin:0 0 12px;font-size:${i === 0 ? 17 : 15}px;line-height:1.6;color:${i === 0 ? BRAND.ink : BRAND.body};${i === 0 ? "font-weight:bold;" : ""}">${escapeHtmlText(p)}</p>`)
    .join("")}</div>`;
  return { html, text: paras.join("\n\n") };
}

export function renderAnswerEmail(d: AnswerEmailData): { subject: string; html: string; text: string } {
  const main = COPY[d.locale];
  const other: "en" | "ar" = d.locale === "ar" ? "en" : "ar";
  const second = otherBlock(other, d);
  const { html, text } = renderBrandedEmail({
    locale: d.locale,
    title: main.title,
    preheader: clip(d.answer, 90),
    paragraphs: [main.hi(d.name), main.lead[d.kind]],
    quote: { label: `${main.yourQ} · ${COPY[other].yourQ}`, text: clip(d.question, 600) },
    bodyHtml: `<p style="margin:12px 0 4px;font-weight:bold;color:${BRAND.ink}">${escapeHtmlText(`${main.answer} · ${COPY[other].answer}`)}</p><p style="margin:0 0 12px;white-space:pre-line;color:${BRAND.body};line-height:1.6">${escapeHtmlText(clip(d.answer, 3000))}</p>${second.html}`,
    bodyText: `${main.answer}:\n${clip(d.answer, 3000)}\n\n${second.text}`,
    buttons: [{ label: `${main.button[d.kind]} · ${COPY[other].button[d.kind]}`, url: d.url }],
    footer: { reason: `${main.reason} · ${COPY[other].reason}` },
  });
  return { subject: `${main.title} · ${COPY[other].title}`, html, text };
}

/** Sends the answer email. Returns false (never throws) when it could not be sent. */
export async function sendAnswerEmail(to: string, d: AnswerEmailData, questionId: string): Promise<boolean> {
  try {
    const mail = renderAnswerEmail(d);
    const sent = await sendEmailResult({ to: [to], ...mail, idempotencyKey: `cc-answer-${questionId}-${d.answer.length}` });
    if (!sent.ok) console.error("[cc-questions] answer email failed:", sent.error);
    return sent.ok;
  } catch (e) {
    console.error("[cc-questions] answer email failed:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}
