import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { adminGuard } from "@/lib/cad-champions/admin/server";
import { parseInsightRange } from "@/lib/cad-champions/admin/funnel";
import { loadInsights } from "@/lib/cad-champions/admin/insights-server";
import { buildPilotReport, buildPilotReportHtml, type PilotContext, type PilotText } from "@/lib/cad-champions/admin/pilot-report";
import { formatDate, formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { htmlToPdf } from "@/lib/cad-champions/html-pdf";

// GET .../admin/insights/report?from=&to=&lang=en|ar
// The anonymised pilot report (no names, emails or phone numbers; institutions
// only as counts). Admin only, re-checked here. PDF through headless Chromium
// when it is installed (local only); otherwise the same page is returned as
// printable HTML (the browser's "Save as PDF"), like the results report.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const BASE_NAME = "cad-champions-pilot-report";
const LEVELS = ["secondary", "diploma", "bachelor", "graduate", "working"];

const one = (v: string | null): string | undefined => (v == null ? undefined : v);

export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const guard = await adminGuard("admin");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.error === "forbidden" ? 404 : 503, headers: NO_STORE });
  }

  const sp = req.nextUrl.searchParams;
  const lang: Locale = sp.get("lang") === "ar" || (sp.get("lang") == null && locale === "ar") ? "ar" : "en";
  const range = parseInsightRange(one(sp.get("from")), one(sp.get("to")));

  try {
    const loaded = await loadInsights(range);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.reason }, { status: loaded.reason === "not_set_up" ? 409 : 503, headers: NO_STORE });
    }
    const { data, labels } = loaded;

    const t = await getTranslations({ locale: lang, namespace: "CC.admin.insights" });
    const tf = await getTranslations({ locale: lang, namespace: "CC.shell.footer" });

    const text: PilotText = {
      title: t("report.title"),
      subtitle: t("report.subtitle"),
      rangeLabel: t("range.label"),
      generatedLabel: t("report.generated"),
      disclaimer: tf("disclaimer"),
      htmlNote: t("report.htmlNote"),
      print: t("report.print"),
      kpiStudents: t("report.kpiStudents"),
      kpiGetReady: t("report.kpiGetReady"),
      kpiTests: t("report.kpiTests"),
      kpiPaid: t("report.kpiPaid"),
      funnelTitle: t("funnel.title"),
      funnelNote: t("funnel.stepHelp"),
      funnelWeekly: t("funnel.weeksTitle"),
      funnelWeek: t("funnel.weekHeading"),
      stopsTitle: t("stops.title"),
      stopsNote: t("stops.purpose"),
      skillsTitle: t("skills.title"),
      skillsNote: t("skills.purpose"),
      modulesTitle: t("modules.title"),
      modulesNote: t("modules.purpose"),
      improvementTitle: t("improvement.title"),
      improvementStudents: t("improvement.students"),
      improvementImproved: t("improvement.improved"),
      improvementFirst: t("improvement.first"),
      improvementLatest: t("improvement.latest"),
      improvementGain: t("improvement.gain"),
      whoTitle: t("people.title"),
      whoLevels: t("people.levels"),
      whoInstitutions: t("people.institutions"),
      whoInstitutionsNote: t("report.institutionsNote"),
      healthTitle: t("grading.title"),
      healthAuto: t("grading.autoGraded"),
      healthAvgTime: t("grading.avgTime"),
      healthFailed: t("grading.failedRuns"),
      healthAi: t("grading.aiChecks"),
      healthAiCost: t("grading.aiCost"),
      healthBacklog: t("grading.backlog"),
      healthReview: t("grading.avgReview"),
      healthErrors: t("grading.errorsTitle"),
      empty: t("empty"),
    };

    const num = (n: number) => formatNumber(n, lang, { maximumFractionDigits: 1 });
    const nameFrom = (l: { en?: string; ar?: string } | undefined, fallback: string) => ((lang === "ar" ? l?.ar || l?.en : l?.en || l?.ar) ?? "") || fallback;
    const ctx: PilotContext = {
      lang,
      t: text,
      num,
      pct: (n) => `${num(n)} %`,
      date: (ymd) => formatDate(`${ymd}T12:00:00+03:00`, lang),
      generatedText: formatDateTime(new Date(), lang),
      stepName: (id) => t(`funnel.steps.${id}`),
      getReadyName: (key) => t(`stops.steps.${key}`),
      skillName: (id) => nameFrom(labels.skills.find((s) => s.id === id), `#${id}`),
      moduleName: (code) => {
        const n = nameFrom(labels.modules.find((m) => m.code === code), "");
        return n ? `${code} · ${n}` : code;
      },
      levelName: (key) => (LEVELS.includes(key) ? t(`people.levelNames.${key}`) : key),
      institutionLabel: (n) => t("report.institution", { n: formatNumber(n, lang) }),
      duration: (ms) => {
        const s = ms / 1000;
        if (s < 60) return t("grading.seconds", { value: num(s) });
        if (s < 3600) return t("grading.minutes", { value: num(s / 60) });
        return t("grading.hours", { value: num(s / 3600) });
      },
      hours: (h) => t("grading.hours", { value: num(h) }),
      usd: (n) => `$${formatNumber(n, lang, { maximumFractionDigits: 2 })}`,
    };

    const pdf = await htmlToPdf(buildPilotReportHtml(buildPilotReport(data, ctx)));
    if (pdf) {
      return new Response(Buffer.from(pdf), {
        headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${BASE_NAME}-${lang}.pdf"` },
      });
    }
    // No PDF renderer (Vercel): the printable page opens in the browser; Print -> Save as PDF.
    return new Response(buildPilotReportHtml(buildPilotReport(data, ctx, { fallbackNote: true })), {
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${BASE_NAME}-${lang}.html"`, "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    console.error("[cc-insights] pilot report failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "error" }, { status: 500, headers: NO_STORE });
  }
}
