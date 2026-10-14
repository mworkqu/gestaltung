// One-page skills report as a self-contained HTML document (Prompt 7 Step D).
// PURE (tested). Inline CSS, the radar as inline SVG, IBM Plex Sans Arabic
// from Google Fonts, dir="rtl" for Arabic. The report route prints it to PDF
// with headless Chromium when available, else serves this HTML as a download.

import { radarSvgMarkup } from "./radar";

export interface ReportStrings {
  title: string;
  name: string;
  date: string;
  test: string;
  overall: string;
  band: string;
  skillMap: string;
  area: string;
  weight: string;
  score: string;
  level: string;
  top3: string;
  provisional: string;
  disclaimer: string;
  notAssessed: string;
  chartLabel: string;
  /** Shown only in the HTML fallback (hidden when printed). */
  htmlNote?: string;
  print?: string;
}

export interface ReportData {
  lang: "en" | "ar";
  studentName: string | null;
  dateText: string;
  testTitle: string;
  overallText: string;
  bandName: string;
  bandMeaning: string;
  provisional: boolean;
  areas: { id: number; name: string; shortName: string; weightText: string; scoreText: string | null; levelText: string | null; percent: number | null }[];
  recommendations: string[];
}

function e(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function buildReportHtml(d: ReportData, s: ReportStrings, opts: { fallbackNote?: boolean } = {}): string {
  const ar = d.lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const font = ar ? "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif" : "'IBM Plex Sans Arabic', Arial, Helvetica, sans-serif";
  const radar = radarSvgMarkup(
    d.areas.map((a) => ({ id: a.id, label: a.shortName, percent: a.percent })),
    { title: s.chartLabel, notAssessed: s.notAssessed, size: 320, font, rtl: ar }
  );
  const rows = d.areas
    .map(
      (a) =>
        `<tr><th scope="row">${e(a.name)}</th><td class="num">${e(a.weightText)}</td><td class="num">${a.scoreText ? e(a.scoreText) : `<span class="muted">${e(s.notAssessed)}</span>`}</td><td class="num">${a.levelText ? e(a.levelText) : "—"}</td></tr>`
    )
    .join("");
  const recs = d.recommendations
    .slice(0, 3)
    .map((r) => `<li>${e(r)}</li>`)
    .join("");
  const note =
    opts.fallbackNote && s.htmlNote
      ? `<div class="note no-print"><p>${e(s.htmlNote)}</p><button type="button" onclick="window.print()">${e(s.print ?? "Print")}</button></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="${d.lang}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${e(s.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #1c2434; font-family: ${font}; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 186mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #0e59c5; padding-bottom: 8px; margin-bottom: 12px; }
.brand { font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 18px; direction: ltr; unicode-bidi: isolate; }
.brand span { color: #0e59c5; }
h1 { font-size: 18px; margin: 0; }
.facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.fact { background: #eef2f7; border: 1px solid #d3dbe6; border-radius: 8px; padding: 8px 10px; }
.fact .k { font-size: 10px; color: #5a6677; }
.fact .v { font-size: 14px; font-weight: 700; }
.fact .big { font-size: 22px; }
.meaning { margin: 0 0 10px; font-weight: 600; }
.provisional { margin: 0 0 10px; padding: 6px 10px; border-radius: 6px; background: #fff6e5; border: 1px solid #f2d39b; color: #7a4a00; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
h2 { font-size: 13px; margin: 0 0 6px; }
.radar svg { width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 5px 4px; border-bottom: 1px solid #e6ebf2; text-align: start; }
thead th { font-size: 10px; color: #5a6677; font-weight: 600; }
tbody th { font-weight: 600; }
.num { white-space: nowrap; direction: ltr; unicode-bidi: isolate; text-align: ${ar ? "right" : "left"}; }
.muted { color: #94a3b8; font-weight: 400; }
ol { margin: 0; padding-inline-start: 18px; }
ol li { margin-bottom: 4px; }
footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d3dbe6; font-size: 9.5px; color: #5a6677; }
.note { margin: 0 0 12px; padding: 10px; border: 1px dashed #0e59c5; border-radius: 8px; background: #eef4fd; }
.note button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 0; background: #0e59c5; color: #fff; cursor: pointer; }
@media print { .no-print { display: none !important; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">
${note}
<header><h1>${e(s.title)}</h1><div class="brand">Gestaltung<span>360</span> · CAD Champions</div></header>
<div class="facts">
  <div class="fact"><div class="k">${e(s.name)}</div><div class="v">${e(d.studentName ?? "—")}</div></div>
  <div class="fact"><div class="k">${e(s.date)}</div><div class="v">${e(d.dateText)}</div></div>
  <div class="fact"><div class="k">${e(s.overall)}</div><div class="v big"><span class="num">${e(d.overallText)}</span></div></div>
  <div class="fact"><div class="k">${e(s.band)}</div><div class="v">${e(d.bandName)}</div></div>
</div>
<p class="meaning">${e(s.test)}: ${e(d.testTitle)} · ${e(d.bandMeaning)}</p>
${d.provisional ? `<p class="provisional">${e(s.provisional)}</p>` : ""}
<div class="grid">
  <section class="radar"><h2>${e(s.skillMap)}</h2>${radar}</section>
  <section>
    <table>
      <thead><tr><th scope="col">${e(s.area)}</th><th scope="col">${e(s.weight)}</th><th scope="col">${e(s.score)}</th><th scope="col">${e(s.level)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${recs ? `<h2 style="margin-top:12px">${e(s.top3)}</h2><ol>${recs}</ol>` : ""}
  </section>
</div>
<footer>${e(s.disclaimer)}</footer>
</div>
</body>
</html>`;
}
