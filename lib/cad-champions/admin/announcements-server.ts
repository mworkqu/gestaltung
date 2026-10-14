// Admin announcements — SERVER ONLY (service role). The CALLER (a server
// action) has already passed adminGuard("admin"). Flow:
//   1. startAnnouncement: validate, pick the recipients, insert cc_announcements
//      (status sending) + one cc_announcement_deliveries row per recipient
//      (status pending; the primary key makes a re-run safe).
//   2. sendNextBatch: BATCH_SIZE pending deliveries per call. Each is re-checked
//      (consent / deletion request / email) at send time, sent with an
//      idempotency key and marked sent / failed / skipped. Counts and status
//      are recomputed from the delivery rows after every batch.
//   3. retryFailed: failed -> pending again.

import { sendEmailResult } from "@/lib/email";

import type { CcAnnouncement, CcAnnouncementKind } from "../db/types";
import {
  BATCH_SIZE,
  chunk,
  deliveryKey,
  hasEmail,
  nextStatus,
  renderAnnouncementEmail,
  selectRecipients,
  validateAnnouncement,
  type AnnouncementDraft,
  type AnnouncementError,
  type RecipientSelection,
} from "./announcements";
import { isMissingSchema, writeAudit, type AdminDb } from "./server";
import { studentFilterParams, type StudentFilters } from "./students";
import { loadStudentRows } from "./students-server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/announcements-server.ts is server-only");

export type Fail = { ok: false; error: "invalid" | "not_set_up" | "not_found" | "conflict" | "error"; details?: AnnouncementError[] };

export interface Progress {
  id: string;
  status: CcAnnouncement["status"];
  recipients: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Error text of the last failed delivery in this batch, if any (e.g. no_resend_key). */
  lastError: string | null;
}

export async function previewRecipients(
  db: AdminDb,
  filters: StudentFilters,
  kind: CcAnnouncementKind,
): Promise<{ ok: true; count: number; skipped: RecipientSelection["skipped"] } | Fail> {
  const load = await loadStudentRows(db);
  if (!load.ok) return { ok: false, error: load.reason === "not_set_up" ? "not_set_up" : "error" };
  const sel = selectRecipients(load.rows, filters, kind, Date.now());
  return { ok: true, count: sel.recipients.length, skipped: sel.skipped };
}

