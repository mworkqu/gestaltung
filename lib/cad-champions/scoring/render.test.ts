import { describe, expect, it } from "vitest";

import { renderFinalScoreEmail, renderResultsReadyEmail } from "./emails";
import { radarGeometry, radarSvgMarkup, wrapLabel } from "./radar";
import { buildReportHtml, type ReportData, type ReportStrings } from "./report-html";

const AXES = [1, 2, 3, 4, 5, 6].map((id) => ({ id, label: `Area ${id}`, percent: id === 3 ? 80 : id === 6 ? 40 : null }));

describe("radar", () => {
  it("draws six axes, value polygon over all axes, unassessed at the centre", () => {
    const g = radarGeometry(AXES, 360);
    expect(g.axes).toHaveLength(6);
    expect(g.axes.filter((a) => a.assessed).map((a) => a.id)).toEqual([3, 6]);
    expect(g.valuePolygon?.split(" ")).toHaveLength(6);
    const unassessed = g.axes.find((a) => a.id === 1)!;
    expect(unassessed.vx).toBeCloseTo(g.cx);
    expect(unassessed.vy).toBeCloseTo(g.cy);
    // area 1 at the top, centred label
    expect(unassessed.anchor).toBe("middle");
    expect(unassessed.y).toBeLessThan(g.cy);
  });

  it("has no value polygon when nothing is assessed", () => {
    expect(radarGeometry(AXES.map((a) => ({ ...a, percent: null }))).valuePolygon).toBeNull();
  });

  it("wraps long labels into at most two lines", () => {
    expect(wrapLabel("Technical drawing (ISO, first-angle, GD&T)").length).toBe(2);
    expect(wrapLabel("3D modelling")).toEqual(["3D modelling"]);
  });

  it("static markup escapes text and dashes unassessed axes", () => {
    const svg = radarSvgMarkup([{ id: 1, label: "A & <B>", percent: null }, ...AXES.slice(1)], { title: "Map", notAssessed: "Not assessed" });
    expect(svg).toContain("A &amp; &lt;B&gt;");
    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(svg).toContain('direction="ltr"');
  });
});

describe("result emails", () => {
  const base = {
    name: "Sara",
    testTitleEn: "Free skills test",
    testTitleAr: "اختبار المهارات المجاني",
    percent: 55,
    band: "developing" as const,
    url: "https://gestaltung360.com/cad-champions/en/results/abc",
  };

  it("results ready: Arabic first, English block, one button, plain text", () => {
    const m = renderResultsReadyEmail({ ...base, provisional: false });
    expect(m.subject).toContain("Your results are ready");
    expect(m.html.indexOf("نتائجك جاهزة")).toBeLessThan(m.html.indexOf("Your results are ready"));
    expect(m.html).toContain('dir="rtl"');
    expect(m.html.match(/href="https:\/\/gestaltung360\.com\/cad-champions\/en\/results\/abc"/g)?.length).toBe(1);
    expect(m.text).toContain("55%");
    expect(m.text).toContain("https://gestaltung360.com/cad-champions/en/results/abc");
    expect(m.text).not.toContain("trainer still needs");
  });

  it("results ready (provisional) mentions the trainer review", () => {
    const m = renderResultsReadyEmail({ ...base, provisional: true });
    expect(m.text).toContain("A trainer still needs to confirm your drawing");
  });

  it("final score shows the change", () => {
    const m = renderFinalScoreEmail({ ...base, percent: 58.5, previousPercent: 55 });
    expect(m.subject).toContain("Your final score is confirmed");
    expect(m.text).toContain("from 55% to 58.5% (+3.5%)");
    const same = renderFinalScoreEmail({ ...base, previousPercent: 55 });
    expect(same.text).toContain("did not change");
  });
});

describe("report html", () => {
  const strings: ReportStrings = {
    title: "Report",
    name: "Name",
    date: "Date",
    test: "Test",
    overall: "Overall",
    band: "Band",
    skillMap: "Skill map",
    area: "Area",
    weight: "Weight",
    score: "Score",
    level: "Level",
    top3: "Top 3",
    provisional: "Provisional",
    disclaimer: "Disclaimer",
    notAssessed: "Not assessed",
    chartLabel: "Chart",
    htmlNote: "Print me",
    print: "Print",
  };
  const data: ReportData = {
    lang: "ar",
    studentName: "سارة",
    dateText: "14 أكتوبر 2026",
    testTitle: "اختبار",
    overallText: "55%",
    bandName: "في تطوّر",
    bandMeaning: "لديك الأساسيات.",
    provisional: true,
    areas: AXES.map((a) => ({
      id: a.id,
      name: a.label,
      shortName: a.label,
      weightText: "30%",
      scoreText: a.percent == null ? null : `${a.percent}%`,
      levelText: a.percent == null ? null : "L3",
      percent: a.percent,
    })),
    recommendations: ["one", "two", "three", "four"],
  };

  it("is RTL for Arabic, loads IBM Plex Sans Arabic, inlines the radar", () => {
    const html = buildReportHtml(data, strings);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("IBM+Plex+Sans+Arabic");
    expect(html).toContain("<svg");
    expect(html).toContain("Provisional");
    expect(html).not.toContain("Print me");
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
  });

  it("adds the print note only in the HTML fallback", () => {
    expect(buildReportHtml({ ...data, lang: "en" }, strings, { fallbackNote: true })).toContain("Print me");
  });
});
