// Rows for the Studio library admin (P5-15c): code parts + studio_parts rows,
// with where each comes from and what is wrong with a bad row. Pure.

import { CATEGORIES, type LibraryPart } from "../schema";
import { checkLibraryPart, type PartSource, type StudioPartRow } from "./merge";
import { plainCheck } from "./form";

export type AdminLibraryRow = {
  id: string;
  /** The part the admin sees: the valid row, else the code part, else null (a broken new row). */
  part: LibraryPart | null;
  name: string;
  category: string;
  source: PartSource;
  enabled: boolean | null;
  skus: string[];
  problems: string[];
};

function rawName(data: unknown): { name: string; category: string } {
  const o = (data && typeof data === "object" ? data : {}) as { name?: { en?: unknown }; category?: unknown };
  return {
    name: typeof o.name?.en === "string" ? o.name.en : "",
    category: typeof o.category === "string" && (CATEGORIES as readonly string[]).includes(o.category) ? o.category : "sensor",
  };
}

export function adminRows(codeParts: LibraryPart[], rows: StudioPartRow[]): AdminLibraryRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: AdminLibraryRow[] = [];
  const one = (id: string, code: LibraryPart | undefined, row: StudioPartRow | undefined): AdminLibraryRow => {
    if (!row) {
      const p = code!;
      return { id, part: p, name: p.name.en, category: p.category, source: "code", enabled: null, skus: p.storeSkus, problems: [] };
    }
    const r = checkLibraryPart(row.data, id);
    const part = r.ok ? r.part : code ?? null;
    const raw = rawName(row.data);
    return {
      id,
      part,
      name: part?.name.en || raw.name || id,
      category: part?.category ?? raw.category,
      source: code ? "edited" : "new",
      enabled: row.enabled !== false,
      skus: r.ok ? r.part.storeSkus : code?.storeSkus ?? [],
      problems: r.ok ? [] : r.errors.map((e) => plainCheck(e, id)),
    };
  };
  for (const p of codeParts) out.push(one(p.id, p, byId.get(p.id)));
  const codeIds = new Set(codeParts.map((p) => p.id));
  for (const row of rows) if (!codeIds.has(row.id)) out.push(one(row.id, undefined, row));
  return out;
}