export async function startAnnouncement(
  db: AdminDb,
  actorId: string,
  input: Partial<Record<keyof AnnouncementDraft, unknown>>,
  filters: StudentFilters,
): Promise<{ ok: true; id: string; recipients: number } | Fail> {
  const v = validateAnnouncement(input);
  if (!v.ok) return { ok: false, error: "invalid", details: v.errors };
  const load = await loadStudentRows(db);
  if (!load.ok) return { ok: false, error: load.reason === "not_set_up" ? "not_set_up" : "error" };
  const sel = selectRecipients(load.rows, filters, v.value.kind, Date.now());
  if (sel.recipients.length === 0) return { ok: false, error: "not_found" };

  const { data, error } = await db
    .from("cc_announcements")
    .insert({
      kind: v.value.kind,
      subject_en: v.value.subjectEn,
      subject_ar: v.value.subjectAr,
      body_en: v.value.bodyEn,
      body_ar: v.value.bodyAr,
      filters: studentFilterParams(filters),
      status: "sending",
      recipient_count: sel.recipients.length,
      created_by: actorId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("[cc-admin] announcement insert failed:", error?.code ?? error?.message);
    return { ok: false, error: isMissingSchema(error?.code) ? "not_set_up" : "error" };
  }

  for (const part of chunk(sel.recipients, 500)) {
    const { error: e2 } = await db
      .from("cc_announcement_deliveries")
      .upsert(part.map((r) => ({ announcement_id: data.id, user_id: r.id, status: "pending" })), { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
    if (e2) {
      console.error("[cc-admin] delivery insert failed:", e2.code ?? e2.message);
      await db.from("cc_announcements").update({ status: "failed" }).eq("id", data.id);
      return { ok: false, error: "error" };
    }
  }
  await writeAudit(db, actorId, "announcement.start", "cc_announcements", data.id, null, {
    kind: v.value.kind,
    recipients: sel.recipients.length,
    filters: studentFilterParams(filters),
    skipped: sel.skipped,
  });
  return { ok: true, id: data.id, recipients: sel.recipients.length };
}

async function counts(db: AdminDb, id: string): Promise<{ pending: number; sent: number; failed: number; skipped: number } | null> {
  const one = async (status: string) => {
    const { count, error } = await db.from("cc_announcement_deliveries").select("user_id", { count: "exact", head: true }).eq("announcement_id", id).eq("status", status);
    return error ? null : (count ?? 0);
  };
  const [pending, sent, failed, skipped] = await Promise.all([one("pending"), one("sent"), one("failed"), one("skipped")]);
  if (pending == null || sent == null || failed == null || skipped == null) return null;
  return { pending, sent, failed, skipped };
}

type ProfileLite = { id: string; email: string | null; preferred_locale: string; marketing_consent: boolean; deletion_requested_at: string | null };

export async function sendNextBatch(db: AdminDb, announcementId: string, size: number = BATCH_SIZE): Promise<{ ok: true; progress: Progress } | Fail> {
  const { data: a, error } = await db.from("cc_announcements").select("*").eq("id", announcementId).maybeSingle<CcAnnouncement>();
  if (error) return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  if (!a) return { ok: false, error: "not_found" };
  if (a.status === "draft") return { ok: false, error: "conflict" };

  const draft: AnnouncementDraft = { kind: a.kind, subjectEn: a.subject_en, subjectAr: a.subject_ar, bodyEn: a.body_en, bodyAr: a.body_ar };
  const mail = renderAnnouncementEmail(draft);

  const { data: pend, error: pe } = await db
    .from("cc_announcement_deliveries")
    .select("user_id")
    .eq("announcement_id", announcementId)
    .eq("status", "pending")
    .order("created_at")
    .order("user_id")
    .limit(Math.max(1, Math.min(size, 100)));
  if (pe) return { ok: false, error: "error" };
  const ids = ((pend ?? []) as { user_id: string }[]).map((p) => p.user_id);

  let lastError: string | null = null;
  if (ids.length > 0) {
    const { data: profs, error: ppe } = await db.from("cc_profiles").select("id,email,preferred_locale,marketing_consent,deletion_requested_at").in("id", ids);
    if (ppe) return { ok: false, error: "error" };
    const byId = new Map(((profs ?? []) as ProfileLite[]).map((p) => [p.id, p]));
    for (const uid of ids) {
      const p = byId.get(uid);
      const now = new Date().toISOString();
      let update: { status: "sent" | "failed" | "skipped"; error: string | null; sent_at: string | null };
      if (!p || p.deletion_requested_at || !hasEmail({ email: p.email }) || (a.kind === "marketing" && !p.marketing_consent)) {
        update = { status: "skipped", error: null, sent_at: null };
      } else {
        const res = await sendEmailResult({ to: [p.email!.trim()], subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: deliveryKey(announcementId, uid) });
        if (res.ok) update = { status: "sent", error: null, sent_at: now };
        else {
          lastError = (res.error ?? "error").slice(0, 300);
          update = { status: "failed", error: lastError, sent_at: null };
        }
      }
      const { error: ue } = await db.from("cc_announcement_deliveries").update(update).eq("announcement_id", announcementId).eq("user_id", uid).eq("status", "pending");
      if (ue) console.error("[cc-admin] delivery update failed:", ue.code ?? ue.message);
    }
  }

  const c = await counts(db, announcementId);
  if (!c) return { ok: false, error: "error" };
  const status = nextStatus(c);
  const patch: Record<string, unknown> = { status, sent_count: c.sent, failed_count: c.failed };
  if (status !== "sending") patch.sent_at = new Date().toISOString();
  const { error: ae } = await db.from("cc_announcements").update(patch).eq("id", announcementId);
  if (ae) console.error("[cc-admin] announcement update failed:", ae.code ?? ae.message);
  return { ok: true, progress: { id: announcementId, status, recipients: a.recipient_count, ...c, lastError } };
}

/** failed -> pending again, announcement back to sending. */
export async function retryFailed(db: AdminDb, actorId: string, announcementId: string): Promise<{ ok: true; retried: number } | Fail> {
  const { data, error } = await db.from("cc_announcement_deliveries").update({ status: "pending", error: null }).eq("announcement_id", announcementId).eq("status", "failed").select("user_id");
  if (error) return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  const n = (data ?? []).length;
  if (n > 0) {
    await db.from("cc_announcements").update({ status: "sending" }).eq("id", announcementId);
    await writeAudit(db, actorId, "announcement.retry", "cc_announcements", announcementId, null, { retried: n });
  }
  return { ok: true, retried: n };
}

/** One test email to the admin's own address; never touches the delivery log. */
export async function sendTest(to: string | null | undefined, input: Partial<Record<keyof AnnouncementDraft, unknown>>): Promise<{ ok: true } | Fail | { ok: false; error: "error"; detail: string }> {
  const v = validateAnnouncement(input);
  if (!v.ok) return { ok: false, error: "invalid", details: v.errors };
  if (!to) return { ok: false, error: "not_found" };
  const mail = renderAnnouncementEmail(v.value, { testPrefix: true });
  const res = await sendEmailResult({ to: [to], subject: mail.subject, html: mail.html, text: mail.text });
  if (!res.ok) {
    console.error("[cc-admin] test announcement failed:", res.error);
    return { ok: false, error: "error", detail: (res.error ?? "error").slice(0, 120) };
  }
  return { ok: true };
}

export interface AnnouncementRow {
  id: string;
  kind: CcAnnouncementKind;
  subjectEn: string;
  subjectAr: string;
  status: CcAnnouncement["status"];
  recipients: number;
  sent: number;
  failed: number;
  pending: number;
  createdAt: string;
  sentAt: string | null;
}

export async function loadAnnouncements(db: AdminDb, limit = 30): Promise<{ ok: true; rows: AnnouncementRow[] } | { ok: false; reason: "not_set_up" | "error" }> {
  const { data, error } = await db.from("cc_announcements").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  const list = (data ?? []) as CcAnnouncement[];
  const rows: AnnouncementRow[] = [];
  for (const a of list) {
    // pending is cheap to derive: recipients minus everything that has an outcome
    rows.push({
      id: a.id,
      kind: a.kind,
      subjectEn: a.subject_en,
      subjectAr: a.subject_ar,
      status: a.status,
      recipients: a.recipient_count,
      sent: a.sent_count,
      failed: a.failed_count,
      pending: 0,
      createdAt: a.created_at,
      sentAt: a.sent_at,
    });
  }
  // pending per announcement still sending (one small count each, at most a handful)
  await Promise.all(
    rows
      .filter((r) => r.status === "sending")
      .map(async (r) => {
        const c = await counts(db, r.id);
        if (c) r.pending = c.pending;
      }),
  );
  return { ok: true, rows };
}
