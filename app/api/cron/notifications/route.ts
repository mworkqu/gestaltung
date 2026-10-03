import { createServiceClient } from "@/lib/supabase/service";
import { sendEmailResult } from "@/lib/email";
import { siteUrlFor } from "@/lib/projects/recovery";
import { renderNotification, NOTIFICATION_KINDS, type NotificationKind } from "@/lib/email/templates";
import { decide, kindSettings, normaliseLocale, type OutboxRow } from "@/lib/notifications/decide";
import { buildLinks, isAuthorizedCron, unsubscribeHeaders } from "@/lib/notifications/links";

// Drains notification_outbox (0046) every 15 minutes (vercel.json cron):
// claim up to 50 rows → per row: owner switch (skipped 'disabled'), opt-out
// (skipped 'unsubscribed'), email (skipped 'no_email') → render the bilingual
// template → send through Resend with List-Unsubscribe headers → mark sent or
// failed. Failed rows are retried by later runs until attempts reaches 3.
// Double sends: claim_notifications locks with SKIP LOCKED and stamps
// claimed_at (10-minute visibility timeout); Resend also gets the outbox id as
// Idempotency-Key.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 50;

type ClaimedRow = OutboxRow & {
  token: string | null;
  unsubscribed_kinds: string[] | null;
  all_off: boolean | null;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_secret_unset" }, { status: 500 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) return Response.json({ error: "no_service_key" }, { status: 500 });

  const { data: claimed, error: claimError } = await db.rpc("claim_notifications", { p_limit: BATCH });
  if (claimError) {
    // PGRST202 / 42883 = 0046 not run yet.
    return Response.json({ error: "claim_failed", detail: claimError.message }, { status: 500 });
  }
  const rows = (claimed ?? []) as ClaimedRow[];
  const summary = { claimed: rows.length, sent: 0, failed: 0, skipped: 0, reasons: {} as Record<string, number> };
  if (!rows.length) return Response.json(summary);

  const { data: settingsRow } = await db.from("store_settings").select("value").eq("key", "notifications").maybeSingle();
  const settings = kindSettings(settingsRow?.value);
  const siteUrl = siteUrlFor(request.url);

  const mark = async (id: string, status: "sent" | "failed" | "skipped", error?: string) => {
    const { error: e } = await db.rpc("mark_notification", { p_id: id, p_status: status, p_error: error ?? null });
    if (e) console.error(`[notifications] mark ${id} ${status} failed: ${e.message}`);
  };

  for (const row of rows) {
    try {
      const verdict = decide(row, settings, {
        token: row.token,
        unsubscribed_kinds: row.unsubscribed_kinds,
        all_off: row.all_off,
      });
      if (verdict !== "send") {
        await mark(row.id, "skipped", verdict.skip);
        summary.skipped++;
        summary.reasons[verdict.skip] = (summary.reasons[verdict.skip] ?? 0) + 1;
        continue;
      }
      if (!(NOTIFICATION_KINDS as readonly string[]).includes(row.kind)) {
        await mark(row.id, "skipped", "unknown_kind");
        summary.skipped++;
        summary.reasons.unknown_kind = (summary.reasons.unknown_kind ?? 0) + 1;
        continue;
      }
      const locale = normaliseLocale(row.locale);
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const links = buildLinks({ siteUrl, locale, token: row.token!, kind: row.kind, projectId: payload.project_id });
      const mail = renderNotification(row.kind as NotificationKind, { locale, payload, links });
      const res = await sendEmailResult({
        to: [row.email!.trim()],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { ...unsubscribeHeaders(links.unsubscribeUrl), "X-Entity-Ref-ID": row.id },
        idempotencyKey: `notification-${row.id}`,
      });
      if (res.ok) {
        await mark(row.id, "sent");
        summary.sent++;
      } else {
        await mark(row.id, "failed", res.error ?? "send_failed");
        summary.failed++;
      }
    } catch (e) {
      await mark(row.id, "failed", `exception: ${e instanceof Error ? e.message : String(e)}`);
      summary.failed++;
    }
  }

  console.log(`[notifications] ${JSON.stringify(summary)}`);
  return Response.json(summary);
}
