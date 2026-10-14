"use server";

import { revalidatePath } from "next/cache";

import { approveDeletion, cleanFiles, rejectDeletion, type FilesResult } from "@/lib/cad-champions/admin/deletion-server";
import { adminGuard, type ActionResult } from "@/lib/cad-champions/admin/server";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Account deletion actions. Admin only, checked on the server for every call.
// The auth user is NOT deleted (documented gap).

function refresh() {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/operations/deletions"));
    revalidatePath(ccPath(l, "/admin"));
  }
}

export async function approveDeletionAction(input: { id: string; note?: string }): Promise<ActionResult<FilesResult>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await approveDeletion(g.db, g.cc.user.id, String(input?.id ?? ""), input?.note);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: r.files };
}

export async function rejectDeletionAction(input: { id: string; note: string }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await rejectDeletion(g.db, g.cc.user.id, String(input?.id ?? ""), input?.note);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true };
}

export async function cleanFilesAction(input: { id: string }): Promise<ActionResult<FilesResult>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await cleanFiles(g.db, g.cc.user.id, String(input?.id ?? ""));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: r.files };
}
