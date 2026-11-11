// Admin student list (Prompt 11 Step D) — pure: the row shape, filters from
// the URL, matching, sorting and the CSV export. Shared by the Students table
// and the announcement recipient picker (Operations), so both use the same
// filters. The DB read is students-server.ts.

import { CC_BANDS, type CcBand, type CcStudyLevel } from "../db/types";

export interface StudentRow {
  id: string;
  name: string | null;
  nameAr: string | null;
  email: string | null;
  phone: string | null;
  /** institution, else institution_other */
  institution: string | null;
  studyLevel: CcStudyLevel | null;
  isMinor: boolean;
  marketingConsent: boolean;
  preferredLocale: "en" | "ar";
  /** 0-100, required Get Ready steps done. 100 when bypassed or completed. */
  getReadyPercent: number;
  getReadyDoneAt: string | null;
  getReadyBypass: boolean;
  /** Latest submitted/graded attempt (any listed test). */
  latestPercent: number | null;
  latestBand: CcBand | null;
  latestAttemptAt: string | null;
  /** End of the active enrollment, or null. */
  enrolledUntil: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  openFlags: number;
  deletionRequested: boolean;
}

export const STUDENT_SORTS = ["created", "name", "last_active", "get_ready", "score"] as const;
export type StudentSort = (typeof STUDENT_SORTS)[number];

export interface StudentFilters {
  q: string;
  institution: string;
  /** "" = any, "none" = no result yet */
  band: "" | CcBand | "none";
  enrolled: "" | "yes" | "no";
  /** Get Ready not done (and not bypassed) more than 7 days after sign-up. */
  stuck: boolean;
  /** Has unresolved integrity flags. */
  flagged: boolean;
  sort: StudentSort;
  dir: "asc" | "desc";
}

export const EMPTY_STUDENT_FILTERS: StudentFilters = { q: "", institution: "", band: "", enrolled: "", stuck: false, flagged: false, sort: "created", dir: "desc" };

export const STUCK_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filters from search params (anything unknown = default). Also accepts a plain object (stored announcement filters). */
export function parseStudentFilters(sp: Params | Record<string, unknown> | null | undefined): StudentFilters {
  const p = (sp ?? {}) as Params;
  const band = one(p.band);
  const enrolled = one(p.enrolled);
  const sort = one(p.sort);
  const truthy = (v: unknown) => v === true || v === "1" || v === "true";
  return {
    q: one(p.q).trim().slice(0, 100),
    institution: one(p.institution).trim().slice(0, 120),
    band: band === "none" || (CC_BANDS as readonly string[]).includes(band) ? (band as StudentFilters["band"]) : "",
    enrolled: enrolled === "yes" || enrolled === "no" ? enrolled : "",
    stuck: truthy((p as Record<string, unknown>).stuck),
    flagged: truthy((p as Record<string, unknown>).flagged),
    sort: (STUDENT_SORTS as readonly string[]).includes(sort) ? (sort as StudentSort) : "created",
    dir: one(p.dir) === "asc" ? "asc" : "desc",
  };
}

/** The filters as URL params / a stored jsonb (defaults dropped). */
export function studentFilterParams(f: StudentFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.institution) out.institution = f.institution;
  if (f.band) out.band = f.band;
  if (f.enrolled) out.enrolled = f.enrolled;
  if (f.stuck) out.stuck = "1";
  if (f.flagged) out.flagged = "1";
  if (f.sort !== "created") out.sort = f.sort;
  if (f.dir !== "desc") out.dir = f.dir;
  return out;
}

export function isEnrolled(row: Pick<StudentRow, "enrolledUntil">, now: number): boolean {
  return !!row.enrolledUntil && Date.parse(row.enrolledUntil) > now;
}

export function isStuckInGetReady(row: Pick<StudentRow, "getReadyDoneAt" | "getReadyBypass" | "createdAt" | "getReadyPercent">, now: number): boolean {
  if (row.getReadyDoneAt || row.getReadyBypass || row.getReadyPercent >= 100) return false;
  const created = Date.parse(row.createdAt);
  return Number.isFinite(created) && now - created > STUCK_DAYS * DAY;
}

export function matchesStudentFilters(row: StudentRow, f: StudentFilters, now: number): boolean {
  if (f.q) {
    const needle = f.q.toLowerCase();
    const hay = [row.name, row.nameAr, row.email, row.phone, row.institution].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.institution && (row.institution ?? "").toLowerCase() !== f.institution.toLowerCase()) return false;
  if (f.band === "none" && row.latestBand) return false;
  if (f.band && f.band !== "none" && row.latestBand !== f.band) return false;
  if (f.enrolled === "yes" && !isEnrolled(row, now)) return false;
  if (f.enrolled === "no" && isEnrolled(row, now)) return false;
  if (f.stuck && !isStuckInGetReady(row, now)) return false;
  if (f.flagged && row.openFlags <= 0) return false;
  return true;
}

const ts = (v: string | null) => (v ? Date.parse(v) || 0 : 0);

export function sortStudents(rows: readonly StudentRow[], sort: StudentSort, dir: "asc" | "desc"): StudentRow[] {
  const key = (r: StudentRow): number | string => {
    switch (sort) {
      case "name":
        return (r.name || r.nameAr || r.email || "").toLowerCase();
      case "last_active":
        return ts(r.lastActiveAt);
      case "get_ready":
        return r.getReadyPercent;
      case "score":
        return r.latestPercent ?? -1;
      default:
        return ts(r.createdAt);
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === "string" && typeof kb === "string" ? ka.localeCompare(kb) : (ka as number) - (kb as number);
    return c !== 0 ? c * sign : a.id.localeCompare(b.id);
  });
}

export function filterStudents(rows: readonly StudentRow[], f: StudentFilters, now: number): StudentRow[] {
  return sortStudents(
    rows.filter((r) => matchesStudentFilters(r, f, now)),
    f.sort,
    f.dir,
  );
}

/** Distinct institutions for the filter dropdown (sorted, case-insensitive dedupe). */
export function institutionsOf(rows: readonly StudentRow[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const v = (r.institution ?? "").trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ------------------------------------------------------------------ CSV

/** One CSV cell: quoted, quotes doubled, and spreadsheet formulas neutralised. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const STUDENT_CSV_COLUMNS = [
  "id",
  "name",
  "name_ar",
  "institution",
  "study_level",
  "minor",
  "get_ready_percent",
  "latest_percent",
  "band",
  "enrolled_until",
  "last_active_at",
  "created_at",
  "marketing_consent",
  "email",
  "phone",
] as const;

/**
 * CSV of the given students. Contact columns (email, phone) are filled ONLY
 * for students with marketing_consent = true; for everyone else they stay
 * empty. UTF-8 with a BOM so Excel shows Arabic names.
 */
export function studentsCsv(rows: readonly StudentRow[]): string {
  const lines = [STUDENT_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const contact = r.marketingConsent;
    lines.push(
      [
        r.id,
        r.name,
        r.nameAr,
        r.institution,
        r.studyLevel,
        r.isMinor ? "yes" : "no",
        r.getReadyPercent,
        r.latestPercent ?? "",
        r.latestBand ?? "",
        r.enrolledUntil ?? "",
        r.lastActiveAt ?? "",
        r.createdAt,
        r.marketingConsent ? "yes" : "no",
        contact ? r.email : "",
        contact ? r.phone : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
