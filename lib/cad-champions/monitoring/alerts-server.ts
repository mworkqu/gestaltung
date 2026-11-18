// Monitoring alerts, SERVER ONLY (Prompt 12 Step F). Called from the
// cc-payments-expire cron route (same CRON_SECRET auth). Reads only
// cc_grading_logs and cc_task_results; if a table is missing (migration not
// run) or the email is not configured it reports that and does nothing.
//
// Recipient: CC_ALERT_EMAIL, else CC_PAYMENTS_ALERT_EMAIL, else OWNER_EMAIL.

import { OWNER_EMAIL, sendEmailResult } from "@/lib/email";
import { renderBrandedEmail } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import { alertIdempotencyKey, evaluateAlerts, GRADING_WINDOW_HOURS, type MonitoringCounts } from "./alerts";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/monitoring/alerts-server.ts is server-only");

export type MonitoringReport =
  | { status: "ok"; alerts: number; emailed: boolean }
  | { status: "skipped"; reason: "not_configured" | "not_set_up" | "read_failed" };

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

export function alertRecipient(env: Record<string, string | undefined> = process.env): string {
  return (env.CC_ALERT_EMAIL || env.CC_PAYMENTS_ALERT_EMAIL || OWNER_EMAIL).trim();
}

export async function runMonitoringAlerts(now: Date = new Date()): Promise<MonitoringReport> {
  try {
    const db = createServiceClient();
    if (!db) return { status: "skipped", reason: "not_configured" };

    const since = new Date(now.getTime() - GRADING_WINDOW_HOURS * 3600_000).toISOString();
    const logs = await db
      .from("cc_grading_logs")
      .select("id", { count: "exact", head: true })
      .not("error", "is", null)
      .gte("created_at", since);
    if (logs.error) return { status: "skipped", reason: MISSING.has(logs.error.code ?? "") ? "not_set_up" : "read_failed" };

    const queue = await db
      .from("cc_task_results")
      .select("created_at")
      .in("status", ["ai_pending_review", "error"])
      .order("created_at", { ascending: true })
      .limit(1000);
    if (queue.error) return { status: "skipped", reason: MISSING.has(queue.error.code ?? "") ? "not_set_up" : "read_failed" };

    const counts: MonitoringCounts = {
      gradingErrorsLastHour: logs.count ?? 0,
      openReviewCreatedAt: ((queue.data ?? []) as { created_at: string }[]).map((r) => r.created_at),
    };
    const alerts = evaluateAlerts(counts, now);
    if (alerts.length === 0) return { status: "ok", alerts: 0, emailed: false };

    const { html, text } = renderBrandedEmail({
      locale: "en",
      title: "CAD Champions needs attention",
      preheader: alerts[0].message,
      paragraphs: alerts.map((a) => a.message),
      footer: { help: false },
    });
    const sent = await sendEmailResult({
      to: [alertRecipient()],
      subject: "CAD Champions alert: " + alerts.map((a) => (a.kind === "grading_errors" ? "grading errors" : "review queue")).join(" + "),
      html,
      text,
      idempotencyKey: alertIdempotencyKey(alerts.map((a) => a.kind), now),
    });
    if (!sent.ok) console.error("[cc-monitor] alert email failed:", sent.error);
    return { status: "ok", alerts: alerts.length, emailed: sent.ok };
  } catch (e) {
    console.error("[cc-monitor] failed:", e instanceof Error ? e.message : "unknown");
    return { status: "skipped", reason: "read_failed" };
  }
}
