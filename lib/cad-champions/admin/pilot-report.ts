// Pilot report (Prompt 11 Step E, COMPETITION_ALIGNMENT P "Task 11"): an
// anonymised, printable summary of the Insights page for the organisers.
// PURE (tested in pilot-report.test.ts).
//
// Anonymity by construction: buildPilotReport() reads only the aggregate
// InsightsData (numbers and enum labels). Students never appear; institutions
// are reduced to a COUNT plus bars labelled "Institution 1, 2, ..." in size
// order (never the names). buildPilotReportHtml() just prints what it is
// given. containsPersonalData() is a guard used by the tests.

import type { ErrorRate, InsightsData } from "./insights";
import { FUNNEL_STEPS, type FunnelStepId } from "./funnel";

// ─── what the page prints ─────────────────────────────────────────────────

export interface ReportBar {
  label: string;
  value: number;
  /** Text after the bar, e.g. "42 %" or "12". */
  display: string;
  highlight?: boolean;
}

export interface ReportSection {
  id: string;
  title: string;
  note?: string;
  bars?: ReportBar[];
  /** Full-scale value for the bars (e.g. 100 for percentages). */
  barsMax?: number;
  table?: { head: string[]; rows: string[][] };
  /** Shown when the section has no data. */
  empty: string;
}

export interface PilotReportData {
  lang: "en" | "ar";
  title: string;
  subtitle: string;
  rangeLabel: string;
  rangeText: string;
  generatedLabel: string;
  generatedText: string;
  kpis: { label: string; value: string }[];
  sections: ReportSection[];
  disclaimer: string;
  /** Shown only in the HTML fallback (hidden when printed). */
  htmlNote?: string;
  printLabel?: string;
}

// ─── strings and formatters (the route fills these from messages) ─────────

export interface PilotText {
  title: string;
  subtitle: string;
  rangeLabel: string;
  generatedLabel: string;
  disclaimer: string;
  htmlNote: string;
  print: string;
  kpiStudents: string;
  kpiGetReady: string;
  kpiTests: string;
  kpiPaid: string;
  funnelTitle: string;
  funnelNote: string;
  funnelWeekly: string;
  funnelWeek: string;
  stopsTitle: string;
  stopsNote: string;
  skillsTitle: string;
  skillsNote: string;
  modulesTitle: string;
  modulesNote: string;
  improvementTitle: string;
  improvementStudents: string;
  improvementImproved: string;
  improvementFirst: string;
  improvementLatest: string;
  improvementGain: string;
  whoTitle: string;
  whoLevels: string;
  whoInstitutions: string;
  whoInstitutionsNote: string;
  healthTitle: string;
  healthAuto: string;
  healthAvgTime: string;
  healthFailed: string;
  healthAi: string;
  healthAiCost: string;
  healthBacklog: string;
  healthReview: string;
  healthErrors: string;
  empty: string;
}

export interface PilotContext {
  lang: "en" | "ar";
  t: PilotText;
  /** Locale-formatted counts (Western digits). */
  num: (n: number) => string;
  pct: (n: number) => string;
  date: (ymd: string) => string;
  generatedText: string;
  stepName: (id: FunnelStepId) => string;
  getReadyName: (key: string) => string;
  skillName: (id: number) => string;
  moduleName: (code: string) => string;
  levelName: (key: string) => string;
  institutionLabel: (n: number) => string;
  duration: (ms: number) => string;
  hours: (h: number) => string;
  usd: (n: number) => string;
}

const MAX_INSTITUTION_BARS = 8;
const MAX_ERROR_BARS = 8;

/** Institutions as anonymous, size-ordered entries: the names are dropped. */
export function anonymiseInstitutions(items: readonly { count: number }[]): { count: number }[] {
  return items.map((i) => ({ count: i.count })).sort((a, b) => b.count - a.count);
}

