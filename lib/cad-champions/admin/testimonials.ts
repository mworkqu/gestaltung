// Landing testimonials (cc_testimonials, migration 0085): pure helpers for
// validation, ordering and the public view. DB access: testimonials-server.ts.

import type { Locale } from "@/i18n/routing";

export interface TestimonialRow {
  id: string;
  quote_en: string;
  quote_ar: string;
  name_en: string;
  name_ar: string;
  role_en: string | null;
  role_ar: string | null;
  sort: number;
  is_published: boolean;
}

export interface TestimonialInput {
  quote_en: string;
  quote_ar: string;
  name_en: string;
  name_ar: string;
  role_en: string;
  role_ar: string;
}

export const TESTIMONIAL_LIMITS = { quote: 600, name: 80, role: 120 } as const;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/**
 * Trims and checks a testimonial form. The quote and name are required in
 * BOTH languages (the landing shows the one for the page locale); roles are optional.
 */
export function parseTestimonialInput(raw: unknown): { ok: true; value: TestimonialInput } | { ok: false; field: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value: TestimonialInput = {
    quote_en: clean(r.quote_en, TESTIMONIAL_LIMITS.quote),
    quote_ar: clean(r.quote_ar, TESTIMONIAL_LIMITS.quote),
    name_en: clean(r.name_en, TESTIMONIAL_LIMITS.name),
    name_ar: clean(r.name_ar, TESTIMONIAL_LIMITS.name),
    role_en: clean(r.role_en, TESTIMONIAL_LIMITS.role),
    role_ar: clean(r.role_ar, TESTIMONIAL_LIMITS.role),
  };
  for (const f of ["quote_en", "quote_ar", "name_en", "name_ar"] as const) if (!value[f]) return { ok: false, field: f };
  return { ok: true, value };
}

/** Stable order: sort asc, then id (so equal sorts never flip on reload). */
export function sortTestimonials<T extends Pick<TestimonialRow, "id" | "sort">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

/** The next sort value for a new row (end of the list). */
export function nextSort(rows: readonly Pick<TestimonialRow, "sort">[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sort), 0) + 10;
}

/**
 * Moves a row one step up/down and returns the new sort values for the rows
 * that changed (renumbered 10, 20, 30 ... so ties and gaps are healed).
 * Empty result = nothing to do (already at the edge / unknown id).
 */
export function moveTestimonial(rows: readonly Pick<TestimonialRow, "id" | "sort">[], id: string, dir: "up" | "down"): { id: string; sort: number }[] {
  const list = sortTestimonials(rows);
  const i = list.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  const out: { id: string; sort: number }[] = [];
  next.forEach((r, idx) => {
    const sort = (idx + 1) * 10;
    if (r.sort !== sort) out.push({ id: r.id, sort });
  });
  return out;
}

export interface PublicTestimonial {
  id: string;
  quote: string;
  name: string;
  role: string | null;
}

/** Published rows in order, text for the page locale (falls back to the other language if one is blank). */
export function publicTestimonials(rows: readonly TestimonialRow[], locale: Locale): PublicTestimonial[] {
  const ar = locale === "ar";
  return sortTestimonials(rows.filter((r) => r.is_published)).map((r) => ({
    id: r.id,
    quote: (ar ? r.quote_ar || r.quote_en : r.quote_en || r.quote_ar).trim(),
    name: (ar ? r.name_ar || r.name_en : r.name_en || r.name_ar).trim(),
    role: ((ar ? r.role_ar || r.role_en : r.role_en || r.role_ar) ?? "").trim() || null,
  })).filter((r) => r.quote !== "" && r.name !== "");
}
