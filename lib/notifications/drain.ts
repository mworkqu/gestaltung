// Drains notification_outbox (0046): claim up to `limit` rows → per row: owner
// switch (skipped 'disabled'), the discount window (skipped 'expired'), opt-out
// (skipped 'unsubscribed', not for order emails), email (skipped 'no_email')
// → render the bilingual template → send through Resend → mark sent or
// failed. Failed rows are retried by later runs until attempts reaches 3.
// Double sends: claim_notifications locks with SKIP LOCKED and stamps
// claimed_at (10-minute visibility timeout); Resend also gets the outbox id as
// Idempotency-Key. Used by the daily cron (app/api/cron/notifications) and,
// right after an admin status change, by the orders server action (after()).

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmailResult } from "@/lib/email";
import { renderNotification, NOTIFICATION_KINDS, type NotificationKind } from "@/lib/email/templates";
import { decide, isTransactional, kindSettings, normaliseLocale, type OutboxRow } from "@/lib/notifications/decide";
import { buildLinks, unsubscribeHeaders } from "@/lib/notifications/links";
import { ratingSecret } from "@/lib/orders/rating";

export type ClaimedRow = OutboxRow & {
  token: string | null;
  unsubscribed_kinds: string[] | null;
  all_off: boolean | null;
};

export type DrainSummary = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  reasons: Record<string, number>;
};

export type DrainResult = { ok: true; summary: DrainSummary } | { ok: false; error: string; detail?: string };

export async function drainOutbox(db: SupabaseClient, siteUrl: string, limit = 50): Promise<DrainResult> {
  const { data: claimed, error: claimError } = await db.rpc("claim_notifications", { p_limit: limit });
  if (claimError) {
    // PGRST202 / 42883 = 0046 not run yet.
    return { ok: false, error: "claim_failed", detail: claimError.message };
  }
  const rows = (claimed ?? []) as ClaimedRow[];
  const summary: DrainSummary = { claimed: rows.length, sent: 0, failed: 0, skipped: 0, reasons: {} };
  if (!rows.length) return { ok: true, summary };

  const { data: settingsRow } = await db.from("store_settings").select("value").eq("key", "notifications").maybeSingle();
  const settings = kindSettings(settingsRow?.value);
  const secret = ratingSecret();

  const mark = async (id: string, status: "sent" | "failed" | "skipped", error?: string) => {
    const { error: e } = await db.rpc("mark_notification", { p_id: id, p_status: status, p_error: error ?? null });
    if (e) console.error(`[notifications] mark ${id} ${status} failed: ${e.message}`);
  };
  const skip = async (id: string, reason: string) => {
    await mark(id, "skipped", reason);
    summary.skipped++;
    summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    try {
      const verdict = decide(row, settings, {
        token: row.token,
        unsubscribed_kinds: row.unsubscribed_kinds,
        all_off: row.all_off,
      });
      if (verdict !== "send") {
        await skip(row.id, verdict.skip);
        continue;
      }
      if (!(NOTIFICATION_KINDS as readonly string[]).includes(row.kind)) {
        await skip(row.id, "unknown_kind");
        continue;
      }
      const transactional = isTransactional(row.kind);
      const locale = normaliseLocale(row.locale);
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const links = buildLinks({
        siteUrl,
        locale,
        token: row.token ?? "",
        kind: row.kind,
        projectId: payload.project_id,
        orderId: payload.order_id,
        ratingSecret: row.kind === "order_delivered" ? secret : null,
        transactional,
      });
      const mail = renderNotification(row.kind as NotificationKind, { locale, payload, links });
      const res = await sendEmailResult({
        to: [row.email!.trim()],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: {
          ...(links.unsubscribeUrl ? unsubscribeHeaders(links.unsubscribeUrl) : {}),
          "X-Entity-Ref-ID": row.id,
        },
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
  return { ok: true, summary };
}
