// The chosen product picture (P5-16) for My projects, the quote page and the
// admin lead. Server-only. previewPath → a short-lived signed URL, signed with
// the VIEWER's own session: the private project-images bucket lets the project
// owner (0045 owns_storage_project: folder 2 = project id) and the super_admin
// read studio-previews/<projectId>/<designId>.png — nobody else. Any error →
// no picture (pages never break over it).

import type { SupabaseClient } from "@supabase/supabase-js";

import { PREVIEW_BUCKET, isPreviewPath } from "./product";

export const PREVIEW_URL_SECONDS = 3600;

type StudioProductValue = { designs?: { id?: unknown; previewPath?: unknown }[]; chosenId?: unknown } | null | undefined;

/** The chosen design's picture path of a stored studio.product value (null until one is chosen and rendered). */
export function chosenPreviewPath(product: StudioProductValue): string | null {
  if (!product || !Array.isArray(product.designs)) return null;
  const chosen = product.designs.find((d) => d && d.id === product.chosenId && isPreviewPath(d.previewPath));
  return chosen ? (chosen.previewPath as string) : null;
}

/** previewPath → signed URL (null on any problem). */
export async function previewUrl(supabase: SupabaseClient, path: string | null | undefined): Promise<string | null> {
  if (!isPreviewPath(path)) return null;
  try {
    const { data, error } = await supabase.storage.from(PREVIEW_BUCKET).createSignedUrl(path, PREVIEW_URL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
  } catch {
    return null;
  }
}

/** Many paths at once (My projects): path → URL; failures are just missing. */
export async function previewUrls(supabase: SupabaseClient, paths: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const ok = [...new Set(paths.filter(isPreviewPath))];
  const out = new Map<string, string>();
  if (!ok.length) return out;
  try {
    const { data, error } = await supabase.storage.from(PREVIEW_BUCKET).createSignedUrls(ok, PREVIEW_URL_SECONDS);
    if (error || !data) return out;
    for (const r of data) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  } catch {
    /* no pictures */
  }
  return out;
}

/** Chosen picture of one project, read under RLS (null before 0068, for other users' projects, or when none). */
export async function projectPreviewUrl(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("projects").select("product:studio->product").eq("id", projectId).maybeSingle();
    if (error || !data) return null;
    return previewUrl(supabase, chosenPreviewPath((data as { product?: StudioProductValue }).product));
  } catch {
    return null;
  }
}
