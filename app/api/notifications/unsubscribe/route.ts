import { createServiceClient } from "@/lib/supabase/service";
import { escapeHtml } from "@/lib/email";
import { isOutboxKind, normaliseLocale } from "@/lib/notifications/decide";
import { isUuid } from "@/lib/notifications/links";

// Unsubscribe from notification emails (0046), no login.
//   GET  → small bilingual page with a POST button (mail scanners that
//          pre-fetch links therefore never unsubscribe anyone).
//   POST → applies it. Also takes RFC 8058 one-click POSTs from mail clients:
//          token/kind in the query string, body "List-Unsubscribe=One-Click".
// A bad or unknown token gets the same neutral page as a good one.

export const dynamic = "force-dynamic";

type Locale = "en" | "ar";
type Params = { token: string | null; kind: string | null; locale: Locale };

const COPY = {
  en: {
    title: "Email preferences",
    askKind: "Stop this kind of email from Gestaltung?",
    askAll: "Or stop all of these update emails.",
    kindButton: "Stop this kind",
    allButton: "Stop all update emails",
    done: "Done. If this link was valid, your choice has been saved.",
    note: "Order confirmations and replies to your messages are not affected.",
    home: "Back to the website",
  },
  ar: {
    title: "تفضيلات البريد",
    askKind: "هل تريد إيقاف هذا النوع من رسائل جِشتالتُونج؟",
    askAll: "أو أوقف جميع رسائل التحديثات هذه.",
    kindButton: "أوقف هذا النوع",
    allButton: "أوقف جميع رسائل التحديثات",
    done: "تم. إذا كان الرابط صالحًا فقد حفظنا اختيارك.",
    note: "لا يؤثر ذلك على تأكيدات الطلبات أو الردود على رسائلك.",
    home: "العودة إلى الموقع",
  },
} as const;

function readParams(url: URL, form?: URLSearchParams): Params {
  const get = (k: string) => form?.get(k) ?? url.searchParams.get(k);
  return { token: get("token"), kind: get("kind"), locale: normaliseLocale(get("locale")) };
}

function block(locale: Locale, inner: (c: (typeof COPY)[Locale]) => string): string {
  const c = COPY[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  return `<section lang="${locale}" dir="${dir}">${inner(c)}</section>`;
}

function page(locale: Locale, body: (l: Locale) => string): Response {
  const other: Locale = locale === "ar" ? "en" : "ar";
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
  button { font: inherit; border: 0; border-radius: 10px; padding: 10px 16px; margin: 4px 0; cursor: pointer; }
  .primary { background: #0a0e15; color: #fff; }
  .secondary { background: #e3e8ee; color: #1c2430; }
  a { color: #1769c2; }
</style>
</head>
<body><main><div class="card">${body(locale)}${body(other)}</div></main></body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

function confirmPage(p: Params): Response {
  const token = escapeHtml(p.token ?? "");
  const kind = escapeHtml(p.kind ?? "all");
  const showKind = isOutboxKind(p.kind);
  return page(p.locale, (l) =>
    block(l, (c) => `
      <h1>${c.title}</h1>
      <form method="post" action="/api/notifications/unsubscribe">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="locale" value="${l}">
        ${showKind ? `<p>${c.askKind}</p><button class="primary" type="submit" name="kind" value="${kind}">${c.kindButton}</button><p class="muted">${c.askAll}</p>` : ""}
        <button class="${showKind ? "secondary" : "primary"}" type="submit" name="kind" value="all">${c.allButton}</button>
      </form>
      <p class="muted">${c.note}</p>`)
  );
}

function donePage(locale: Locale): Response {
  return page(locale, (l) =>
    block(l, (c) => `
      <h1>${c.title}</h1>
      <p>${c.done}</p>
      <p class="muted">${c.note}</p>
      <p><a href="/${l}">${c.home}</a></p>`)
  );
}

async function apply(p: Params): Promise<void> {
  if (!isUuid(p.token)) return;
  if (p.kind !== "all" && !isOutboxKind(p.kind)) return;
  const kind = p.kind;
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.rpc("notification_unsubscribe", { p_token: p.token, p_kind: kind });
  if (error) console.error(`[unsubscribe] ${error.message}`);
}

export async function GET(request: Request) {
  return confirmPage(readParams(new URL(request.url)));
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let form: URLSearchParams | undefined;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/x-www-form-urlencoded")) {
      form = new URLSearchParams(await request.text());
    } else if (type.includes("multipart/form-data")) {
      const fd = await request.formData();
      form = new URLSearchParams();
      for (const [k, v] of fd.entries()) if (typeof v === "string") form.set(k, v);
    }
  } catch {
    form = undefined;
  }
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  // One-click: the identity is in the query string; the form fields only say "one click".
  const p = oneClick ? readParams(url) : readParams(url, form);
  await apply(p);
  if (oneClick) return new Response("Unsubscribed", { status: 200, headers: { "Cache-Control": "no-store" } });
  return donePage(p.locale);
}
