import { describe, expect, it } from "vitest";

import { buildFunnel } from "./funnel";
import type { InsightsData } from "./insights";
import { anonymiseInstitutions, buildPilotReport, buildPilotReportHtml, containsPersonalData, type PilotContext, type PilotText } from "./pilot-report";

const text: PilotText = new Proxy({} as PilotText, { get: (_t, k) => `T:${String(k)}` });

const ctx: PilotContext = {
  lang: "en",
  t: text,
  num: (n) => String(n),
  pct: (n) => `${n} %`,
  date: (d) => d,
  generatedText: "2026-10-14",
  stepName: (id) => `step ${id}`,
  getReadyName: (k) => `gr ${k}`,
  skillName: (id) => `skill ${id}`,
  moduleName: (c) => `module ${c}`,
  levelName: (k) => `level ${k}`,
  institutionLabel: (n) => `Institution ${n}`,
  duration: (ms) => `${ms} ms`,
  hours: (h) => `${h} h`,
  usd: (n) => `$${n}`,
};

const data: InsightsData = {
  range: { from: "2026-07-27", to: "2026-10-14" },
  students: 3,
  funnel: buildFunnel(
    [
      { created_at: "2026-09-01T08:00:00Z", get_ready_completed_at: "2026-09-02T08:00:00Z", first_test_submitted_at: "2026-09-03T08:00:00Z" },
      { created_at: "2026-09-02T08:00:00Z" },
    ],
    { from: "2026-08-31", to: "2026-09-13" },
  ),
  stuckInGetReady: 1,
  getReadyStops: [{ key: "welcome_video", count: 1 }],
  skills: [
    { skillAreaId: 3, average: 70, samples: 2, weakest: false },
    { skillAreaId: 6, average: 40, samples: 2, weakest: true },
  ],
  skillAttempts: 2,
  modules: [{ module: "M1", attempts: 2, average: 55, earned: 11, max: 20 }],
  moduleAttempts: 2,
  improvement: { students: 2, improved: 1, averageFirst: 50, averageLatest: 60, averageGain: 10 },
  institutions: {
    items: [
      { label: "Secret Academy of Doha", count: 2 },
      { label: "Hidden University", count: 1 },
    ],
    unknown: 0,
    total: 3,
  },
  studyLevels: { items: [{ label: "bachelor", count: 2 }, { label: "diploma", count: 1 }], unknown: 0, total: 3 },
  health: {
    grading: { autoGraded: 5, failed: 1, totalRuns: 6, avgDurationMs: 2000, errors: [{ code: "E_NOT_STEP", count: 1, ratePct: 16.7, helpSlug: "my-file-was-rejected" }] },
    ai: { checks: 3, drawing: 2, translate: 1, costUsd: 0.015 },
    aiMonthStart: "2026-10-01",
    backlog: 4,
    reviewed: 2,
    avgReviewHours: 4,
  },
};

describe("anonymiseInstitutions", () => {
  it("keeps only the counts, largest first", () => {
    expect(anonymiseInstitutions([{ count: 1 }, { count: 4 }, { count: 2 }])).toEqual([{ count: 4 }, { count: 2 }, { count: 1 }]);
  });
});

describe("buildPilotReport", () => {
  const report = buildPilotReport(data, ctx);
  const html = buildPilotReportHtml(report);

  it("never prints institution names, only counts and positional labels", () => {
    const all = JSON.stringify(report) + html;
    expect(all).not.toContain("Secret Academy");
    expect(all).not.toContain("Hidden University");
    expect(all).toContain("Institution 1");
    expect(all).toContain("Institution 2");
  });

  it("contains no email or phone like text", () => {
    expect(containsPersonalData(html)).toBe(false);
  });

  it("flags personal data when it is present", () => {
    expect(containsPersonalData("mail me at a.b@example.com")).toBe(true);
    expect(containsPersonalData("call +974 5555 1234")).toBe(true);
    expect(containsPersonalData("55551234")).toBe(true);
    expect(containsPersonalData("2026-10-14 and 42 %")).toBe(false);
  });

  it("carries the branding, the range, the disclaimer and the charts", () => {
    expect(html).toContain("Gestaltung<span>360</span>");
    expect(html).toContain("2026-07-27 - 2026-10-14");
    expect(html).toContain("T:disclaimer");
    expect(html).toContain("<svg");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("noindex");
    // weakest skill is highlighted in amber
    expect(html).toContain("#d97706");
  });

  it("builds an RTL page for Arabic and the printable fallback note", () => {
    const ar = buildPilotReport(data, { ...ctx, lang: "ar" }, { fallbackNote: true });
    const out = buildPilotReportHtml(ar);
    expect(out).toContain('dir="rtl"');
    expect(out).toContain("window.print()");
    expect(out).toContain("scale(-1,1)");
  });

  it("shows the empty text when a section could not be loaded", () => {
    const empty = buildPilotReport({ ...data, funnel: null, skills: null, modules: null, improvement: null, health: null, institutions: null, studyLevels: null, getReadyStops: null }, ctx);
    const out = buildPilotReportHtml(empty);
    expect(out).toContain("T:empty");
    expect(empty.sections.every((s) => !s.bars && !s.table)).toBe(true);
  });

  it("escapes text", () => {
    const evil = buildPilotReport(data, { ...ctx, skillName: () => "<script>alert(1)</script>" });
    expect(buildPilotReportHtml(evil)).not.toContain("<script>alert(1)</script>");
  });
});
