// Long dashboard lists (D2): 100 rows per page, the page number in the URL
// (?page=N) next to the list's own search and filters, so a link or the back
// button lands on the same rows. Pure; the page slices its rows with
// paginate() and renders components/dashboard/list-pagination.tsx.

export const LIST_PAGE_SIZE = 100;

export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** ?page= as a whole number >= 1 (anything else = 1). */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d+$/.test(v)) return 1;
  const n = Number.parseInt(v, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export type Paged<T> = {
  items: T[];
  /** Current page, clamped to 1..pages. */
  page: number;
  pages: number;
  total: number;
  /** 1-based row numbers shown (0 / 0 when empty). */
  from: number;
  to: number;
};

/** The rows for one page. A page past the end shows the last page. */
export function paginate<T>(rows: readonly T[], page: number, size: number = LIST_PAGE_SIZE): Paged<T> {
  const per = Math.max(1, Math.floor(size));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * per;
  const items = rows.slice(start, start + per);
  return { items, page: current, pages, total, from: total === 0 ? 0 : start + 1, to: start + items.length };
}

/**
 * The query for page `page`, keeping every other search/filter param. Page 1
 * drops `page` so the plain URL stays the canonical first page. Empty values
 * are dropped.
 */
export function pageQuery(params: SearchParamsLike, page: number): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || v === undefined) continue;
    if (Array.isArray(v)) {
      const kept = v.filter((x) => x !== "");
      if (kept.length) out[k] = kept;
    } else if (v !== "") {
      out[k] = v;
    }
  }
  if (page > 1) out.page = String(page);
  return out;
}

/** Case-insensitive "contains" over the given fields (blank query = everything). */
export function matchesQuery(q: string | undefined, fields: (string | null | undefined)[]): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(needle));
}
