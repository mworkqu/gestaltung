// Monitoring alerts, SERVER ONLY (Prompt 12 Step F). Called from the
// cc-payments-expire cron route (same CRON_SECRET auth). Reads only
// cc_grading_logs, cc_task_results and — for the names in the email —
// cc_profiles and cc_test_tasks; if a table is missing (migration not run) or
// the email is not configured it reports that and does nothing.
//
// Recipient: CC_ALERT_EMAIL, else CC_PAYMENTS_ALERT_EMAIL, else OWNER_EMAIL.
//
// One email PER ALERT (2026-11), each with its own idempotency key from
// lib/cad-champions/monitoring/alerts.ts: the hourly cron no longer mails the
// same unattended review item every hour. The stale-review email names the
// student and the task and links straight to the review screen.

import { OWNER_EMAIL, sendEmailResult } from "@/lib/email";
import { defaultSiteUrl, renderBrandedEmail } from "@/lib/email/brand-layout";
import { createServiceClient } from "@/lib/supabase/service";

import {
  alertSubject,
  evaluateAlerts,
  GRADING_WINDOW_HOURS,
  MAX_LISTED_ITEMS,
  reviewItemUrl,
  reviewQueueUrl,
  STALE_REVIEW_HOURS,
  type MonitoringAlert,
  type MonitoringCounts,
  type ReviewQueueItem,
} from "./alerts";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/monitoring/alerts-server.ts is server-only");

export type MonitoringReport =
  | { status: "ok"; alerts: number; emailed: boolean }
  | { status: "skipped"; reason: "not_configured" | "not_set_up" | "read_failed" };

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
/** Open review rows read per run (the queue page reads 500). */
const QUEUE_LIMIT = 1000;
/** Error texts sampled for the de-dupe fingerprint (the count is exact anyway). */
const ERROR_SAMPLE = 50;

export function alertRecipient(env: Record<string, string | undefined> = process.env): string {
  return (env.CC_ALERT_EMAIL || env.CC_PAYMENTS_ALERT_EMAIL || OWNER_EMAIL).trim();
}

/** One error text reduced to what makes it the SAME failure: no ids, no numbers. */
function errorSignature(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

type QueueRead = { id: string; created_at: string; user_id: string | null; task_id: string | null };

/** Student and task titles for the stale rows only (the email names them). */
async function nameStaleItems(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  rows: QueueRead[]
): Promise<Map<string, { studentName: string | null; taskTitle: string | null }>> {
  const out = new Map<string, { studentName: string | null; taskTitle: string | null }>();
  if (rows.length === 0) return out;
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x))];
  const [profiles, tasks] = await Promise.all([
    userIds.length ? db.from("cc_profiles").select("id,full_name,email").in("id", userIds) : Promise.resolve({ data: [] as unknown[] }),
    taskIds.length ? db.from("cc_test_tasks").select("id,title_en").in("id", taskIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const byUser = new Map(
    ((profiles.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, (p.full_name || p.email || "").trim() || null])
  );
  const byTask = new Map(((tasks.data ?? []) as { id: string; title_en: string | null }[]).map((t) => [t.id, (t.title_en || "").trim() || null]));
  for (const r of rows) {
    out.set(r.id, {
      studentName: (r.user_id && byUser.get(r.user_id)) || null,
      taskTitle: (r.task_id && byTask.get(r.task_id)) || null,
    });
  }
  return out;
}

/** The email for one alert: paragraphs, named items with their links, one button. */
function alertEmail(alert: MonitoringAlert, siteUrl: string): { html: string; text: string } {
  const listed = (alert.items ?? []).slice(0, MAX_LISTED_ITEMS);
  const extra = (alert.items?.length ?? 0) - listed.length;
  return renderBrandedEmail({
    locale: "en",
    title: "CAD Champions needs attention",
    preheader: alert.message,
    paragraphs: [alert.message, ...(extra > 0 ? [`And ${extra} more item${extra === 1 ? "" : "s"} in the queue.`] : [])],
    facts: listed.map((item) => ({
      label: item.studentName || "Unknown student",
      value: [item.taskTitle || "Submission", `waiting ${item.waitingHours} h`].join(" — "),
      action: { label: "Open review", url: reviewItemUrl(siteUrl, item.id) },
    })),
    ...(alert.kind === "stale_review"
      ? { buttons: [{ label: "Open the review queue", url: reviewQueueUrl(siteUrl) }] }
      : {}),
    footer: { help: false },
  });
}

export async function runMonitoringAlerts(now: Date = new Date()): Promise<MonitoringReport> {
  try {
    const db = createServiceClient();
    if (!db) return { status: "skipped", reason: "not_configured" };

    const since = new Date(now.getTime() - GRADING_WINDOW_HOURS * 3600_000).toISOString();
    // Count AND a sample of the error texts: the count is what the threshold
    // compares, the texts are the per-day de-dupe fingerprint.
    const logs = await db
      .from("cc_grading_logs")
      .select("error", { count: "exact" })
      .not("error", "is", null)
      .gte("created_at", since)
      .limit(ERROR_SAMPLE);
    if (logs.error) return { status: "skipped", reason: MISSING.has(logs.error.code ?? "") ? "not_set_up" : "read_failed" };

    const queue = await db
      .from("cc_task_results")
      .select("id,created_at,user_id,task_id")
      .in("status", ["ai_pending_review", "error"])
      .order("created_at", { ascending: true })
      .limit(QUEUE_LIMIT);
    if (queue.error) return { status: "skipped", reason: MISSING.has(queue.error.code ?? "") ? "not_set_up" : "read_failed" };

    const rows = (queue.data ?? []) as QueueRead[];
    // Name only the rows that are actually stale (the email lists those).
    const cutoff = now.getTime() - STALE_REVIEW_HOURS * 3600_000;
    const staleRows = rows.filter((r) => {
      const t = Date.parse(r.created_at);
      return Number.isFinite(t) && t < cutoff;
    });
    const named = await nameStaleItems(db, staleRows);
    const openReviewItems: ReviewQueueItem[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      ...(named.get(r.id) ?? {}),
    }));

    const counts: MonitoringCounts = {
      gradingErrorsLastHour: logs.count ?? 0,
      gradingErrorSignatures: ((logs.data ?? []) as { error: string | null }[]).map((r) => errorSignature(r.error)),
      openReviewItems,
    };
    const alerts = evaluateAlerts(counts, now);
    if (alerts.length === 0) return { status: "ok", alerts: 0, emailed: false };

    const siteUrl = defaultSiteUrl();
    const to = [alertRecipient()];
    let emailed = false;
    // One email per alert, each keyed on its own subject matter: a repeat of
    // the same alert inside the same digest day is dropped by Resend.
    for (const alert of alerts) {
      const { html, text } = alertEmail(alert, siteUrl);
      const sent = await sendEmailResult({ to, subject: alertSubject(alert), html, text, idempotencyKey: alert.idempotencyKey });
      if (sent.ok) emailed = true;
      else console.error(`[cc-monitor] ${alert.kind} alert email failed:`, sent.error);
    }
    return { status: "ok", alerts: alerts.length, emailed };
  } catch (e) {
    console.error("[cc-monitor] failed:", e instanceof Error ? e.message : "unknown");
    return { status: "skipped", reason: "read_failed" };
  }
}
