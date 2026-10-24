import { getSessionContext } from "@/lib/auth/get-session";
import { sendEmail } from "@/lib/email";
import { isNotificationKind, renderNotification, samplePayload } from "@/lib/email/templates";
import { isTransactional } from "@/lib/notifications/decide";
import { buildLinks } from "@/lib/notifications/links";
import { ratingSecret } from "@/lib/orders/rating";
import { siteUrlFor } from "@/lib/projects/recovery";
import { isSuperAdminSession } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";

// "Send test to me" for the notification emails. super_admin only. Renders one
// kind with sample data and sends it to the CALLER's own account email with a
// "[TEST] " subject prefix. Never writes to notification_outbox. Order emails
// link to a sample order id (the page answers "not found"); the delivered
// sample's rating links point at that id too, so tapping one records nothing.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!isSuperAdminSession(session)) return jsonError("forbidden", 403);

  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; locale?: unknown };
  const locale = body.locale === "ar" ? "ar" : body.locale === "en" ? "en" : null;
  if (!isNotificationKind(body.kind) || !locale) return jsonError("bad_request", 400);
  const kind = body.kind;

  const to = session.email;
  if (!to) return jsonError("no_email", 400);
  if (!process.env.RESEND_API_KEY) return jsonError("not_configured", 503);

  const site = siteUrlFor(request.url).replace(/\/+$/, "");
  const payload = samplePayload(kind);
  const links = buildLinks({
    siteUrl: site,
    locale,
    token: "test",
    kind,
    projectId: payload.project_id,
    orderId: payload.order_id,
    ratingSecret: kind === "order_delivered" ? ratingSecret() : null,
    transactional: isTransactional(kind),
  });

  const mail = renderNotification(kind, { locale, payload, links });
  const ok = await sendEmail({ to: [to], subject: `[TEST] ${mail.subject}`, html: mail.html, text: mail.text });
  if (!ok) return jsonError("send_failed", 502);
  return jsonOk({ ok: true, to });
}
