// Server-side Studio library: code parts + the owner's studio_parts rows
// (migration 0070). Cookie-free anon client + unstable_cache (tag
// "studio-library", 5 min) so every request reuses one read; the admin save
// calls revalidateTag(STUDIO_LIBRARY_TAG). Before 0070 runs (table missing) or
// on any error the Studio simply uses the code library.

import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import type { LibraryPart } from "../schema";
import { LIBRARY, makeLibrary, type StudioLibrary } from "./index";
import { mergeLibrary, type MergeResult, type StudioPartRow } from "./merge";

export const STUDIO_LIBRARY_TAG = "studio-library";
export const STUDIO_LIBRARY_REVALIDATE = 300;

/** Enabled studio_parts rows, or null when the table is missing / unreadable. */
export const getStudioPartRows = unstable_cache(
  async (): Promise<StudioPartRow[] | null> => {
    const client = createPublicClient();
    if (!client) return null;
    try {
      const { data, error } = await client
        .from("studio_parts")
        .select("id, data, enabled, updated_at")
        .eq("enabled", true)
        .limit(1000);
      if (error) {
        // 42P01 / PGRST205 = table not created yet (pre-0070): silent.
        if (error.code !== "42P01" && error.code !== "PGRST205") {
          console.warn("[studio-library] read failed:", error.code, error.message);
        }
        return null;
      }
      return (data ?? []) as StudioPartRow[];
    } catch (e) {
      console.warn("[studio-library] read failed:", e instanceof Error ? e.message : e);
      return null;
    }
  },
  ["studio-library-rows"],
  { revalidate: STUDIO_LIBRARY_REVALIDATE, tags: [STUDIO_LIBRARY_TAG] },
);

export type ServerStudioLibrary = MergeResult & { lib: StudioLibrary };

/** The merged library for this request (falls back to the code library). */
export async function getStudioLibrary(): Promise<ServerStudioLibrary> {
  let rows: StudioPartRow[] | null = null;
  try {
    rows = await getStudioPartRows();
  } catch {
    rows = null;
  }
  const merged = mergeLibrary(LIBRARY, rows);
  if (merged.skipped.length) {
    console.warn(
      "[studio-library] skipped invalid parts:",
      merged.skipped.map((s) => `${s.id} (${s.errors[0] ?? "invalid"})`).join("; "),
    );
  }
  return { ...merged, lib: makeLibrary(merged.parts) };
}

/** Just the per-request library (API routes). */
export async function studioLibrary(): Promise<StudioLibrary> {
  return (await getStudioLibrary()).lib;
}

/** The DB parts the client needs on top of the code library (Studio page prop). */
export async function studioLibraryOverrides(): Promise<LibraryPart[]> {
  return (await getStudioLibrary()).overrides;
}
