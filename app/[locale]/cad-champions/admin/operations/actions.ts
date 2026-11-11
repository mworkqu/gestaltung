"use server";

import { revalidatePath } from "next/cache";

import { startAnnouncement, previewRecipients, retryFailed, sendNextBatch, sendTest, type Progress } from "@/lib/cad-champions/admin/announcements-server";
import { adminGuard, type ActionResult } from "@/lib/cad-champions/admin/server";
import { parseStudentFilters } from "@/lib/cad-champions/admin/students";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Announcements actions. Admin only, checked on the server for every call.

export type DraftInput = { kind: string; subjectEn: string; subjectAr: string; bodyEn: string; bodyAr: string };
type Filters = Record<string, string>;

function refresh() {
  for (const l of CC_LOCALES) revalidatePath(ccPath(l, "/admin/operations"));
}

const kindOf = (k: unknown) => (k === "essential" ? "essential" : "marketing");

export async function countRecipientsAction(input: { filters: Filters; kind: string }): Promise<ActionResult<{ count: number; skipped: { noEmail: number; deletionRequested: number; noConsent: number } }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await previewRecipients(g.db, parseStudentFilters(input?.filters ?? {}), kindOf(input?.kind));
  if (!r.ok) return { ok: false, error: r.error === "invalid" ? "invalid" : r.error };
  return { ok: true, data: { count: r.count, skipped: r.skipped } };
}

export async function sendTestAnnouncementAction(draft: DraftInput): Promise<ActionResult<{ email: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const to = g.cc.user.email ?? null;
  const r = await sendTest(to, draft);
  if (!r.ok) return { ok: false, error: r.error === "not_found" ? "not_found" : r.error === "invalid" ? "invalid" : "error", detail: "detail" in r ? r.detail : undefined };
  return { ok: true, data: { email: to ?? "" } };
}

export async function startAnnouncementAction(input: { draft: DraftInput; filters: Filters }): Promise<ActionResult<{ id: string; recipients: number }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await startAnnouncement(g.db, g.cc.user.id, input?.draft ?? {}, parseStudentFilters(input?.filters ?? {}));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: { id: r.id, recipients: r.recipients } };
}

export async function sendBatchAction(id: string): Promise<ActionResult<Progress>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await sendNextBatch(g.db, String(id ?? ""));
  if (!r.ok) return { ok: false, error: r.error };
  if (r.progress.status !== "sending") refresh();
  return { ok: true, data: r.progress };
}

export async function retryFailedAction(id: string): Promise<ActionResult<{ retried: number }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await retryFailed(g.db, g.cc.user.id, String(id ?? ""));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: { retried: r.retried } };
}
