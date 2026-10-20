// W2b (2026-10-11): server reads for the Studio quote. Server-only; every read
// goes through the client the caller passes (RLS applies), except where noted.
//
//   getQuoteRule      store_settings.studio_quote_rule → rule + where it came from
//                     (3e: a CLASS project is priced with the school print rule
//                     from store_settings.school_pricing instead)
//   linkedPrices      store prices of the doc's linked parts (published, not merged)
//   buildQuoteCalc    the snapshot stored with a Studio lead (from the SAVED doc)
//   getProjectQuote   the owner's quote for a project the caller owns (0073 RPC)
//   isMissingQuoteColumn  0073 not run yet

import { skusFor } from "../variants";
import type { SupabaseClient } from "@supabase/supabase-js";

import { studioLibrary } from "../library/remote";
import {
  DEFAULT_QUOTE_RULE,
  parseQuoteRule,
  QUOTE_RULE_KEY,
  quoteBreakdown,
  quoteCalcSnapshot,
  type QuoteCalc,
  type QuoteRule,
} from "../request-summary";
import type { LibraryPart, StudioDoc } from "../schema";
import { loadDoc } from "./doc";
import { parseSchoolPricing, SCHOOL_PRICING_KEY } from "@/lib/schools/pricing";
import { isClassProject } from "@/lib/schools/server";

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

const QUOTE_COLUMNS = ["project_id", "quote_calc", "final_quote_qar", "quote_note", "quoted_at", "quoted_by"];

/** One of the 0073 inquiries columns does not exist yet. */
export function isMissingQuoteColumn(e: PgError): boolean {
  if (!e) return false;
  const text = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return (e.code === "42703" || e.code === "PGRST204" || /column/.test(text)) && QUOTE_COLUMNS.some((c) => text.includes(c));
}

export type RuleRead = { rule: QuoteRule; source: "settings" | "default" | "school" };

/**
 * The print rule for an estimate. With `projectId`, a school CLASS project is
 * priced with store_settings.school_pricing.print (3e) instead of the studio
 * rule — the spread stays the studio's, so the range is built the same way.
 */
export async function getQuoteRule(db: SupabaseClient, projectId?: string | null): Promise<RuleRead> {
  const studio = await studioQuoteRule(db);
  if (!projectId) return studio;
  try {
    if (!(await isClassProject(db, projectId))) return studio;
    const { data } = await db.from("store_settings").select("value").eq("key", SCHOOL_PRICING_KEY).maybeSingle();
    const { print } = parseSchoolPricing((data as { value: unknown } | null)?.value);
    return {
      rule: { ...studio.rule, base_qar: print.base_qar, per_gram_qar: print.per_gram_qar },
      source: "school",
    };
  } catch {
    return studio;
  }
}

async function studioQuoteRule(db: SupabaseClient): Promise<RuleRead> {
  try {
    const { data, error } = await db.from("store_settings").select("value").eq("key", QUOTE_RULE_KEY).maybeSingle();
    if (error || !data) return { rule: DEFAULT_QUOTE_RULE, source: "default" };
    return { rule: parseQuoteRule((data as { value: unknown }).value), source: "settings" };
  } catch {
    return { rule: DEFAULT_QUOTE_RULE, source: "default" };
  }
}

export async function linkedPrices(
  db: SupabaseClient,
  doc: StudioDoc | null,
  getPart: (id: string) => LibraryPart | undefined,
): Promise<Map<string, number>> {
  const skus = [...new Set((doc?.components ?? []).flatMap((c) => skusFor(getPart(c.partId), c.variant)[0] ?? []))];
  const out = new Map<string, number>();
  if (!skus.length) return out;
  const { data } = await db.from("parts").select("sku, unit_price").in("sku", skus).eq("is_published", true).is("merged_into", null);
  for (const p of (data ?? []) as { sku: string; unit_price: number | string | null }[]) {
    const n = Number(p.unit_price);
    if (Number.isFinite(n) && n > 0) out.set(p.sku, n);
  }
  return out;
}

/**
 * The calculation for a Studio request, from the doc SAVED on the project
 * (read under the caller's RLS — a project they cannot read gives null).
 * Never trusts numbers from the browser.
 */
export async function buildQuoteCalc(
  db: SupabaseClient,
  projectId: string,
  projectLink: string | null,
): Promise<QuoteCalc | null> {
  const loaded = await loadDoc(db, projectId);
  if (!loaded.ok) return null;
  const doc = loaded.available ? loaded.doc : null;
  const [lib, rule] = await Promise.all([studioLibrary().catch(() => null), getQuoteRule(db, projectId)]);
  const getPart = (id: string) => lib?.getPart(id);
  const prices = await linkedPrices(db, doc, getPart).catch(() => new Map<string, number>());
  const b = quoteBreakdown({ doc, getPart, prices, rule: rule.rule });
  return quoteCalcSnapshot(b, { ruleSource: rule.source, projectId, projectLink });
}

export type ProjectQuote = { finalQar: number; note: string | null; quotedAt: string | null };

/** The latest owner quote for this project, or null (none yet, not the caller's, or 0073 not run). */
export async function getProjectQuote(db: SupabaseClient, projectId: string): Promise<ProjectQuote | null> {
  try {
    const { data, error } = await db.rpc("project_quote", { p_project: projectId });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as { final_quote_qar?: number | string | null; quote_note?: string | null; quoted_at?: string | null } | undefined;
    const n = Number(row?.final_quote_qar);
    if (!row || row.final_quote_qar === null || !Number.isFinite(n)) return null;
    return { finalQar: n, note: row.quote_note?.trim() || null, quotedAt: row.quoted_at ?? null };
  } catch {
    return null;
  }
}
