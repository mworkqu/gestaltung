// The small self-contained bilingual HTML pages behind the delivery email's
// rating links (P2-02 rate route, P4-03 review route). Not a next-intl page:
// no JS, no client bundle, plain HTML + a plain form POST. Both routes share
// this shell so the styling and headers stay in one place.

import { escapeHtml } from "@/lib/email";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { REVIEW_COMMENT_MAX } from "@/lib/reviews/comment";

export type RatingLocale = "en" | "ar";

const SHELL_COPY = {
  en: { help: "Questions? Message us on WhatsApp.", home: "Back to the website" },
  ar: { help: "لديك سؤال؟ راسلنا على واتساب.", home: "العودة إلى الموقع" },
} as const;

/** Copy for the comment form (shown right after the one-tap rating). */
export const COMMENT_FORM_COPY = {
  en: {
    label: "Add a one-line comment (optional)",
    submit: "Send comment",
    note: "We read every comment before it appears on the website.",
  },
  ar: {
    label: "أضف تعليقًا من سطر واحد (اختياري)",
    submit: "أرسل التعليق",
    note: "نقرأ كل تعليق قبل أن يظهر على الموقع.",
  },
} as const;

export type CommentFormFields = {
  order: string;
  /** Null leaves the existing score as it is. */
  score: number | null;
  token: string;
  /** The text to put back in the box (after an error). */
  comment?: string;
};

/** The comment form for one language: a plain POST to /api/orders/review. */
export function commentFormHtml(l: RatingLocale, f: CommentFormFields): string {
  const c = COMMENT_FORM_COPY[l];
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<form method="post" action="/api/orders/review" class="comment">
${hidden("order", f.order)}${f.score === null ? "" : hidden("score", String(f.score))}${hidden("l", l)}${hidden("t", f.token)}
<label for="comment-${l}">${escapeHtml(c.label)}</label>
<input id="comment-${l}" type="text" name="comment" maxlength="${REVIEW_COMMENT_MAX}" dir="auto" autocomplete="off" value="${escapeHtml(f.comment ?? "")}">
<button type="submit">${escapeHtml(c.submit)}</button>
<p class="muted">${escapeHtml(c.note)}</p>
</form>`;
}

export const RATING_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
} as const;

/**
 * The page: the visitor's language first, the other below. `section` returns
 * the inner HTML of one language block (already escaped); `primary` is true for
 * the visitor's own language, so a form is only rendered once.
 */
export function renderRatingPage(opts: {
  locale: RatingLocale;
  title: Record<RatingLocale, string>;
  section: (l: RatingLocale, primary: boolean) => string;
  status: number;
}): Response {
  const { locale } = opts;
  const other: RatingLocale = locale === "ar" ? "en" : "ar";
  const block = (l: RatingLocale) => {
    const c = SHELL_COPY[l];
    const dir = l === "ar" ? "rtl" : "ltr";
    return `<section lang="${l}" dir="${dir}">${opts.section(l, l === locale)}<p class="muted"><a href="${escapeHtml(COMPANY_WHATSAPP.url)}">${escapeHtml(c.help)}</a> · <a href="/${l}">${escapeHtml(c.home)}</a></p></section>`;
  };
  const html = `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Gestaltung · ${escapeHtml(opts.title[locale])}</title>
<style>
  body { margin: 0; background: #eef1f5; color: #1c2430; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", "IBM Plex Sans Arabic", sans-serif; }
  main { max-width: 520px; margin: 48px auto; padding: 0 16px; }
  .card { background: #f7f9fb; border-radius: 16px; padding: 28px; box-shadow: 6px 6px 14px #d3d8df, -6px -6px 14px #ffffff; }
  section + section { margin-top: 24px; padding-top: 24px; border-top: 1px solid #dde2e8; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 12px; }
  .muted { color: #5b6675; font-size: 14px; }
  .error { color: #b3261e; font-weight: 600; }
  .quote { background: #eef1f5; border-radius: 10px; padding: 10px 12px; overflow-wrap: anywhere; }
  .comment { margin: 16px 0; }
  .comment label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .comment input[type="text"] { box-sizing: border-box; width: 100%; min-height: 44px; padding: 8px 12px; font: inherit; color: inherit; background: #fff; border: 1px solid #c9d0d9; border-radius: 10px; }
  .comment button { margin-top: 10px; min-height: 44px; padding: 8px 18px; font: inherit; font-weight: 600; color: #fff; background: #1769c2; border: 0; border-radius: 999px; cursor: pointer; }
  .comment .muted { margin: 10px 0 0; }
  a { color: #1769c2; }
</style>
</head>
<body><main><div class="card">${block(locale)}${block(other)}</div></main></body>
</html>`;
  return new Response(html, { status: opts.status, headers: RATING_PAGE_HEADERS });
}
