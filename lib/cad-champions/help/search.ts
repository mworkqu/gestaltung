// Help Center data access + search (server only; plain functions, no React).
//
// Reads use the cookie-free public client: published articles are anon-readable
// (RLS cc_help_articles_read), so signed-out visitors work. Search is Postgres
// ilike on title_<locale> and body_<locale>; every word must appear in the
// title or the body, then results are ranked in code (title matches first).
// The search log is written with the service client and never blocks rendering.
//
// Every read returns { ok: false } instead of throwing when the table is
// missing (migration 0077 not run) so pages can show an "being set up" state.

import type { Locale } from "@/i18n/routing";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";

import { normalizeHelpCategory, type HelpCategoryId } from "./categories";
import { markdownToPlain } from "./markdown";

export interface HelpArticleLink {
  slug: string;
  title: string;
  category: HelpCategoryId | null;
}

export interface HelpArticle extends HelpArticleLink {
  body: string;
  glossaryTerms: string[];
  videoId: string | null;
  relatedSlugs: string[];
}

export interface HelpSearchResult extends HelpArticleLink {
  snippet: string;
}

export type HelpResult<T> = { ok: true; data: T } | { ok: false };

const MAX_QUERY_LENGTH = 80;
const MAX_WORDS = 5;
const RESULT_LIMIT = 30;

/** Trims, strips characters that are special in PostgREST filters / LIKE, caps length. */
export function sanitizeHelpQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[%_\\"*,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

export function queryWords(q: string): string[] {
  return q.split(" ").filter(Boolean).slice(0, MAX_WORDS);
}

/** Higher = better. Title matches outweigh body matches; whole-phrase title match is best. */
export function scoreArticle(title: string, body: string, q: string): number {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  const phrase = q.toLowerCase();
  let score = 0;
  if (t.includes(phrase)) score += 20;
  if (t.startsWith(phrase)) score += 5;
  for (const w of queryWords(phrase)) {
    if (t.includes(w)) score += 10;
    if (b.includes(w)) score += 1;
  }
  return score;
}

/** Short plain-text excerpt around the first match (or the start of the body). */
export function makeSnippet(bodyMarkdown: string, q: string, length = 140): string {
  const plain = markdownToPlain(bodyMarkdown);
  if (!plain) return "";
  const lower = plain.toLowerCase();
  let at = -1;
  for (const w of queryWords(q.toLowerCase())) {
    at = lower.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) return plain.length > length ? `${plain.slice(0, length).trimEnd()}…` : plain;
  const start = Math.max(0, at - 40);
  const slice = plain.slice(start, start + length).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + length < plain.length ? "…" : ""}`;
}

type Row = {
  slug: string;
  category: string;
  title_en: string;
  title_ar: string;
  body_en?: string;
  body_ar?: string;
  related_glossary_terms?: string[] | null;
  related_slugs?: string[] | null;
  video_id?: string | null;
  sort?: number;
};

const titleOf = (r: Row, locale: Locale) => (locale === "ar" ? r.title_ar : r.title_en) || r.title_en || r.title_ar;
const bodyOf = (r: Row, locale: Locale) => (locale === "ar" ? r.body_ar : r.body_en) || r.body_en || r.body_ar || "";

function toLink(r: Row, locale: Locale): HelpArticleLink {
  return { slug: r.slug, title: titleOf(r, locale), category: normalizeHelpCategory(r.category) };
}

/** Every published article (title + category only): drives category counts and lists. */
export async function listHelpArticles(locale: Locale): Promise<HelpResult<HelpArticleLink[]>> {
  const supabase = createPublicClient();
  if (!supabase) return { ok: false };
  try {
    const { data, error } = await supabase
      .from("cc_help_articles")
      .select("slug, category, title_en, title_ar, sort")
      .eq("is_published", true)
      .order("sort", { ascending: true })
      .order("title_en", { ascending: true });
    if (error) {
      console.error("[cc help] list failed", error.message);
      return { ok: false };
    }
    return { ok: true, data: ((data ?? []) as Row[]).map((r) => toLink(r, locale)) };
  } catch (e) {
    console.error("[cc help] list threw", e);
    return { ok: false };
  }
}

export async function getHelpArticle(slug: string, locale: Locale): Promise<HelpResult<HelpArticle | null>> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return { ok: true, data: null };
  const supabase = createPublicClient();
  if (!supabase) return { ok: false };
  try {
    const { data, error } = await supabase
      .from("cc_help_articles")
      .select("slug, category, title_en, title_ar, body_en, body_ar, related_glossary_terms, related_slugs, video_id")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) {
      console.error("[cc help] article failed", error.message);
      return { ok: false };
    }
    if (!data) return { ok: true, data: null };
    const r = data as Row;
    return {
      ok: true,
      data: {
        ...toLink(r, locale),
        body: bodyOf(r, locale),
        glossaryTerms: r.related_glossary_terms ?? [],
        videoId: r.video_id ?? null,
        relatedSlugs: r.related_slugs ?? [],
      },
    };
  } catch (e) {
    console.error("[cc help] article threw", e);
    return { ok: false };
  }
}

export async function searchHelpArticles(q: string, locale: Locale): Promise<HelpResult<HelpSearchResult[]>> {
  const words = queryWords(q);
  if (words.length === 0) return { ok: true, data: [] };
  const supabase = createPublicClient();
  if (!supabase) return { ok: false };
  const lang = locale === "ar" ? "ar" : "en";
  try {
    let query = supabase
      .from("cc_help_articles")
      .select("slug, category, title_en, title_ar, body_en, body_ar, sort")
      .eq("is_published", true);
    // Each word must appear in the title or the body (repeated .or() calls are ANDed).
    for (const w of words) {
      query = query.or(`title_${lang}.ilike."%${w}%",body_${lang}.ilike."%${w}%"`);
    }
    const { data, error } = await query.limit(100);
    if (error) {
      console.error("[cc help] search failed", error.message);
      return { ok: false };
    }
    const rows = (data ?? []) as Row[];
    const ranked = rows
      .map((r) => ({ r, score: scoreArticle(titleOf(r, locale), bodyOf(r, locale), q) }))
      .sort((a, b) => b.score - a.score || (a.r.sort ?? 0) - (b.r.sort ?? 0))
      .slice(0, RESULT_LIMIT)
      .map(({ r }) => ({ ...toLink(r, locale), snippet: makeSnippet(bodyOf(r, locale), q) }));
    return { ok: true, data: ranked };
  } catch (e) {
    console.error("[cc help] search threw", e);
    return { ok: false };
  }
}

/** Best-effort search log (service client). Never throws, never awaited by the render path. */
export async function logHelpSearch(input: {
  query: string;
  locale: Locale;
  resultsCount: number;
  userId?: string | null;
}): Promise<void> {
  try {
    const service = createServiceClient();
    if (!service) return;
    const { error } = await service.from("cc_help_searches").insert({
      query: input.query,
      locale: input.locale === "ar" ? "ar" : "en",
      results_count: input.resultsCount,
      user_id: input.userId ?? null,
    });
    if (error) console.error("[cc help] search log failed", error.message);
  } catch (e) {
    console.error("[cc help] search log threw", e);
  }
}