function errorBars(errors: readonly ErrorRate[], ctx: PilotContext): ReportBar[] {
  return errors.slice(0, MAX_ERROR_BARS).map((e) => ({
    label: e.code,
    value: e.count,
    display: e.ratePct == null ? ctx.num(e.count) : `${ctx.num(e.count)} · ${ctx.pct(e.ratePct)}`,
  }));
}

export function buildPilotReport(data: InsightsData, ctx: PilotContext, opts: { fallbackNote?: boolean } = {}): PilotReportData {
  const t = ctx.t;
  const sections: ReportSection[] = [];

  // Funnel: totals as bars, weeks as a table.
  const f = data.funnel;
  sections.push({
    id: "funnel",
    title: t.funnelTitle,
    note: t.funnelNote,
    barsMax: f && f.total > 0 ? f.total : undefined,
    bars:
      f && f.total > 0
        ? f.totals.map((s) => ({
            label: ctx.stepName(s.id),
            value: s.count,
            display: s.ofSignedUpPct == null ? ctx.num(s.count) : `${ctx.num(s.count)} · ${ctx.pct(s.ofSignedUpPct)}`,
          }))
        : undefined,
    table:
      f && f.weeks.length > 0
        ? {
            head: [t.funnelWeek, ...FUNNEL_STEPS.map((id) => ctx.stepName(id))],
            rows: f.weeks.map((w) => [ctx.date(w.weekStart), ...w.steps.map((s) => ctx.num(s.count))]),
          }
        : undefined,
    empty: t.empty,
  });

  sections.push({
    id: "stops",
    title: t.stopsTitle,
    note: t.stopsNote,
    bars: data.getReadyStops && data.getReadyStops.some((s) => s.count > 0) ? data.getReadyStops.map((s) => ({ label: ctx.getReadyName(s.key), value: s.count, display: ctx.num(s.count) })) : undefined,
    empty: t.empty,
  });

  const skillsWithData = (data.skills ?? []).filter((s) => s.average != null);
  sections.push({
    id: "skills",
    title: t.skillsTitle,
    note: t.skillsNote,
    barsMax: 100,
    bars: skillsWithData.length ? skillsWithData.map((s) => ({ label: ctx.skillName(s.skillAreaId), value: s.average as number, display: ctx.pct(s.average as number), highlight: s.weakest })) : undefined,
    empty: t.empty,
  });

  const modulesWithData = (data.modules ?? []).filter((m) => m.average != null);
  sections.push({
    id: "modules",
    title: t.modulesTitle,
    note: t.modulesNote,
    barsMax: 100,
    bars: modulesWithData.length ? modulesWithData.map((m) => ({ label: ctx.moduleName(m.module), value: m.average as number, display: ctx.pct(m.average as number) })) : undefined,
    empty: t.empty,
  });

  const imp = data.improvement;
  sections.push({
    id: "improvement",
    title: t.improvementTitle,
    table:
      imp && imp.students > 0
        ? {
            head: [t.improvementTitle, ""],
            rows: [
              [t.improvementStudents, ctx.num(imp.students)],
              [t.improvementImproved, ctx.num(imp.improved)],
              [t.improvementFirst, imp.averageFirst == null ? "-" : ctx.pct(imp.averageFirst)],
              [t.improvementLatest, imp.averageLatest == null ? "-" : ctx.pct(imp.averageLatest)],
              [t.improvementGain, imp.averageGain == null ? "-" : `${imp.averageGain > 0 ? "+" : ""}${ctx.num(imp.averageGain)}`],
            ],
          }
        : undefined,
    empty: t.empty,
  });

  // Who took part: study levels (enum labels) + institutions as counts only.
  const levels = data.studyLevels;
  const inst = data.institutions ? anonymiseInstitutions(data.institutions.items) : [];
  sections.push({
    id: "who",
    title: t.whoTitle,
    note: inst.length ? `${t.whoInstitutions}: ${ctx.num(inst.length)}. ${t.whoInstitutionsNote}` : undefined,
    bars:
      levels && levels.items.length
        ? levels.items.map((l) => ({ label: ctx.levelName(l.label), value: l.count, display: ctx.num(l.count) }))
        : undefined,
    table: inst.length
      ? {
          head: [t.whoInstitutions, ""],
          rows: inst.slice(0, MAX_INSTITUTION_BARS).map((i, idx) => [ctx.institutionLabel(idx + 1), ctx.num(i.count)]),
        }
      : undefined,
    empty: t.empty,
  });

  const h = data.health;
  sections.push({
    id: "health",
    title: t.healthTitle,
    table: h
      ? {
          head: [t.healthTitle, ""],
          rows: [
            [t.healthAuto, ctx.num(h.grading.autoGraded)],
            [t.healthAvgTime, h.grading.avgDurationMs == null ? "-" : ctx.duration(h.grading.avgDurationMs)],
            [t.healthFailed, ctx.num(h.grading.failed)],
            [t.healthAi, ctx.num(h.ai.checks)],
            [t.healthAiCost, ctx.usd(h.ai.costUsd)],
            [t.healthBacklog, h.backlog == null ? "-" : ctx.num(h.backlog)],
            [t.healthReview, h.avgReviewHours == null ? "-" : ctx.hours(h.avgReviewHours)],
          ],
        }
      : undefined,
    bars: h && h.grading.errors.length ? errorBars(h.grading.errors, ctx) : undefined,
    note: h && h.grading.errors.length ? t.healthErrors : undefined,
    empty: t.empty,
  });

  const total = f?.total ?? data.students;
  const kpis = [
    { label: t.kpiStudents, value: total == null ? "-" : ctx.num(total) },
    { label: t.kpiGetReady, value: f && f.total > 0 ? ctx.pct(f.totals[1].ofSignedUpPct ?? 0) : "-" },
    { label: t.kpiTests, value: f && f.total > 0 ? ctx.num(f.totals[3].count) : "-" },
    { label: t.kpiPaid, value: f && f.total > 0 ? ctx.num(f.totals[6].count) : "-" },
  ];

  return {
    lang: ctx.lang,
    title: t.title,
    subtitle: t.subtitle,
    rangeLabel: t.rangeLabel,
    rangeText: `${ctx.date(data.range.from)} - ${ctx.date(data.range.to)}`,
    generatedLabel: t.generatedLabel,
    generatedText: ctx.generatedText,
    kpis,
    sections,
    disclaimer: t.disclaimer,
    htmlNote: opts.fallbackNote ? t.htmlNote : undefined,
    printLabel: t.print,
  };
}

