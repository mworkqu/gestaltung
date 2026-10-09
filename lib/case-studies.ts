// Case studies (P4-04). One markdown file per story in content/case-studies/.
//
// File layout
//   ---
//   slug: my-story            (must equal the file name without ".md")
//   title_en / title_ar       (required)
//   persona / persona_ar      (short line, e.g. "Hardware founder"; persona_ar falls back to persona)
//   sector: startup | college | school
//   summary_en / summary_ar   (required, one or two sentences)
//   outcome_en / outcome_ar   (list of short lines, optional)
//   published: true | false   (missing = false; a story never goes live by accident)
//   date: 2026-01-31          (optional, newest first)
//   ---
//   English body (markdown subset of lib/legal/markdown.ts)
//   <!-- ar -->               (a line holding only this comment)
//   Arabic body
//
// Frontmatter is a flat YAML subset: `key: value` lines (optionally quoted) and
// `key:` followed by `- item` lines. HTML comments in the body are dropped, so
// a README comment can sit at the top of a file. Invalid files are skipped, not
// rendered. The pure functions below are unit-tested; the fs reader at the
// bottom is only imported by server components and the sitemap.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMarkdown, type Block } from "@/lib/legal/markdown";

export const CASE_STUDY_SECTORS = ["startup", "college", "school"] as const;
export type CaseStudySector = (typeof CASE_STUDY_SECTORS)[number];

export type CaseStudy = {
  slug: string;
  sector: CaseStudySector;
  title_en: string;
  title_ar: string;
  persona: string;
  persona_ar: string;
  summary_en: string;
  summary_ar: string;
  outcome_en: string[];
  outcome_ar: string[];
  published: boolean;
  /** ISO date (YYYY-MM-DD) or null. */
  date: string | null;
  body_en: Block[];
  body_ar: Block[];
};

export type Frontmatter = Record<string, string | string[]>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AR_SEPARATOR = /^[ \t]*<!--\s*ar\s*-->[ \t]*$/m;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return v;
}

/**
 * Split "---\n<frontmatter>\n---\n<body>" and parse the flat YAML subset.
 * Returns null when there is no frontmatter block.
 */
export function parseFrontmatter(src: string): { data: Frontmatter; body: string } | null {
  const text = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // A README comment may sit above the frontmatter.
  const stripped = text.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, "");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(stripped);
  if (!m) return null;

  const data: Frontmatter = {};
  let listKey: string | null = null;
  for (const raw of m[1].split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const item = /^\s+-\s*(.*)$/.exec(raw);
    if (item) {
      if (listKey === null) return null; // list item with no key
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(raw);
    if (!kv) return null;
    const [, key, value] = kv;
    if (value.trim() === "") {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: m[2] ?? "" };
}

/** Body text -> English and Arabic markdown (comments removed). */
export function splitBodies(body: string): { en: string; ar: string } {
  const text = body.replace(/\r\n?/g, "\n");
  const parts = text.split(AR_SEPARATOR);
  const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();
  return { en: clean(parts[0] ?? ""), ar: clean(parts.slice(1).join("\n")) };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

function validDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * One file -> a CaseStudy, or null when it is invalid: no frontmatter, a slug
 * that is malformed or differs from the file name, a sector outside the list,
 * a missing title or summary, a `published` that is not true/false, or a bad date.
 */
export function parseCaseStudy(fileName: string, src: string): CaseStudy | null {
  const fm = parseFrontmatter(src);
  if (!fm) return null;
  const d = fm.data;

  const slug = str(d.slug);
  if (!SLUG_RE.test(slug) || slug !== fileName.replace(/\.md$/i, "")) return null;

  const sector = str(d.sector);
  if (!(CASE_STUDY_SECTORS as readonly string[]).includes(sector)) return null;

  const title_en = str(d.title_en);
  const title_ar = str(d.title_ar);
  const summary_en = str(d.summary_en);
  const summary_ar = str(d.summary_ar);
  if (!title_en || !title_ar || !summary_en || !summary_ar) return null;

  let published = false;
  if (d.published !== undefined) {
    const p = str(d.published).toLowerCase();
    if (p === "true") published = true;
    else if (p !== "false") return null;
  }

  let date: string | null = null;
  if (d.date !== undefined && str(d.date) !== "") {
    date = str(d.date);
    if (!validDate(date)) return null;
  }

  const persona = str(d.persona);
  const bodies = splitBodies(fm.body);
  return {
    slug,
    sector: sector as CaseStudySector,
    title_en,
    title_ar,
    persona,
    persona_ar: str(d.persona_ar) || persona,
    summary_en,
    summary_ar,
    outcome_en: list(d.outcome_en),
    outcome_ar: list(d.outcome_ar),
    published,
    date,
    body_en: parseMarkdown(bodies.en),
    body_ar: parseMarkdown(bodies.ar),
  };
}

/** Newest date first (undated last), then slug A-Z. */
export function sortCaseStudies<T extends { slug: string; date: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? 1 : -1;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}

/** Parse many files; invalid ones and duplicate slugs are dropped. */
export function buildCaseStudies(files: { name: string; content: string }[]): CaseStudy[] {
  const seen = new Set<string>();
  const out: CaseStudy[] = [];
  for (const f of files) {
    const cs = parseCaseStudy(f.name, f.content);
    if (!cs || seen.has(cs.slug)) continue;
    seen.add(cs.slug);
    out.push(cs);
  }
  return sortCaseStudies(out);
}

/** Localised fields of one story. */
export function localizedCaseStudy(cs: CaseStudy, locale: string) {
  const ar = locale === "ar";
  return {
    title: ar ? cs.title_ar : cs.title_en,
    persona: ar ? cs.persona_ar : cs.persona,
    summary: ar ? cs.summary_ar : cs.summary_en,
    outcome: ar ? cs.outcome_ar : cs.outcome_en,
    body: ar ? cs.body_ar : cs.body_en,
  };
}

// ------------------------------------------------------------- fs reader

const DIR = join(process.cwd(), "content", "case-studies");

function readAll(): CaseStudy[] {
  let names: string[];
  try {
    names = readdirSync(DIR).filter((n) => n.toLowerCase().endsWith(".md"));
  } catch {
    return [];
  }
  const files: { name: string; content: string }[] = [];
  for (const name of names) {
    try {
      files.push({ name, content: readFileSync(join(DIR, name), "utf8") });
    } catch {
      /* unreadable file: skip */
    }
  }
  return buildCaseStudies(files);
}

/** Valid stories, sorted. `publishedOnly` is what every public page uses. */
export function listCaseStudies(opts: { publishedOnly?: boolean } = {}): CaseStudy[] {
  const all = readAll();
  return opts.publishedOnly ? all.filter((c) => c.published) : all;
}

/** One story by slug, or null. Unpublished stories are returned too: callers decide. */
export function getCaseStudy(slug: string): CaseStudy | null {
  return readAll().find((c) => c.slug === slug) ?? null;
}
