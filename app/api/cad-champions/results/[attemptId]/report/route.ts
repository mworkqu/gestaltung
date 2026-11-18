import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { loadResultsView } from "@/lib/cad-champions/scoring/load";
import { buildReportHtml, type ReportData, type ReportStrings } from "@/lib/cad-champions/scoring/report-html";

// GET /api/cad-champions/results/[attemptId]/report?lang=en|ar
// Session-checked (owner or staff). One-page report in the requested language.
// PDF via headless Chromium (playwright) when it is installed — local / dev
// only: playwright is a devDependency and is NOT deployed. Otherwise the same
// page is returned as an .html download the student can print to PDF.
// See docs/cad-champions/RESULTS.md ([TODO-MO] choose a PDF renderer for Vercel).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

type PlaywrightLike = {
  chromium: {
    launch: (o?: { headless?: boolean }) => Promise<{
      newPage: () => Promise<{
        setContent: (html: string, o?: { waitUntil?: string; timeout?: number }) => Promise<void>;
        evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
        pdf: (o: Record<string, unknown>) => Promise<Uint8Array>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

/** Loads playwright at runtime without bundling it (it is a devDependency). */
async function loadPlaywright(): Promise<PlaywrightLike | null> {
  if (process.env.CC_REPORT_PDF === "off") return null;
  try {
    const name = "playwright";
    const mod = (await import(/* webpackIgnore: true */ name)) as PlaywrightLike & { default?: PlaywrightLike };
    return mod?.chromium ? mod : (mod.default ?? null);
  } catch {
    return null;
  }
}

async function htmlToPdf(html: string): Promise<Uint8Array | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;
  let browser: Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>> | null = null;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 20_000 });
    await page.evaluate(() => (document as Document).fonts.ready.then(() => true));
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  } catch (e) {
    console.warn("[cc-report] pdf render failed, serving HTML:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const lang: Locale = new URL(req.url).searchParams.get("lang") === "ar" ? "ar" : "en";
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: NO_STORE });

  const loaded = await loadResultsView(attemptId, lang);
  if (!loaded.ok || (loaded.view.userId !== cc.user.id && !cc.isStaff)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const v = loaded.view;
  if ((v.status !== "provisional" && v.status !== "graded") || v.percent == null || !v.band) {
    return Response.json({ error: "not_ready" }, { status: 409, headers: NO_STORE });
  }

  try {
    const t = await getTranslations({ locale: lang, namespace: "CC.results" });
    const pct = (n: number) => `${formatNumber(Math.round(n), lang)}%`;
    const strings: ReportStrings = {
      title: t("report.title"),
      name: t("report.name"),
      date: t("report.date"),
      test: t("report.test"),
      overall: t("report.overall"),
      band: t("report.band"),
      skillMap: t("report.skillMap"),
      area: t("report.area"),
      weight: t("report.weight"),
      score: t("report.score"),
      level: t("report.level"),
      top3: t("report.top3"),
      provisional: t("report.provisional"),
      disclaimer: t("report.disclaimer"),
      notAssessed: t("skillMap.notAssessedShort"),
      chartLabel: t("skillMap.chartLabel"),
      htmlNote: t("report.htmlNote"),
      print: t("report.print"),
    };
    const data: ReportData = {
      lang,
      studentName: v.studentName,
      dateText: formatDate(v.submittedAt ?? v.startedAt, lang),
      testTitle: v.test.title,
      overallText: pct(v.percent),
      bandName: t(`band.${v.band}.name`),
      bandMeaning: t(`band.${v.band}.meaning`),
      provisional: v.status === "provisional",
      areas: v.areas.map((a) => ({
        id: a.id,
        name: a.name,
        shortName: t(`areaShort.${a.id}` as "areaShort.1"),
        weightText: `${formatNumber(a.weight, lang)}%`,
        scoreText: a.assessed && a.percent != null ? pct(a.percent) : null,
        levelText: a.level ? t("skillMap.levelValue", { level: String(a.level) }) : null,
        percent: a.assessed ? a.percent : null,
      })),
      recommendations: v.path.slice(0, 3).map((s) =>
        t(`path.reason.${s.reasonKey}`, {
          area: t(`areaShort.${s.skillAreaId}` as "areaShort.1"),
          weight: formatNumber(s.weight, lang),
          percent: formatNumber(Math.round(s.percent), lang),
        })
      ),
    };

    const base = `cad-champions-report-${lang}`;
    const pdf = await htmlToPdf(buildReportHtml(data, strings));
    if (pdf) {
      return new Response(Buffer.from(pdf), {
        headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
      });
    }
    return new Response(buildReportHtml(data, strings, { fallbackNote: true }), {
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.html"`, "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    console.error("[cc-report] failed:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "error" }, { status: 500, headers: NO_STORE });
  }
}
