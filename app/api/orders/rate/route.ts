import { createServiceClient } from "@/lib/supabase/service";
import { escapeHtml } from "@/lib/email";
import { commentFormHtml, renderRatingPage } from "@/lib/orders/rating-page";
import { parseScore, ratingSecret, verifyRatingToken } from "@/lib/orders/rating";

// One-tap rating from the "order delivered" email (P2-02).
// GET /api/orders/rate?order=<id>&score=<1-5>&l=<en|ar>&t=<HMAC token>
// A valid link records the score (record_order_rating, 0053: demand_signals
// kind "rating", one row per order, a second tap changes the score) and shows
// a small bilingual thank-you page. A bad link gets a neutral page and writes
// nothing. HEAD never writes (some mail scanners probe links with HEAD).
// Before 0053 runs the RPC is missing: the page still says thank you and the
// error is logged. P4-03 (0058): the score is also written to the review row
// (record_order_review), and the page offers a one-line comment that posts to
// /api/orders/review.

export const dynamic = "force-dynamic";

type Locale = "en" | "ar";

const COPY = {
  en: {
    title: "Thank you",
    thanks: (n: number) => `Thank you — you rated your order ${n} out of 5.`,
    change: "Changed your mind? Tap another number in the email.",
    bad: "This rating link is not valid. If you copied it, please use the link in the email.",
  },
  ar: {
    title: "شكرًا لك",
    thanks: (n: number) => `شكرًا لك — قيّمت طلبك بـ ${n} من 5.`,
    change: "غيّرت رأيك؟ اختر رقمًا آخر في الرسالة.",
    bad: "رابط التقييم هذا غير صالح. إذا نسخته، فاستخدم الرابط الموجود في الرسالة.",
  },
} as const;

type Valid = { order: string; score: number; token: string };

function page(locale: Locale, valid: Valid | null): Response {
  return renderRatingPage({
    locale,
    title: { en: COPY.en.title, ar: COPY.ar.title },
    status: valid ? 200 : 400,
    section: (l, primary) => {
      const c = COPY[l];
      if (!valid) return `<p>${escapeHtml(c.bad)}</p>`;
      const form = primary ? commentFormHtml(l, { order: valid.order, score: valid.score, token: valid.token }) : "";
      return `<h1>${escapeHtml(c.thanks(valid.score))}</h1><p class="muted">${escapeHtml(c.change)}</p>${form}`;
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale: Locale = url.searchParams.get("l") === "ar" ? "ar" : "en";
  const order = url.searchParams.get("order");
  const token = url.searchParams.get("t");
  const score = parseScore(url.searchParams.get("score"));
  if (!score || !order || !token || !verifyRatingToken(order, token, ratingSecret())) return page(locale, null);
  const valid: Valid = { order, score, token };

  const db = createServiceClient();
  if (!db) {
    console.error("[rate] no service key; rating not recorded");
    return page(locale, valid);
  }
  const { data, error } = await db.rpc("record_order_rating", { p_order: order, p_score: score });
  if (error) console.error(`[rate] ${order} ${score}: ${error.message}`);
  else if (data === false) console.warn(`[rate] ${order}: not delivered or not found; nothing recorded`);

  // P4-03: the same score also goes on the review (0058, pending until the owner
  // approves it). A failure (including 0058 not run yet) is logged, never shown.
  const review = await db.rpc("record_order_review", { p_order: order, p_score: score, p_comment: null, p_locale: locale });
  if (review.error) console.error(`[rate] review ${order} ${score}: ${review.error.message}`);
  return page(locale, valid);
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
