// Admin Help Center (Prompt 11) — PURE logic: article validation, "was this
// helpful" percentages and the "searches with no results" grouping. No React,
// no database: tested in help.test.ts.

import { HELP_CATEGORY_IDS, type HelpCategoryId } from "../help/categories";
import { cleanGlossaryTerms, isSlug, str, type Validated, type FieldErrors } from "./lessons";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const BUNNY_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HELP_BODY_MAX = 30000;
export const HELP_RELATED_MAX = 8;

export interface HelpArticleInput {
  slug: string;
  category: HelpCategoryId;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  related_glossary_terms: string[];
  related_slugs: string[];
  video_id: string | null;
  sort: number;
  is_published: boolean;
}

/** Comma / space / newline separated slugs -> unique valid slugs (invalid ones dropped), capped. */
export function parseSlugList(text: unknown, exclude?: string): string[] {
  const raw = Array.isArray(text) ? text : typeof text === "string" ? text.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (s && isSlug(s) && s !== exclude && !out.includes(s)) out.push(s);
  }
  return out.slice(0, HELP_RELATED_MAX);
}

/** Help video id: empty, "youtube:<11 chars>" or a Bunny GUID. */
export function validateHelpVideoId(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const v = str(raw);
  if (!v) return { ok: true, value: null };
  if (v.toLowerCase().startsWith("youtube:")) {
    const id = v.slice(8).trim();
    return YOUTUBE_ID.test(id) ? { ok: true, value: `youtube:${id}` } : { ok: false };
  }
  if (BUNNY_GUID.test(v)) return { ok: true, value: v.toLowerCase() };
  return { ok: false };
}

export function isHelpCategory(v: unknown): v is HelpCategoryId {
  return typeof v === "string" && (HELP_CATEGORY_IDS as readonly string[]).includes(v);
}

export function validateHelpArticle(raw: Record<string, unknown>): Validated<HelpArticleInput> {
  const errors: FieldErrors = {};
  const slug = str(raw.slug);
  if (!isSlug(slug)) errors.slug = "invalid";
  if (!isHelpCategory(raw.category)) errors.category = "invalid";
  const title_en = str(raw.title_en);
  const title_ar = str(raw.title_ar);
  if (!title_en || title_en.length > 200) errors.title_en = "invalid";
  if (!title_ar || title_ar.length > 200) errors.title_ar = "invalid";
  const body_en = typeof raw.body_en === "string" ? raw.body_en.trim() : "";
  const body_ar = typeof raw.body_ar === "string" ? raw.body_ar.trim() : "";
  if (body_en.length > HELP_BODY_MAX) errors.body_en = "invalid";
  if (body_ar.length > HELP_BODY_MAX) errors.body_ar = "invalid";
  const video = validateHelpVideoId(raw.video_id);
  if (!video.ok) errors.video_id = "invalid";
  const sortRaw = raw.sort === undefined || raw.sort === "" ? 0 : Number(raw.sort);
  if (!Number.isInteger(sortRaw) || sortRaw < 0 || sortRaw > 9999) errors.sort = "invalid";
  const published = raw.is_published === true;
  if (published && (!body_en || !body_ar)) errors.is_published = "needs_body";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      category: raw.category as HelpCategoryId,
      title_en,
      title_ar,
      body_en,
      body_ar,
      related_glossary_terms: cleanGlossaryTerms(raw.related_glossary_terms),
      related_slugs: parseSlugList(raw.related_slugs, slug),
      video_id: video.ok ? video.value : null,
      sort: sortRaw,
      is_published: published,
    },
  };
}

// ─── helpful votes ────────────────────────────────────────────────────────

export interface HelpfulStats {
  yes: number;
  no: number;
  total: number;
  /** Whole percent 0..100, null while there are no votes. */
  percent: number | null;
}

export function helpfulStats(yes: number | null | undefined, no: number | null | undefined): HelpfulStats {
  const y = Math.max(0, Math.floor(Number(yes) || 0));
  const n = Math.max(0, Math.floor(Number(no) || 0));
  const total = y + n;
  return { yes: y, no: n, total, percent: total === 0 ? null : Math.round((y / total) * 100) };
}

export function helpfulTotals(rows: readonly { helpful_yes?: number | null; helpful_no?: number | null }[]): HelpfulStats {
  let yes = 0;
  let no = 0;
  for (const r of rows) {
    yes += Math.max(0, Number(r.helpful_yes) || 0);
    no += Math.max(0, Number(r.helpful_no) || 0);
  }
  return helpfulStats(yes, no);
}

// ─── searches with no results ─────────────────────────────────────────────

export interface SearchRow {
  query: string;
  locale: string;
  results_count: number;
  created_at: string;
}

export interface NoResultTerm {
  /** lower(trim(query)), inner whitespace collapsed. */
  query: string;
  count: number;
  /** ISO of the newest search. */
  lastSearched: string;
  en: number;
  ar: number;
}

export const NO_RESULT_DAYS = 30;

export function normaliseQuery(q: string): string {
  return (q ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Searches that found nothing in the last `days` days, grouped by the
 * normalised query: count, last searched, and per-locale counts. Most
 * searched first, then newest, then alphabetical.
 */
export function groupNoResultSearches(rows: readonly SearchRow[], now: Date | number = Date.now(), days = NO_RESULT_DAYS, limit = 50): NoResultTerm[] {
  const cutoff = (typeof now === "number" ? now : now.getTime()) - days * 86_400_000;
  const map = new Map<string, NoResultTerm & { last: number }>();
  for (const r of rows) {
    if ((Number(r.results_count) || 0) !== 0) continue;
    const query = normaliseQuery(r.query);
    if (!query) continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const cur = map.get(query) ?? { query, count: 0, lastSearched: r.created_at, en: 0, ar: 0, last: 0 };
    cur.count += 1;
    if (r.locale === "ar") cur.ar += 1;
    else cur.en += 1;
    if (at > cur.last) {
      cur.last = at;
      cur.lastSearched = r.created_at;
    }
    map.set(query, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last || a.query.localeCompare(b.query))
    .slice(0, limit)
    .map((x) => ({ query: x.query, count: x.count, lastSearched: x.lastSearched, en: x.en, ar: x.ar }));
}