// ─── HTML ─────────────────────────────────────────────────────────────────

function e(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function barsSvg(bars: readonly ReportBar[], max: number | undefined, rtl: boolean): string {
  const top = Math.max(max ?? 0, ...bars.map((b) => b.value), 0);
  if (top <= 0) return "";
  const rows = bars
    .map((b) => {
      const pct = Math.max(0, Math.min(100, (b.value / top) * 100));
      const fill = b.highlight ? "#d97706" : "#0e59c5";
      const flip = rtl ? ` transform="translate(100,0) scale(-1,1)"` : "";
      return `<div class="bar"><span class="bl">${e(b.label)}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${e(`${b.label}: ${b.display}`)}"><g${flip}><rect x="0" y="0" width="100" height="10" rx="2" fill="#e6ebf2"/><rect x="0" y="0" width="${pct.toFixed(2)}" height="10" rx="2" fill="${fill}"/></g></svg><span class="bv">${e(b.display)}</span></div>`;
    })
    .join("");
  return `<div class="bars">${rows}</div>`;
}

function tableHtml(t: { head: string[]; rows: string[][] }): string {
  const head = t.head.map((h) => `<th scope="col">${e(h)}</th>`).join("");
  const body = t.rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${e(c)}</th>` : `<td class="num">${e(c)}</td>`)).join("")}</tr>`)
    .join("");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function buildPilotReportHtml(d: PilotReportData): string {
  const ar = d.lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const font = ar ? "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif" : "'IBM Plex Sans Arabic', Arial, Helvetica, sans-serif";
  const note = d.htmlNote
    ? `<div class="note no-print"><p>${e(d.htmlNote)}</p><button type="button" onclick="window.print()">${e(d.printLabel ?? "Print")}</button></div>`
    : "";
  const kpis = d.kpis.map((k) => `<div class="fact"><div class="k">${e(k.label)}</div><div class="v"><span class="num">${e(k.value)}</span></div></div>`).join("");
  const sections = d.sections
    .map((s) => {
      const has = !!(s.bars && s.bars.length) || !!s.table;
      const inner = has
        ? `${s.bars && s.bars.length ? barsSvg(s.bars, s.barsMax, ar) : ""}${s.table ? tableHtml(s.table) : ""}`
        : `<p class="muted">${e(s.empty)}</p>`;
      return `<section class="sec" id="${e(s.id)}"><h2>${e(s.title)}</h2>${s.note ? `<p class="secnote">${e(s.note)}</p>` : ""}${inner}</section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${d.lang}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${e(d.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #1c2434; font-family: ${font}; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 186mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 3px solid #0e59c5; padding-bottom: 8px; margin-bottom: 10px; }
.brand { font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 18px; direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
.brand span { color: #0e59c5; }
h1 { font-size: 18px; margin: 0; }
.sub { margin: 0 0 4px; color: #5a6677; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 10px; font-size: 11px; color: #5a6677; }
.meta b { color: #1c2434; }
.facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.fact { background: #eef2f7; border: 1px solid #d3dbe6; border-radius: 8px; padding: 8px 10px; }
.fact .k { font-size: 10px; color: #5a6677; }
.fact .v { font-size: 20px; font-weight: 700; }
.sec { margin: 0 0 14px; break-inside: avoid; }
h2 { font-size: 13px; margin: 0 0 4px; }
.secnote { margin: 0 0 6px; font-size: 10.5px; color: #5a6677; }
.bar { display: grid; grid-template-columns: 34% 1fr 22%; align-items: center; gap: 8px; margin-bottom: 4px; }
.bar svg { width: 100%; height: 12px; display: block; }
.bl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bv { font-weight: 700; direction: ltr; unicode-bidi: isolate; text-align: start; white-space: nowrap; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 4px 4px; border-bottom: 1px solid #e6ebf2; text-align: start; }
thead th { font-size: 10px; color: #5a6677; font-weight: 600; }
tbody th { font-weight: 600; }
.num { white-space: nowrap; direction: ltr; unicode-bidi: isolate; }
td.num { text-align: ${ar ? "right" : "left"}; }
.muted { color: #94a3b8; margin: 0; }
footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d3dbe6; font-size: 9.5px; color: #5a6677; }
.note { margin: 0 0 12px; padding: 10px; border: 1px dashed #0e59c5; border-radius: 8px; background: #eef4fd; }
.note button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 0; background: #0e59c5; color: #fff; cursor: pointer; }
@media print { .no-print { display: none !important; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">
${note}
<header><h1>${e(d.title)}</h1><div class="brand">Gestaltung<span>360</span> · CAD Champions</div></header>
<p class="sub">${e(d.subtitle)}</p>
<p class="meta"><span>${e(d.rangeLabel)}: <b class="num">${e(d.rangeText)}</b></span><span>${e(d.generatedLabel)}: <b class="num">${e(d.generatedText)}</b></span></p>
<div class="facts">${kpis}</div>
${sections}
<footer>${e(d.disclaimer)}</footer>
</div>
</body>
</html>`;
}

// ─── guard ────────────────────────────────────────────────────────────────

/** True when the text looks like it holds an email address or a phone number. */
export function containsPersonalData(text: string): boolean {
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) return true;
  if (/\+\d[\d\s-]{7,}\d/.test(text)) return true;
  if (/\b\d{8,}\b/.test(text)) return true;
  return false;
}
