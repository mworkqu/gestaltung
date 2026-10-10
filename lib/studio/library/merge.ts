// Code library + owner edits (studio_parts, migration 0070) → one part list.
//
// A studio_parts row with the id of a code part REPLACES it (owner edits win);
// any other row ADDS a new part. Rows that fail LibraryPartSchema or
// validatePart() are skipped and reported (never crash the Studio). STL parts
// skip the model bounding-box check (the viewer scales the mesh to dims), but
// need a real https URL.

import { LibraryPartSchema, type LibraryPart } from "../schema";
import { validatePart } from "./validate";

export type StudioPartRow = {
  id: string;
  data: unknown;
  enabled?: boolean | null;
  updated_at?: string | null;
};

export type PartSource = "code" | "edited" | "new";

export type MergeResult = {
  /** Code parts (edited ones replaced) followed by the new parts. */
  parts: LibraryPart[];
  /** The valid DB parts only (what the client needs on top of the code library). */
  overrides: LibraryPart[];
  skipped: { id: string; errors: string[] }[];
  source: Record<string, PartSource>;
};

export type CheckResult = { ok: true; part: LibraryPart } | { ok: false; errors: string[] };

/** One stored part (any JSON) → a valid LibraryPart, or the reasons it is not. */
export function checkLibraryPart(raw: unknown, id?: string): CheckResult {
  const withId = raw && typeof raw === "object" && !Array.isArray(raw) && id ? { ...(raw as object), id } : raw;
  const parsed = LibraryPartSchema.safeParse(withId);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "part"}: ${i.message}`),
    };
  }
  const part = parsed.data;
  const isStl = part.model.kind === "stl";
  const errors = validatePart(part, { skipModelCheck: isStl });
  if (part.model.kind === "stl" && !/^https:\/\/\S+$/.test(part.model.url)) {
    errors.push(`${part.id}: the STL needs an https link (upload the file)`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, part };
}

export function mergeLibrary(codeParts: LibraryPart[], rows: StudioPartRow[] | null | undefined): MergeResult {
  const codeIds = new Set(codeParts.map((p) => p.id));
  const byId = new Map<string, LibraryPart>();
  const skipped: MergeResult["skipped"] = [];
  for (const row of rows ?? []) {
    if (!row || typeof row.id !== "string") continue;
    if (row.enabled === false) continue;
    const r = checkLibraryPart(row.data, row.id);
    if (r.ok) byId.set(row.id, r.part);
    else skipped.push({ id: row.id, errors: r.errors });
  }

  const source: Record<string, PartSource> = {};
  const parts: LibraryPart[] = codeParts.map((p) => {
    const over = byId.get(p.id);
    source[p.id] = over ? "edited" : "code";
    return over ?? p;
  });
  for (const [id, p] of byId) {
    if (codeIds.has(id)) continue;
    source[id] = "new";
    parts.push(p);
  }
  return { parts, overrides: [...byId.values()], skipped, source };
}
