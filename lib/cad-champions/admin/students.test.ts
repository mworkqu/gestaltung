import { describe, expect, it } from "vitest";

import {
  csvCell,
  EMPTY_STUDENT_FILTERS,
  filterStudents,
  institutionsOf,
  isEnrolled,
  isStuckInGetReady,
  parseStudentFilters,
  sortStudents,
  studentFilterParams,
  studentsCsv,
  type StudentRow,
} from "./students";

const NOW = Date.parse("2026-10-14T09:00:00Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function row(over: Partial<StudentRow> & { id: string }): StudentRow {
  return {
    name: null,
    nameAr: null,
    email: null,
    phone: null,
    institution: null,
    studyLevel: null,
    isMinor: false,
    marketingConsent: false,
    preferredLocale: "en",
    getReadyPercent: 0,
    getReadyDoneAt: null,
    getReadyBypass: false,
    latestPercent: null,
    latestBand: null,
    latestAttemptAt: null,
    enrolledUntil: null,
    lastActiveAt: null,
    createdAt: iso(-1),
    openFlags: 0,
    deletionRequested: false,
    ...over,
  };
}

const rows: StudentRow[] = [
  row({ id: "1", name: "Aisha", email: "aisha@qu.edu.qa", institution: "Qatar University", latestPercent: 72, latestBand: "competitive", enrolledUntil: iso(10), lastActiveAt: iso(-1), getReadyPercent: 100, getReadyDoneAt: iso(-5), createdAt: iso(-20) }),
  row({ id: "2", name: "Bilal", nameAr: "بلال", institution: "qatar university", createdAt: iso(-30), getReadyPercent: 50, openFlags: 2 }),
  row({ id: "3", name: "Carla", phone: "+97455555555", institution: "UDST", createdAt: iso(-2), enrolledUntil: iso(-1), latestPercent: 30, latestBand: "beginner" }),
  row({ id: "4", nameAr: "دانة", createdAt: iso(-40), getReadyBypass: true }),
];

describe("parseStudentFilters / studentFilterParams", () => {
  it("reads known params and ignores junk", () => {
    const f = parseStudentFilters({ q: "  ai ", band: "competitive", enrolled: "yes", stuck: "1", flagged: "true", sort: "name", dir: "asc", institution: ["UDST", "x"] });
    expect(f).toEqual({ q: "ai", institution: "UDST", band: "competitive", enrolled: "yes", stuck: true, flagged: true, sort: "name", dir: "asc" });
    expect(parseStudentFilters({ band: "wizard", enrolled: "maybe", sort: "drop", dir: "up", stuck: "0" })).toEqual(EMPTY_STUDENT_FILTERS);
    expect(parseStudentFilters(null)).toEqual(EMPTY_STUDENT_FILTERS);
  });

  it("accepts stored jsonb booleans", () => {
    expect(parseStudentFilters({ stuck: true, flagged: false }).stuck).toBe(true);
  });

  it("round-trips through URL params, dropping defaults", () => {
    const f = parseStudentFilters({ q: "x", band: "none", flagged: "1", sort: "score" });
    expect(studentFilterParams(f)).toEqual({ q: "x", band: "none", flagged: "1", sort: "score" });
    expect(parseStudentFilters(studentFilterParams(f))).toEqual(f);
    expect(studentFilterParams(EMPTY_STUDENT_FILTERS)).toEqual({});
  });

  it("caps long input", () => {
    expect(parseStudentFilters({ q: "a".repeat(500) }).q).toHaveLength(100);
  });
});

describe("matching", () => {
  const f = (over: Record<string, string>) => filterStudents(rows, parseStudentFilters(over), NOW).map((r) => r.id);

  it("searches name, Arabic name, email, phone and institution", () => {
    expect(f({ q: "AISHA" })).toEqual(["1"]);
    expect(f({ q: "بلال" })).toEqual(["2"]);
    expect(f({ q: "9745555" })).toEqual(["3"]);
    expect(f({ q: "qu.edu" })).toEqual(["1"]);
  });

  it("filters institution case-insensitively", () => {
    expect(f({ institution: "Qatar University" }).sort()).toEqual(["1", "2"]);
  });

  it("filters band, including no result yet", () => {
    expect(f({ band: "beginner" })).toEqual(["3"]);
    expect(f({ band: "none" }).sort()).toEqual(["2", "4"]);
  });

  it("enrolled means an end date in the future", () => {
    expect(f({ enrolled: "yes" })).toEqual(["1"]);
    expect(f({ enrolled: "no" }).sort()).toEqual(["2", "3", "4"]);
    expect(isEnrolled({ enrolledUntil: iso(-1) }, NOW)).toBe(false);
  });

  it("stuck = Get Ready not done, not bypassed, signed up over 7 days ago", () => {
    expect(f({ stuck: "1" })).toEqual(["2"]);
    expect(isStuckInGetReady({ getReadyDoneAt: null, getReadyBypass: false, getReadyPercent: 0, createdAt: iso(-7) }, NOW)).toBe(false);
    expect(isStuckInGetReady({ getReadyDoneAt: null, getReadyBypass: false, getReadyPercent: 0, createdAt: "bad" }, NOW)).toBe(false);
  });

  it("flagged = open integrity flags", () => {
    expect(f({ flagged: "1" })).toEqual(["2"]);
  });
});

describe("sortStudents", () => {
  it("sorts by name with Arabic and email fallbacks", () => {
    expect(sortStudents(rows, "name", "asc").map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("puts students without a result last when sorting score descending", () => {
    expect(sortStudents(rows, "score", "desc").map((r) => r.id)).toEqual(["1", "3", "2", "4"]);
  });
  it("defaults to newest sign-up first and breaks ties by id", () => {
    expect(filterStudents(rows, EMPTY_STUDENT_FILTERS, NOW).map((r) => r.id)).toEqual(["3", "1", "2", "4"]);
    const tie = [row({ id: "b", createdAt: iso(-1) }), row({ id: "a", createdAt: iso(-1) })];
    expect(sortStudents(tie, "created", "desc").map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("institutionsOf", () => {
  it("dedupes case-insensitively and sorts", () => {
    expect(institutionsOf(rows)).toEqual(["Qatar University", "UDST"]);
  });
});

describe("CSV", () => {
  it("neutralises formulas and doubles quotes", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("+974")).toBe(`"'+974"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(csvCell(null)).toBe(`""`);
  });

  it("fills contact columns only with marketing consent", () => {
    const csv = studentsCsv([
      row({ id: "x", name: "Yes", email: "yes@x.qa", phone: "+97450000000", marketingConsent: true }),
      row({ id: "y", name: "No", email: "no@x.qa", phone: "+97451111111", marketingConsent: false }),
    ]);
    expect(csv.startsWith("﻿id,name,")).toBe(true);
    const [, yes, no] = csv.trim().split("\r\n");
    expect(yes).toContain(`"yes@x.qa"`);
    expect(yes).toContain(`"'+97450000000"`);
    expect(no).not.toContain("no@x.qa");
    expect(no).not.toContain("51111111");
    expect(no.endsWith(`"no","",""`)).toBe(true);
  });
});
