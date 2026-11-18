"use server";

import { after } from "next/server";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import {
  logHelpSearch,
  sanitizeHelpQuery,
  searchHelpArticles,
  type HelpSearchResult,
} from "@/lib/cad-champions/help/search";
import { isCcLocale } from "@/lib/cad-champions/routes";

// Help Center search. The /help page is prerendered, so the query (?q=) is read
// in the browser and answered here. Same behaviour as the old server render:
// sanitised query, public (anon) read, best-effort search log after the response.

export type HelpSearchResponse =
  | { ok: true; q: string; results: HelpSearchResult[] }
  | { ok: false; q: string };

export async function searchHelpAction(rawQuery: string, locale: string): Promise<HelpSearchResponse> {
  const q = sanitizeHelpQuery(rawQuery);
  if (!q || !isCcLocale(locale)) return { ok: true, q, results: [] };

  const [search, cc] = await Promise.all([searchHelpArticles(q, locale), getCcUser()]);
  if (!search.ok) return { ok: false, q };

  const resultsCount = search.data.length;
  const userId = cc?.user.id ?? null;
  try {
    after(() => logHelpSearch({ query: q, locale, resultsCount, userId }));
  } catch {
    void logHelpSearch({ query: q, locale, resultsCount, userId });
  }
  return { ok: true, q, results: search.data };
}
