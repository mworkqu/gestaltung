import { createServiceClient } from "@/lib/supabase/service";
import { escapeHtml } from "@/lib/email";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { parseScore, ratingSecret, verifyRatingToken } from "@/lib/orders/rating";

// One-tap rating from the "order delivered" email (P2-02).
// GET /api/orders/rate?order=<id>&score=<1-5>&l=<en|ar>&t=<HMAC token>
// A valid link records the score (record_order_rating, 0053: demand_signals
// kind "rating", one row per order, a second tap changes the score) and shows
// a small bilingual thank-you page. A bad link gets a neutral page and writes
// nothing. HEAD never writes (some mail scanners probe links with HEAD).
// Before 0053 runs the RPC is missing: the page still says thank you and the
// error is logged.

export const dynamic = "force-dynamic";

type Locale = "en" | "ar";

const COPY = {
  en: {
    title: "Thank you",
    thanks: (n: number) => `Thank you — you rated your order ${n} out of 5.`,
    change: "Changed your mind? Tap another number in the email.",
    bad: "This rating link is not valid. If you copied it, please use the link in the email.",
    help: "Questions? Message us on WhatsApp.",
    home: "Back to the website",
  },
  ar: {
    title: "شكرًا لك",
    thanks: (n: number) => `شكرًا لك — قيّمت طلبك بـ ${n} من 5.`,
    change: "غيّرت رأيك؟ اختر رقمًا آخر في الرسالة.",
    bad: "رابط التقييم هذا غير صالح. إذا نسخته، فاستخدم الرابط الموجود في الرسالة.",
    help: "لديك سؤال؟ راسلنا على واتساب.",
    home: "العودة إلى الموقع",
  },
} as const;

function page(locale: Locale, score: number | null): Response {
  const other: Locale = locale === "ar" ? "en" : "ar";
  const block = (l: Locale) => {
    const c = COPY[l];
    const dir = l === "ar" ? "rtl" : "ltr";
    const lines =
      score === null
        ? `<p>${escapeHtml(c.bad)}</p>`
        : `<h1>${escapeHtml(c.thanks(score))}</h1><p class="muted">${escapeHtml(c.change)}</p>`;
    return `<section lang="${l}" dir="${dir}">${lines}<p class="muted"><a href="${escapeHtml(COMPANY_WHATSAPP.url)}">${escapeHtml(c.help)}</a> · <a href="/${l}">${escapeHtml(c.home)}</a></p></section>`;
  };
  const html = `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Gestaltung · ${escapeHtml(COPY[locale].title)}</title>
<style>
  body { margin: 0; background: #eef1f5; color: #1c2430; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", "IBM Plex Sans Arabic", sans-serif; }
  main { max-width: 520px; margin: 48px auto; padding: 0 16px; }
  .card { background: #f7f9fb; border-radius: 16px; padding: 28px; box-shadow: 6px 6px 14px #d3d8df, -6px -6px 14px #ffffff; }
  section + section { margin-top: 24px; padding-top: 24px; border-top: 1px solid #dde2e8; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 12px; }
  .muted { color: #5b6675; font-size: 14px; }
  a { color: #1769c2; }
</style>
</head>
<body><main><div class="card">${block(locale)}${block(other)}</div></main></body>
</html>`;
  return new Response(html, {
    status: score === null ? 400 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale: Locale = url.searchParams.get("l") === "ar" ? "ar" : "en";
  const order = url.searchParams.get("order");
  const score = parseScore(url.searchParams.get("score"));
  if (!score || !verifyRatingToken(order, url.searchParams.get("t"), ratingSecret())) return page(locale, null);

  const db = createServiceClient();
  if (!db) {
    console.error("[rate] no service key; rating not recorded");
    return page(locale, score);
  }
  const { data, error } = await db.rpc("record_order_rating", { p_order: order, p_score: score });
  if (error) console.error(`[rate] ${order} ${score}: ${error.message}`);
  else if (data === false) console.warn(`[rate] ${order}: not delivered or not found; nothing recorded`);
  return page(locale, score);
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
