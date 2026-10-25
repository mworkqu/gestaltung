// projects.studio persistence (migration 0068). Server-only. Page-doc reads and
// writes go through the caller's RLS client; the P5-16 server-owned product
// data (studio.product changes + the private models) is written with the
// service client after an ownership read under RLS (0100, audit DB-01).
//
// Optimistic concurrency: a save is `update … set studio = doc,
// studio_version = version + 1 where id = ? and studio_version = version`.
// No row updated → somebody saved first → conflict with the current doc.
// Before 0068 runs the columns do not exist: loads report available=false and
// saves answer run_0068, so the Studio keeps working in memory.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { StudioDocSchema, parseStudioDoc, type ProductDoc, type StudioDoc } from "../schema";
import {
  mergeServerOwned,
  parseProductDoc,
  parseProductPrivate,
  serverOwnedOf,
  trimPrivate,
  type ProductPrivate,
  type ServerOwned,
} from "../product/private";
import { isSuperAdmin } from "./product";
import { isMissingColumn, isMissingFunction, isMissingRelation } from "@/lib/supabase/errors";

export const DOC_MAX_BYTES = 256 * 1024;

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

/** The studio / studio_version column does not exist (0068 not run). */
export function isMissingStudioColumn(e: PgError): boolean {
  if (!e) return false;
  const text = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return (isMissingColumn(e) || e.code === "PGRST204" || /column/.test(text)) && text.includes("studio");
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
 * Save a doc at `version` (page saves, other Studio routes; caller's RLS
 * client). The server-owned keys (product designs + the private models) are
 * never taken from `doc`: the stored ones are kept. Since 0100 the database
 * enforces the same for every anon/authenticated write (trigger
 * projects_guard_studio_server_keys); the product routes change them through
 * updateProductDoc (service client).
 */
export async function saveDoc(
  supabase: SupabaseClient,
  projectId: string,
  doc: unknown,
  version: number,
): Promise<SaveResult> {
  const parsed = StudioDocSchema.safeParse(doc);
  if (!parsed.success)
    return { ok: false, error: "invalid", issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) };
  if (docBytes(parsed.data) > DOC_MAX_BYTES) return { ok: false, error: "too_large" };

  const stored = await storedServerOwned(supabase, projectId, version);
  if (!stored.ok) {
    if (stored.error !== "conflict") return { ok: false, error: stored.error };
    const current = await loadDoc(supabase, projectId);
    if (!current.ok) return { ok: false, error: current.error };
    return { ok: false, error: "conflict", doc: current.doc, version: current.version };
  }
  // Before 0100 this also writes the stored productPrivate back; after it the
  // key is gone from projects.studio (and the trigger would drop it anyway).
  const studio = mergeServerOwned(parsed.data, stored.owned);

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
//
// Since 0100 (audit DB-01) the models live in public.project_studio_private
// (service_role only) and a trigger stops anon/authenticated writes from
// changing studio.product, so both are read / written with the service client
// — always AFTER the project was read with the caller's RLS client (that read
// is the ownership check: owner, super_admin, or a class teacher for reads).
// Before 0100 runs (table / function missing) the old storage is used:
// studio.productPrivate, written with the same service client.
// ---------------------------------------------------------------------------

type ServiceClient = SupabaseClient;

/**
 * 0100 not run: project_studio_private / studio_product_save do not exist.
 * Only the explicit "missing relation / function" codes naming that object —
 * never a generic error — so a failure after 0100 can't fall back to storing
 * the models in projects.studio.
 */
function isMissing0100(e: PgError, object: "project_studio_private" | "studio_product_save"): boolean {
  if (!e) return false;
  const codeMatches = object === "project_studio_private" ? isMissingRelation(e) : isMissingFunction(e);
  const text = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`;
  return codeMatches && text.includes(object);
}

export type PrivateLoad =
  | { ok: true; available: boolean; doc: StudioDoc | null; owned: ServerOwned; version: number; ownerId: string | null }
  | { ok: false; error: "not_found" | "failed" | "service_unavailable" };

/**
 * The private models of a project (service client); legacy studio.productPrivate
 * before 0100. Callers must have read the project under RLS first.
 */
export async function loadPrivateModels(
  service: ServiceClient,
  projectId: string,
  legacyStudio: unknown,
): Promise<{ ok: true; priv: ProductPrivate | null } | { ok: false }> {
  const { data, error } = await service
    .from("project_studio_private")
    .select("product_private")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    if (isMissing0100(error, "project_studio_private")) return { ok: true, priv: serverOwnedOf(legacyStudio).productPrivate };
    console.error("[studio] private models load failed:", error.message);
    return { ok: false };
  }
  return { ok: true, priv: parseProductPrivate((data as { product_private?: unknown } | null)?.product_private) };
}

export async function loadDocPrivate(supabase: SupabaseClient, projectId: string): Promise<PrivateLoad> {
  // Ownership / visibility: the caller's RLS client.
  const { data, error } = await supabase.from("projects").select("id, user_id, studio, studio_version").eq("id", projectId).maybeSingle();
  if (error) {
    if (isMissingStudioColumn(error))
      return { ok: true, available: false, doc: null, owned: { product: null, productPrivate: null }, version: 0, ownerId: null };
    console.error("[studio] private load failed:", error.message);
    return { ok: false, error: "failed" };
  }
  if (!data) return { ok: false, error: "not_found" };
  const row = data as { user_id?: string | null; studio: unknown; studio_version: number | null };

  const service = createServiceClient();
  if (!service) return { ok: false, error: "service_unavailable" };
  const priv = await loadPrivateModels(service, projectId, row.studio);
  if (!priv.ok) return { ok: false, error: "failed" };

  const studio = row.studio && typeof row.studio === "object" ? (row.studio as Record<string, unknown>) : {};
  return {
    ok: true,
    available: true,
    doc: parseStudioDoc(row.studio),
    owned: { product: parseProductDoc(studio.product), productPrivate: priv.priv },
    version: Number(row.studio_version) || 0,
    ownerId: row.user_id ?? null,
  };
}

type ProductSave =
  | { ok: true; version: number }
  | { ok: false; error: "conflict" | "invalid" | "too_large" | "not_found" | "service_unavailable" | "failed" };

/**
 * The product routes' write: the page doc with the new `product`, and the new
 * private models, at `version` (service client; the caller already read the
 * project under RLS). One transaction through studio_product_save (0100).
 */
async function saveProductDoc(projectId: string, userId: string, doc: unknown, version: number, owned: ServerOwned): Promise<ProductSave> {
  const parsed = StudioDocSchema.safeParse(doc);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (docBytes(parsed.data) > DOC_MAX_BYTES) return { ok: false, error: "too_large" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "service_unavailable" };

  const studio = mergeServerOwned(parsed.data, { product: owned.product, productPrivate: null });
  const priv = owned.productPrivate ? trimPrivate(owned.productPrivate) : null;
  const { data, error } = await service.rpc("studio_product_save", {
    p_project: projectId,
    p_user: userId,
    p_version: version,
    p_studio: studio,
    p_private: priv,
  });
  if (!error) {
    const v = typeof data === "number" ? data : Number(data);
    return data !== null && data !== undefined && Number.isFinite(v) ? { ok: true, version: v } : { ok: false, error: "conflict" };
  }
  if (/not_owner/.test(error.message ?? "")) return { ok: false, error: "not_found" };
  if (!isMissing0100(error, "studio_product_save")) {
    console.error("[studio] product save failed:", error.message);
    return { ok: false, error: "failed" };
  }

  // Before 0100: the old storage (studio.productPrivate), same version check.
  const legacy = await service
    .from("projects")
    .update({ studio: mergeServerOwned(parsed.data, owned), studio_version: version + 1 })
    .eq("id", projectId)
    .eq("studio_version", version)
    .select("studio_version");
  if (legacy.error) {
    console.error("[studio] product save (pre-0100) failed:", legacy.error.message);
    return { ok: false, error: "failed" };
  }
  return Array.isArray(legacy.data) && legacy.data.length > 0 ? { ok: true, version: version + 1 } : { ok: false, error: "conflict" };
}

export type ProductState = { doc: StudioDoc; product: ProductDoc; priv: ProductPrivate };

/**
 * Load → apply → save for the product routes; one retry on a conflict. `apply`
 * gets the page doc and the current product + private data (empty when none)
 * and returns the new ones, or null for "nothing to save".
 * error "service_unavailable" → no SUPABASE_SERVICE_ROLE_KEY (routes answer 503).
 * Only the project's owner or a super_admin may write (`userId` = the verified
 * session user): a class teacher can READ a team project under RLS, but the
 * write runs with the service role, so ownership is checked here and again in
 * studio_product_save → "not_found" otherwise.
 */
export async function updateProductDoc(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  apply: (s: ProductState) => ProductState | null,
): Promise<{ saved: boolean; version: number | null; state: ProductState | null; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await loadDocPrivate(supabase, projectId);
    if (!cur.ok) return { saved: false, version: null, state: null, error: cur.error };
    if (!cur.available || !cur.doc) return { saved: false, version: null, state: null, error: cur.available ? "no_doc" : "run_0068" };
    if (cur.ownerId !== userId && !(await isSuperAdmin(supabase, userId))) return { saved: false, version: null, state: null, error: "not_found" };
    const next = apply({
      doc: cur.doc,
      product: cur.owned.product ?? { designs: [], chosenId: null, unlockedId: null, specHash: "" },
      priv: cur.owned.productPrivate ?? { designs: [] },
    });
    if (!next) return { saved: false, version: cur.version, state: null };
    const r = await saveProductDoc(projectId, userId, next.doc, cur.version, { product: next.product, productPrivate: next.priv });
    if (r.ok) return { saved: true, version: r.version, state: next };
    if (r.error !== "conflict") {
      console.warn(`[studio] product doc not saved: ${r.error}`);
      return { saved: false, version: null, state: null, error: r.error };
    }
  }
  return { saved: false, version: null, state: null, error: "conflict" };
}
