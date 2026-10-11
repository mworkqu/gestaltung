// projects.studio persistence (migration 0068). Server-only; every read and
// write goes through the caller's RLS client.
//
// Optimistic concurrency: a save is `update … set studio = doc,
// studio_version = version + 1 where id = ? and studio_version = version`.
// No row updated → somebody saved first → conflict with the current doc.
// Before 0068 runs the columns do not exist: loads report available=false and
// saves answer run_0068, so the Studio keeps working in memory.

import type { SupabaseClient } from "@supabase/supabase-js";

import { StudioDocSchema, parseStudioDoc, type ProductDoc, type StudioDoc } from "../schema";
import { mergeServerOwned, serverOwnedOf, type ProductPrivate, type ServerOwned } from "../product/private";

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

/**
 * The server-owned keys (P5-16 `product` + `productPrivate`) stored at `version`.
 * "conflict" when somebody saved since — the caller answers as for a lost update.
 */
async function storedServerOwned(
  supabase: SupabaseClient,
  projectId: string,
  version: number,
): Promise<{ ok: true; owned: ServerOwned } | { ok: false; error: "conflict" | "run_0068" | "not_found" | "failed" }> {
  const { data, error } = await supabase
    .from("projects")
    .select("studio_version, product:studio->product, productPrivate:studio->productPrivate")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    if (isMissingStudioColumn(error)) return { ok: false, error: "run_0068" };
    console.error("[studio] read before save failed:", error.message);
    return { ok: false, error: "failed" };
  }
  if (!data) return { ok: false, error: "not_found" };
  const row = data as { studio_version: number | null; product?: unknown; productPrivate?: unknown };
  if ((Number(row.studio_version) || 0) !== version) return { ok: false, error: "conflict" };
  return { ok: true, owned: serverOwnedOf({ product: row.product, productPrivate: row.productPrivate }) };
}

/**
 * Save a doc at `version`. The server-owned keys (product designs + the private
 * models) are never taken from `doc`: without `owned` the stored ones are kept
 * (page saves, other Studio routes); the product routes pass `owned` to change them.
 */
export async function saveDoc(
  supabase: SupabaseClient,
  projectId: string,
  doc: unknown,
  version: number,
  owned?: ServerOwned,
): Promise<SaveResult> {
  const parsed = StudioDocSchema.safeParse(doc);
  if (!parsed.success)
    return { ok: false, error: "invalid", issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) };
  if (docBytes(parsed.data) > DOC_MAX_BYTES) return { ok: false, error: "too_large" };

  let keep = owned;
  if (!keep) {
    const stored = await storedServerOwned(supabase, projectId, version);
    if (!stored.ok) {
      if (stored.error !== "conflict") return { ok: false, error: stored.error };
      const current = await loadDoc(supabase, projectId);
      if (!current.ok) return { ok: false, error: current.error };
      return { ok: false, error: "conflict", doc: current.doc, version: current.version };
    }
    keep = stored.owned;
  }
  const studio = mergeServerOwned(parsed.data, keep);

  const { data, error } = await supabase
    .from("projects")
    .update({ studio, studio_version: version + 1 })
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

// ---------------------------------------------------------------------------
// P5-16 product routes only: the private models. NEVER return `owned` (or the
// raw studio value) in a response — use the page-safe `doc`.
// ---------------------------------------------------------------------------

export type PrivateLoad =
  | { ok: true; available: boolean; doc: StudioDoc | null; owned: ServerOwned; version: number }
  | { ok: false; error: "not_found" | "failed" };

export async function loadDocPrivate(supabase: SupabaseClient, projectId: string): Promise<PrivateLoad> {
  const { data, error } = await supabase.from("projects").select("id, studio, studio_version").eq("id", projectId).maybeSingle();
  if (error) {
    if (isMissingStudioColumn(error)) return { ok: true, available: false, doc: null, owned: { product: null, productPrivate: null }, version: 0 };
    console.error("[studio] private load failed:", error.message);
    return { ok: false, error: "failed" };
  }
  if (!data) return { ok: false, error: "not_found" };
  const row = data as { studio: unknown; studio_version: number | null };
  return { ok: true, available: true, doc: parseStudioDoc(row.studio), owned: serverOwnedOf(row.studio), version: Number(row.studio_version) || 0 };
}

export type ProductState = { doc: StudioDoc; product: ProductDoc; priv: ProductPrivate };

/**
 * Load → apply → save for the product routes; one retry on a conflict. `apply`
 * gets the page doc and the current product + private data (empty when none)
 * and returns the new ones, or null for "nothing to save".
 */
export async function updateProductDoc(
  supabase: SupabaseClient,
  projectId: string,
  apply: (s: ProductState) => ProductState | null,
): Promise<{ saved: boolean; version: number | null; state: ProductState | null; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await loadDocPrivate(supabase, projectId);
    if (!cur.ok) return { saved: false, version: null, state: null, error: cur.error };
    if (!cur.available || !cur.doc) return { saved: false, version: null, state: null, error: cur.available ? "no_doc" : "run_0068" };
    const next = apply({
      doc: cur.doc,
      product: cur.owned.product ?? { designs: [], chosenId: null, unlockedId: null, specHash: "" },
      priv: cur.owned.productPrivate ?? { designs: [] },
    });
    if (!next) return { saved: false, version: cur.version, state: null };
    const r = await saveDoc(supabase, projectId, next.doc, cur.version, { product: next.product, productPrivate: next.priv });
    if (r.ok) return { saved: true, version: r.version, state: next };
    if (r.error !== "conflict") {
      console.warn(`[studio] product doc not saved: ${r.error}`);
      return { saved: false, version: null, state: null, error: r.error };
    }
  }
  return { saved: false, version: null, state: null, error: "conflict" };
}
