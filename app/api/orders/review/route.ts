import { createServiceClient } from "@/lib/supabase/service";
import { escapeHtml } from "@/lib/email";
import { commentFormHtml, RATING_PAGE_HEADERS, renderRatingPage, type RatingLocale } from "@/lib/orders/rating-page";
import { parseScore, ratingSecret, verifyRatingToken } from "@/lib/orders/rating";
import { validateComment } from "@/lib/reviews/comment";
import { parseReviewBody, REVIEW_BODY_MAX_BYTES } from "@/lib/reviews/form";

// The one-line comment on a delivered order (P4-03, migration 0058).
// POST /api/orders/review  (form body or JSON: order, score?, comment, l, t)
// The link's HMAC token (the same one the rating links carry) proves the
// customer got the delivery email. The comment is checked here (280 chars, no
// links) and again in record_order_review; any change puts the review back to
// "pending" until the owner approves it. Nothing is shown on the website
// before that. The page answers in both languages and echoes back only the
// customer's own comment, escaped. GET is 405; a bad link or a bad comment
// writes nothing.

export const dynamic = "force-dynamic";

type Locale = RatingLocale;

const COPY = {
  en: {
    title: "Thank you",
    thanks: "Thank you — we have your comment.",
    cleared: "Thank you — your comment has been removed.",
    note: "We read every comment before it appears on the website.",
    tooLong: "That comment is too long. Please keep it to one short line (280 characters at most).",
    link: "Please leave out web addresses and links, and send the comment again.",
    failed: "We could not save your comment just now. Please try again in a little while.",
    bad: "This link is not valid. If you copied it, please use the link in the email.",
    tooBig: "That message is too large.",
  },
  ar: {
    title: "شكرًا لك",
    thanks: "شكرًا لك — وصلنا تعليقك.",
    cleared: "شكرًا لك — تم حذف تعليقك.",
    note: "نقرأ كل تعليق قبل أن يظهر على الموقع.",
    tooLong: "التعليق طويل جدًا. يرجى الاكتفاء بسطر قصير (280 حرفًا كحد أقصى).",
    link: "يرجى عدم وضع عناوين مواقع أو روابط، ثم أرسل التعليق مرة أخرى.",
    failed: "تعذّر حفظ تعليقك الآن. يرجى المحاولة مرة أخرى بعد قليل.",
    bad: "هذا الرابط غير صالح. إذا نسخته، فاستخدم الرابط الموجود في الرسالة.",
    tooBig: "الرسالة كبيرة جدًا.",
  },
} as const;

type Outcome =
  | { kind: "bad" }
  | { kind: "tooBig" }
  | { kind: "thanks"; comment: string; cleared: boolean }
  | { kind: "error"; message: "tooLong" | "link" | "failed" };

type Ctx = { locale: Locale; order: string; score: number | null; token: string; comment: string };

function page(locale: Locale, outcome: Outcome, ctx?: Ctx): Response {
  const status = outcome.kind === "thanks" ? 200 : outcome.kind === "tooBig" ? 413 : outcome.kind === "bad" ? 400 : outcome.message === "failed" ? 500 : 400;
  return renderRatingPage({
    locale,
    title: { en: COPY.en.title, ar: COPY.ar.title },
    status,
    section: (l, primary) => {
      const c = COPY[l];
      if (outcome.kind === "bad") return `<p>${escapeHtml(c.bad)}</p>`;
      if (outcome.kind === "tooBig") return `<p>${escapeHtml(c.tooBig)}</p>`;
      if (outcome.kind === "thanks") {
        const quote = primary && outcome.comment ? `<p class="quote" dir="auto">${escapeHtml(outcome.comment)}</p>` : "";
        return `<h1>${escapeHtml(outcome.cleared ? c.cleared : c.thanks)}</h1>${quote}<p class="muted">${escapeHtml(c.note)}</p>`;
      }
      // An error: say what went wrong, and give the form back with the text they typed.
      const form =
        primary && ctx ? commentFormHtml(l, { order: ctx.order, score: ctx.score, token: ctx.token, comment: ctx.comment }) : "";
      return `<p class="error">${escapeHtml(c[outcome.message])}</p>${form}`;
    },
  });
}

/** Read the request body, giving up once it passes the cap (a missing or wrong Content-Length cannot sneak a big body in). */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > REVIEW_BODY_MAX_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REVIEW_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    all.set(ch, at);
    at += ch.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function POST(request: Request) {
  const raw = await readCapped(request);
  if (raw === null) return page("en", { kind: "tooBig" });
  const body = parseReviewBody(request.headers.get("content-type"), raw);
  if (!body) return page("en", { kind: "bad" });

  const { locale, order, token } = body;
  if (!order || !token || !verifyRatingToken(order, token, ratingSecret())) return page(locale, { kind: "bad" });

  // The score is optional: absent or invalid keeps whatever is stored.
  const score = parseScore(body.score);
  // An absent comment field keeps the stored one; a blank one clears it.
  const checked = body.comment === null ? null : validateComment(body.comment);
  if (checked && !checked.ok) {
    return page(locale, { kind: "error", message: checked.reason === "link" ? "link" : "tooLong" }, {
      locale,
      order,
      score,
      token,
      comment: (body.comment ?? "").slice(0, 400),
    });
  }
  const comment = checked ? checked.comment : null;
  const ctx: Ctx = { locale, order, score, token, comment: comment ?? "" };

  const db = createServiceClient();
  if (!db) {
    console.error("[review] no service key; comment not recorded");
    return page(locale, { kind: "error", message: "failed" }, ctx);
  }
  const { data, error } = await db.rpc("record_order_review", {
    p_order: order,
    p_score: score,
    p_comment: comment,
    p_locale: locale,
  });
  if (error) {
    console.error(`[review] ${order}: ${error.message}`);
    // The database re-checks length and links; say so politely instead of "failed".
    if (/bad_comment/.test(error.message)) {
      return page(locale, { kind: "error", message: "link" }, ctx);
    }
    return page(locale, { kind: "error", message: "failed" }, ctx);
  }
  if (data === false) {
    console.warn(`[review] ${order}: not delivered or not found; nothing recorded`);
    return page(locale, { kind: "error", message: "failed" }, ctx);
  }
  return page(locale, { kind: "thanks", comment: comment ?? "", cleared: comment === "" });
}

function notAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...RATING_PAGE_HEADERS, Allow: "POST" } });
}

export const GET = notAllowed;
export const HEAD = notAllowed;
