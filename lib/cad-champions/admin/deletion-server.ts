// Account deletion requests — SERVER ONLY (service role). The CALLER (a server
// action) has already passed adminGuard("admin").
//
//   approveDeletion: rpc cc_anonymise_profile (0085: blanks personal data,
//     approves the request, writes the audit row), then deletes the student's
//     files in cc-submissions and cc-payment-proofs ({user_id}/...). Anonymised
//     scores are kept for statistics. The auth user is NOT deleted (gap).
//   cleanFiles: re-runs only the file deletion (after a partial failure).
//   rejectDeletion: status rejected + processed_by/at + note, audit row, and the
//     profile flag deletion_requested_at is cleared.

import type { CcDeletionRequest } from "../db/types";
import { DELETION_BUCKETS, cleanNote, collectStoragePaths, isUuid, removeChunks, type DeletionBucket, type StorageLister } from "./deletion";
import { isMissingSchema, writeAudit, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/deletion-server.ts is server-only");

export interface DeletionView {
  id: string;
  userId: string;
  status: CcDeletionRequest["status"];
  reason: string | null;
  adminNote: string | null;
  createdAt: string;
  processedAt: string | null;
  name: string | null;
  email: string | null;
}

export async function loadDeletionRequests(db: AdminDb): Promise<{ ok: true; rows: DeletionView[] } | { ok: false; reason: "not_set_up" | "error" }> {
  const { data, error } = await db.from("cc_deletion_requests").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  const list = (data ?? []) as CcDeletionRequest[];
  const ids = [...new Set(list.map((r) => r.user_id))];
  const profiles = new Map<string, { name: string | null; email: string | null }>();
  if (ids.length > 0) {
    const { data: ps } = await db.from("cc_profiles").select("id,full_name,email").in("id", ids);
    for (const p of (ps ?? []) as { id: string; full_name: string | null; email: string | null }[]) profiles.set(p.id, { name: p.full_name, email: p.email });
  }
  return {
    ok: true,
    rows: list.map((r) => ({
      id: r.id,
      userId: r.user_id,
      status: r.status,
      reason: r.reason,
      adminNote: r.admin_note,
      createdAt: r.created_at,
      processedAt: r.processed_at,
      name: profiles.get(r.user_id)?.name ?? null,
      email: profiles.get(r.user_id)?.email ?? null,
    })),
  };
}

export type FilesResult = { deleted: number; incomplete: boolean; failed: number };

/** Deletes every stored file of one student in both buckets (list + remove, paged). */
export async function deleteStudentFiles(db: AdminDb, userId: string): Promise<FilesResult> {
  const res: FilesResult = { deleted: 0, incomplete: false, failed: 0 };
  if (!isUuid(userId)) return { deleted: 0, incomplete: true, failed: 0 };
  for (const bucket of DELETION_BUCKETS) {
    const api = db.storage.from(bucket as DeletionBucket);
    const lister: StorageLister = async (prefix, offset, limit) => {
      const { data, error } = await api.list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) {
        console.error("[cc-admin] storage list failed:", bucket, error.message);
        return null;
      }
      return (data ?? []).map((e) => ({ name: e.name, id: e.id ?? null }));
    };
    const found = await collectStoragePaths(lister, userId);
    if (found.incomplete) res.incomplete = true;
    for (const part of removeChunks(found.paths, 100)) {
      const { data, error } = await api.remove(part);
      if (error) {
        console.error("[cc-admin] storage remove failed:", bucket, error.message);
        res.failed += part.length;
        res.incomplete = true;
      } else res.deleted += (data ?? []).length;
    }
  }
  return res;
}

type Fail = { ok: false; error: "invalid" | "not_set_up" | "not_found" | "conflict" | "error" };

async function readRequest(db: AdminDb, id: string): Promise<{ req: CcDeletionRequest } | Fail> {
  if (!isUuid(id)) return { ok: false, error: "invalid" };
  const { data, error } = await db.from("cc_deletion_requests").select("*").eq("id", id).maybeSingle<CcDeletionRequest>();
  if (error) return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  if (!data) return { ok: false, error: "not_found" };
  return { req: data };
}

export async function approveDeletion(db: AdminDb, actorId: string, requestId: string, note: unknown): Promise<{ ok: true; files: FilesResult } | Fail> {
  const r = await readRequest(db, requestId);
  if (!("req" in r)) return r;
  if (r.req.status !== "pending") return { ok: false, error: "conflict" };
  const { data, error } = await db.rpc("cc_anonymise_profile", { p_user: r.req.user_id, p_actor: actorId, p_note: cleanNote(note) });
  if (error) {
    console.error("[cc-admin] anonymise failed:", error.code ?? error.message);
    return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!out.ok) return { ok: false, error: out.reason === "not_found" ? "not_found" : "error" };
  const files = await deleteStudentFiles(db, r.req.user_id);
  await writeAudit(db, actorId, "account.files_deleted", "cc_profiles", r.req.user_id, null, { request_id: r.req.id, ...files });
  return { ok: true, files };
}

/** Retry the file deletion for an already approved request. */
export async function cleanFiles(db: AdminDb, actorId: string, requestId: string): Promise<{ ok: true; files: FilesResult } | Fail> {
  const r = await readRequest(db, requestId);
  if (!("req" in r)) return r;
  if (r.req.status !== "approved") return { ok: false, error: "conflict" };
  const files = await deleteStudentFiles(db, r.req.user_id);
  await writeAudit(db, actorId, "account.files_deleted", "cc_profiles", r.req.user_id, null, { request_id: r.req.id, retry: true, ...files });
  return { ok: true, files };
}

export async function rejectDeletion(db: AdminDb, actorId: string, requestId: string, note: unknown): Promise<{ ok: true } | Fail> {
  const clean = cleanNote(note);
  if (!clean) return { ok: false, error: "invalid" };
  const r = await readRequest(db, requestId);
  if (!("req" in r)) return r;
  if (r.req.status !== "pending") return { ok: false, error: "conflict" };
  const { data, error } = await db
    .from("cc_deletion_requests")
    .update({ status: "rejected", admin_note: clean, processed_by: actorId, processed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: "error" };
  if (!data || data.length === 0) return { ok: false, error: "conflict" };
  await db.from("cc_profiles").update({ deletion_requested_at: null }).eq("id", r.req.user_id);
  await writeAudit(db, actorId, "account.deletion_reject", "cc_deletion_requests", requestId, { status: "pending" }, { status: "rejected", note: clean });
  return { ok: true };
}
