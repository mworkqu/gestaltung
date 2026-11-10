// Admin Help Center loaders (Prompt 11) — SERVER ONLY. The CALLER checks the
// role first (requireCcAdmin in the page). Degrades to { ok: false,
// reason: "not_set_up" } when the tables are missing (migration 0077).

import { fetchAllRows } from "@/lib/supabase/fetch-all";

import type { CcHelpArticle } from "../db/types";
import { isUuid } from "./lessons";
import { groupNoResultSearches, helpfulTotals, NO_RESULT_DAYS, type HelpfulStats, type NoResultTerm, type SearchRow } from "./help";
import { adminDb, isMissingSchema, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/help-server.ts is server-only");

export type HelpLoad<T> = { ok: true; data: T } | { ok: false; reason: "not_set_up" | "not_found" | "error" };

export type HelpListRow = Pick<CcHelpArticle, "id" | "slug" | "category" | "title_en" | "title_ar" | "is_published" | "helpful_yes" | "helpful_no" | "updated_at" | "sort">;

function fail<T>(error: { code?: string; message?: string } | null | undefined, label: string): HelpLoad<T> {
  if (isMissingSchema(error?.code)) return { ok: false, reason: "not_set_up" };
  console.error(`[cc-admin-help] ${label} failed:`, error?.code ?? error?.message ?? "unknown");
  return { ok: false, reason: "error" };
}

export interface HelpOverview {
  articles: HelpListRow[];
  totals: HelpfulStats;
}

export async function loadHelpArticles(db: AdminDb | null = adminDb()): Promise<HelpLoad<HelpOverview>> {
  if (!db) return { ok: false, reason: "error" };
  const { rows, error } = await fetchAllRows<HelpListRow>((from, to) =>
    db.from("cc_help_articles").select("id,slug,category,title_en,title_ar,is_published,helpful_yes,helpful_no,updated_at,sort").order("category").order("sort").order("id").range(from, to),
  );
  if (error) return fail(error, "articles");
  return { ok: true, data: { articles: rows, totals: helpfulTotals(rows) } };
}

export async function loadHelpArticle(id: string, db: AdminDb | null = adminDb()): Promise<HelpLoad<CcHelpArticle>> {
  if (!db) return { ok: false, reason: "error" };
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const { data, error } = await db.from("cc_help_articles").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error, "article");
  return data ? { ok: true, data: data as CcHelpArticle } : { ok: false, reason: "not_found" };
}

/** Other article slugs (for the "related" hint). */
export async function loadHelpSlugs(db: AdminDb | null = adminDb()): Promise<string[]> {
  if (!db) return [];
  const { data, error } = await db.from("cc_help_articles").select("slug").order("slug").limit(1000);
  if (error) return [];
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
}

/** Searches with zero results in the last 30 days, grouped by lower(trim(query)). */
export async function loadNoResultSearches(db: AdminDb | null = adminDb(), now: number = Date.now()): Promise<HelpLoad<NoResultTerm[]>> {
  if (!db) return { ok: false, reason: "error" };
  const since = new Date(now - NO_RESULT_DAYS * 86_400_000).toISOString();
  const { rows, error } = await fetchAllRows<SearchRow>(
    (from, to) => db.from("cc_help_searches").select("query,locale,results_count,created_at").eq("results_count", 0).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to),
    1000,
    20_000,
  );
  if (error) return fail(error, "searches");
  return { ok: true, data: groupNoResultSearches(rows, now) };
}
