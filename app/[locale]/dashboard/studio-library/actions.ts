"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { getPart as codePart } from "@/lib/studio/library";
import { draftToPart, parseCommaList, plainCheck, type FieldError, type PartDraft } from "@/lib/studio/library/form";
import { checkLibraryPart } from "@/lib/studio/library/merge";
import { STUDIO_LIBRARY_TAG } from "@/lib/studio/library/remote";
import { LibraryPartSchema, type LibraryPart } from "@/lib/studio/schema";

// Studio library admin (P5-15c). super_admin only — checked here and again by
// RLS on studio_parts (0070). Every save runs the same checks the Studio runs
// when it reads the rows (draftToPart → LibraryPartSchema + validatePart; STL
// parts skip the model size check), then upserts and refreshes the cached
// library (tag "studio-library").

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors?: FieldError[]; checks?: string[]; message?: "forbidden" | "run_0070" | "failed" };

const MISSING = new Set(["42P01", "PGRST205"]);

async function admin() {
  const session = await getSessionContext();
  return session?.profile.role === "super_admin";
}

function refresh(locale: string) {
  try {
    revalidateTag(STUDIO_LIBRARY_TAG);
  } catch {
    /* outside a request */
  }
  const l = locale === "ar" ? "ar" : "en";
  revalidatePath(`/${l}/dashboard/studio-library`);
}

async function upsert(part: LibraryPart, enabled?: boolean): Promise<SaveResult> {
  const supabase = await createClient();
  const row: { id: string; data: LibraryPart; enabled?: boolean } = { id: part.id, data: part };
  if (enabled !== undefined) row.enabled = enabled;
  const { error } = await supabase.from("studio_parts").upsert(row, { onConflict: "id" });
  if (error) {
    if (MISSING.has(error.code ?? "")) return { ok: false, message: "run_0070" };
    console.error("[studio-library] save failed:", error.code, error.message);
    return { ok: false, message: "failed" };
  }
  return { ok: true, id: part.id };
}

function checks(part: LibraryPart): string[] {
  const r = checkLibraryPart(part, part.id);
  return r.ok ? [] : r.errors.map((e) => plainCheck(e, part.id));
}

/** Add / edit a whole part from the form. `originalId`: the id being edited (an id change is refused). */
export async function savePart(locale: string, draft: PartDraft, originalId: string | null): Promise<SaveResult> {
  if (!(await admin())) return { ok: false, message: "forbidden" };
  const r = draftToPart(draft);
  if (!r.ok) return { ok: false, fieldErrors: r.errors };
  if (originalId && originalId !== r.part.id) return { ok: false, fieldErrors: [{ field: "id", code: "id" }] };
  const problems = checks(r.part);
  if (problems.length) return { ok: false, checks: problems };
  const saved = await upsert(r.part, true);
  if (saved.ok) refresh(locale);
  return saved;
}

/** The part as the Studio sees it now: the row's data, else the code part. */
async function currentPart(id: string): Promise<{ part: LibraryPart | null; missingTable: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("studio_parts").select("data").eq("id", id).maybeSingle();
  if (error && MISSING.has(error.code ?? "")) return { part: null, missingTable: true };
  if (data) {
    const parsed = LibraryPartSchema.safeParse({ ...(data.data as object), id });
    if (parsed.success) return { part: parsed.data, missingTable: false };
  }
  return { part: codePart(id) ?? null, missingTable: false };
}

/** Quick "link store SKUs" from the list: only storeSkus changes. */
export async function savePartSkus(locale: string, id: string, skus: string): Promise<SaveResult> {
  if (!(await admin())) return { ok: false, message: "forbidden" };
  const { part, missingTable } = await currentPart(id);
  if (missingTable) return { ok: false, message: "run_0070" };
  if (!part) return { ok: false, message: "failed" };
  const next: LibraryPart = { ...part, storeSkus: parseCommaList(skus) };
  const problems = checks(next);
  if (problems.length) return { ok: false, checks: problems };
  const saved = await upsert(next);
  if (saved.ok) refresh(locale);
  return saved;
}

export async function setPartEnabled(locale: string, id: string, enabled: boolean): Promise<SaveResult> {
  if (!(await admin())) return { ok: false, message: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("studio_parts").update({ enabled }).eq("id", id);
  if (error) return { ok: false, message: MISSING.has(error.code ?? "") ? "run_0070" : "failed" };
  refresh(locale);
  return { ok: true, id };
}

/** Delete the row: a code part goes back to its code version, a new part is removed. */
export async function resetPart(locale: string, id: string): Promise<SaveResult> {
  if (!(await admin())) return { ok: false, message: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("studio_parts").delete().eq("id", id);
  if (error) return { ok: false, message: MISSING.has(error.code ?? "") ? "run_0070" : "failed" };
  refresh(locale);
  return { ok: true, id };
}

export type SkuLookup = {
  found: { sku: string; name: string; image_url: string | null; published: boolean; merged: boolean }[];
  missing: string[];
};

/** Look SKUs up in the store (admin sees unpublished products too). */
export async function lookupSkus(skus: string[]): Promise<SkuLookup | null> {
  if (!(await admin())) return null;
  const list = skus.map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!list.length) return { found: [], missing: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parts")
    .select("sku, name, image_url, is_published, merged_into")
    .in("sku", list);
  if (error) return null;
  const rows = (data ?? []) as { sku: string; name: string; image_url: string | null; is_published: boolean; merged_into?: string | null }[];
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  return {
    found: list.filter((s) => bySku.has(s)).map((s) => {
      const r = bySku.get(s)!;
      return { sku: r.sku, name: r.name, image_url: r.image_url, published: !!r.is_published, merged: !!r.merged_into };
    }),
    missing: list.filter((s) => !bySku.has(s)),
  };
}
