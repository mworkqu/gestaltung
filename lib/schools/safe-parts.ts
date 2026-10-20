// Safety mode on the SERVER (3d). A class project may only use class-safe
// parts, and that is enforced where the parts actually enter the document, not
// in the UI: the pick route, the page's own doc save and the wiring route all
// go through here.
//
// The trick is to hand the whole pipeline a RESTRICTED library rather than
// filter afterwards: the AI index, enforcePick's validation, its fallback and
// buildWiring's helper parts (resistor, level shifter) are all derived from the
// same part list, so one substitution constrains every one of them. The pick
// cache key already hashes the library's id list (lib/studio/ai/cache.ts
// pickKey), so a class answer and a normal answer never share a cache entry.
//
// Before migration 0096 runs, is_class_project() does not exist, every project
// reads as "not a class" and nothing here changes behaviour.

import type { SupabaseClient } from "@supabase/supabase-js";

import { makeLibrary, type StudioLibrary } from "@/lib/studio/library/index";
import { classSafeParts, classSafetyReason } from "@/lib/studio/library/class-safe";
import type { StudioComponent } from "@/lib/studio/schema";
import { isClassProject } from "./server";

/** The same library with every part a class may not use removed. */
export function classSafeLibrary(lib: StudioLibrary): StudioLibrary {
  return makeLibrary(classSafeParts(lib.parts));
}

export type ClassGuard = {
  /** This project belongs to a class team, so safety mode applies. */
  isClass: boolean;
  /** The library to use: restricted for a class project, unchanged otherwise. */
  lib: StudioLibrary;
};

export async function classGuard(
  supabase: SupabaseClient,
  projectId: string,
  lib: StudioLibrary,
): Promise<ClassGuard> {
  const isClass = await isClassProject(supabase, projectId);
  return { isClass, lib: isClass ? classSafeLibrary(lib) : lib };
}

/**
 * The part ids on a list a class may not use, with the reason. Used to refuse a
 * doc save (the Parts step can add a part by hand, which never goes near the
 * picker) and to log what was refused.
 */
export function refusedParts(
  components: readonly Pick<StudioComponent, "partId">[],
  lib: StudioLibrary,
): { partId: string; reason: string }[] {
  const out: { partId: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.partId)) continue;
    seen.add(c.partId);
    const part = lib.getPart(c.partId);
    // An id that is not in the library at all is somebody else's problem
    // (StudioDocSchema allows any string); safety mode only judges real parts.
    if (!part) continue;
    const reason = classSafetyReason(part);
    if (reason) out.push({ partId: c.partId, reason });
  }
  return out;
}

/**
 * Refuse a class project's document when it names a part a class may not use.
 * `lib` must be the FULL library (so the part can be looked up and named).
 */
export function classDocRefusal(
  components: readonly Pick<StudioComponent, "partId">[],
  fullLib: StudioLibrary,
): { error: "unsafe_part"; parts: string[] } | null {
  const refused = refusedParts(components, fullLib);
  if (!refused.length) return null;
  return { error: "unsafe_part", parts: refused.map((r) => r.partId) };
}
