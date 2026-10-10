// projects.studio persistence (migration 0068). Server-only; every read and
// write goes through the caller's RLS client.
//
// Optimistic concurrency: a save is `update … set studio = doc,
// studio_version = version + 1 where id = ? and studio_version = version`.
// No row updated → somebody saved first → conflict with the current doc.
// Before 0068 runs the columns do not exist: loads report available=false and
// saves answer run_0068, so the Studio keeps working in memory.

import type { SupabaseClient } from "@supabase/supabase-js";

import { StudioDocSchema, parseStudioDoc, type StudioDoc } from "../schema";

export const DOC_MAX_BYTES = 256 * 1024;

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

/** The studio / studio_version column does not exist (0068 not run). */
export function isMissingStudioColumn(e: PgError): boolean {
  if (!e) return false;
  const text = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return (e.code === "42703" || e.code === "PGRST204" || /column/.test(text)) && text.includes("studio");
}

export const docBytes = (doc: unknown) => Buffer.byteLength(JSON.stringify(doc ?? null), "utf8");

export type LoadResult =
  | { ok: true; available: boolean; doc: StudioDoc | null; version: number }
  | { ok: false; error: "not_found" | "failed" };

export async function loadDoc(supabase: SupabaseClient, projectId: string): Promise<LoadResult> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, studio, studio_version")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    if (isMissingStudioColumn(error)) {
      const { data: row, error: e2 } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
      if (e2) return { ok: false, error: "failed" };
      return row ? { ok: true, available: false, doc: null, version: 0 } : { ok: false, error: "not_found" };
    }
    console.error("[studio] load failed:", error.message);
    return { ok: false, error: "failed" };
  }
  if (!data) return { ok: false, error: "not_found" };
  const row = data as { studio: unknown; studio_version: number | null };
  return { ok: true, available: true, doc: parseStudioDoc(row.studio), version: Number(row.studio_version) || 0 };
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; error: "conflict"; doc: StudioDoc | null; version: number }
  | { ok: false; error: "run_0068" | "invalid" | "too_large" | "not_found" | "failed"; issues?: string[] };

export async function saveDoc(supabase: SupabaseClient, projectId: string, doc: unknown, version: number): Promise<SaveResult> {
  const parsed = StudioDocSchema.safeParse(doc);
  if (!parsed.success)
    return { ok: false, error: "invalid", issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) };
  if (docBytes(parsed.data) > DOC_MAX_BYTES) return { ok: false, error: "too_large" };

  const { data, error } = await supabase
    .from("projects")
    .update({ studio: parsed.data, studio_version: version + 1 })
    .eq("id", projectId)
    .eq("studio_version", version)
    .select("studio_version");
  if (error) {
    if (isMissingStudioColumn(error)) return { ok: false, error: "run_0068" };
    console.error("[studio] save failed:", error.message);
    return { ok: false, error: "failed" };
  }
  if (Array.isArray(data) && data.length > 0) return { ok: true, version: version + 1 };

  const current = await loadDoc(supabase, projectId);
  if (!current.ok) return { ok: false, error: current.error };
  return { ok: false, error: "conflict", doc: current.doc, version: current.version };
}

/**
 * Server-side update used by pick / wiring / enclosure / mech: load, apply,
 * save; one retry on a conflict. Best-effort — the caller still returns its
 * result when this fails (e.g. before 0068).
 */
export async function updateDoc(
  supabase: SupabaseClient,
  projectId: string,
  apply: (doc: StudioDoc | null) => StudioDoc | null,
): Promise<{ saved: boolean; version: number | null; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await loadDoc(supabase, projectId);
    if (!cur.ok) return { saved: false, version: null, error: cur.error };
    if (!cur.available) return { saved: false, version: null, error: "run_0068" };
    const next = apply(cur.doc);
    if (!next) return { saved: false, version: cur.version };
    const r = await saveDoc(supabase, projectId, next, cur.version);
    if (r.ok) return { saved: true, version: r.version };
    if (r.error !== "conflict") {
      console.warn(`[studio] doc not saved: ${r.error}`);
      return { saved: false, version: null, error: r.error };
    }
  }
  return { saved: false, version: null, error: "conflict" };
}
