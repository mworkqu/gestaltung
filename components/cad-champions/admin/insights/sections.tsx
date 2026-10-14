import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { BarChart, type Bar } from "@/components/cad-champions/admin/bar-chart";
import type { Locale } from "@/i18n/routing";
import { FUNNEL_STEPS } from "@/lib/cad-champions/admin/funnel";
import type { InsightsData } from "@/lib/cad-champions/admin/insights";
import type { InsightLabels } from "@/lib/cad-champions/admin/insights-server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

// The Insights sections (Prompt 11 Step E). Server components: every number
// is formatted here with Western digits; charts are the inline-SVG BarChart.
// A null section (its query failed) shows "Not available".

const cardCls = "neu space-y-4 p-5 sm:p-6";
const th = "px-3 py-2 text-start text-xs font-semibold text-mutedtext";
const td = "px-3 py-2 text-start text-sm text-body tabular-nums";

function useFmt() {
  const locale = useLocale() as Locale;
  const num = (n: number, max = 1) => formatNumber(n, locale, { maximumFractionDigits: max });
  const pct = (n: number) => `${num(n)} %`;
  return { locale, num, pct };
}

function Head({ title, purpose, help }: { title: string; purpose: string; help?: string }) {
  return (
    <header className="space-y-1">
      <h2 className="title-card">{title}</h2>
      <p className="text-sm text-body">{purpose}</p>
      {help ? <p className="text-xs text-mutedtext">{help}</p> : null}
    </header>
  );
}

function Unavailable() {
  const t = useTranslations("CC.admin.insights");
  return <p className="text-sm text-mutedtext">{t("notSet")}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-panel p-4">
      <p className="text-xs font-semibold text-mutedtext">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-heading">
        <Ltr>{value}</Ltr>
      </p>
      {hint ? <p className="mt-1 text-xs text-mutedtext">{hint}</p> : null}
    </div>
  );
}

// ─── funnel ───────────────────────────────────────────────────────────────

export function FunnelSection({ data }: { data: InsightsData }) {
  const t = useTranslations("CC.admin.insights");
  const { locale, num, pct } = useFmt();
  const f = data.funnel;
  const weekLabel = (ymd: string) => formatDate(`${ymd}T12:00:00+03:00`, locale, { day: "numeric", month: "short" });
  const bars: Bar[] = f
    ? f.totals.map((s) => ({
        label: t(`funnel.steps.${s.id}`),
        value: s.count,
        display: s.ofSignedUpPct == null ? num(s.count) : `${num(s.count)} · ${pct(s.ofSignedUpPct)}`,
      }))
    : [];
  return (
    <section className={cardCls}>
      <Head title={t("funnel.title")} purpose={t("funnel.purpose")} help={t("funnel.stepHelp")} />
      {!f ? (
        <Unavailable />
      ) : f.total === 0 ? (
        <p className="text-sm text-mutedtext">{t("empty")}</p>
      ) : (
        <>
          <BarChart bars={bars} title={t("funnel.chartTitle")} emptyText={t("empty")} />
          <h3 className="text-sm font-bold text-ink">{t("funnel.weeksTitle")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse">
              <caption className="sr-only">{t("funnel.weeksTitle")}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>
                    {t("funnel.weekHeading")}
                  </th>
                  {FUNNEL_STEPS.map((id) => (
                    <th key={id} scope="col" className={th}>
                      {t(`funnel.steps.${id}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.weeks.map((w) => (
                  <tr key={w.weekStart} className="border-b border-border/60">
                    <th scope="row" className={`${td} font-semibold text-ink`}>
                      {weekLabel(w.weekStart)}
                    </th>
                    {w.steps.map((s) => (
                      <td key={s.id} className={td}>
                        <span className="font-semibold text-ink">{num(s.count)}</span>
                        {s.dropOffPct != null ? <span className="block text-xs text-mutedtext">{t("funnel.dropped", { pct: num(s.dropOffPct) })}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-panel">
                  <th scope="row" className={`${td} font-bold text-heading`}>
                    {t("funnel.allWeeks")}
                  </th>
                  {f.totals.map((s) => (
                    <td key={s.id} className={td}>
                      <span className="font-bold text-heading">{num(s.count)}</span>
                      {s.dropOffPct != null ? <span className="block text-xs text-mutedtext">{t("funnel.dropped", { pct: num(s.dropOffPct) })}</span> : null}
                      {s.ofSignedUpPct != null && s.id !== "signed_up" ? <span className="block text-xs text-mutedtext">{t("funnel.ofSignups", { pct: num(s.ofSignedUpPct) })}</span> : null}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function StopsSection({ data }: { data: InsightsData }) {
  const t = useTranslations("CC.admin.insights");
  const { num } = useFmt();
  const stops = data.getReadyStops;
  const bars: Bar[] = stops ? stops.map((s) => ({ label: t(`stops.steps.${s.key}`), value: s.count, display: num(s.count) })) : [];
  const top = stops && stops.length ? stops.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  return (
    <section className={cardCls}>
      <Head title={t("stops.title")} purpose={t("stops.purpose")} />
      {!stops ? (
        <Unavailable />
      ) : (
        <>
          {data.stuckInGetReady != null ? <p className="text-sm font-semibold text-ink">{t("stops.stuck", { count: num(data.stuckInGetReady, 0) })}</p> : null}
          {top && top.count > 0 ? (
            <BarChart bars={bars.map((b, i) => ({ ...b, highlight: stops[i] === top }))} title={t("stops.title")} emptyText={t("stops.empty")} />
          ) : (
            <p className="text-sm text-mutedtext">{t("stops.empty")}</p>
          )}
        </>
      )}
    </section>
  );
}

// ─── skills, modules, improvement ────────────────────────────────────────

export function SkillsSection({ data, labels }: { data: InsightsData; labels: InsightLabels }) {
  const t = useTranslations("CC.admin.insights");
  const { locale, num, pct } = useFmt();
  const nameOf = (id: number) => {
    const l = labels.skills.find((s) => s.id === id);
    return (locale === "ar" ? l?.ar || l?.en : l?.en || l?.ar) ?? `#${id}`;
  };
  const withData = (data.skills ?? []).filter((s) => s.average != null);
  const weakest = withData.find((s) => s.weakest);
  return (
    <section className={cardCls}>
      <Head title={t("skills.title")} purpose={t("skills.purpose")} />
      {!data.skills ? (
        <Unavailable />
      ) : withData.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("skills.empty")}</p>
      ) : (
        <>
          <BarChart
            bars={withData.map((s) => ({ label: nameOf(s.skillAreaId), value: s.average as number, display: pct(s.average as number), highlight: s.weakest }))}
            max={100}
            title={t("skills.chartTitle")}
            emptyText={t("skills.empty")}
          />
          {weakest ? <p className="text-sm font-semibold text-ink">{t("skills.weakest", { name: nameOf(weakest.skillAreaId) })}</p> : null}
          <p className="text-xs text-mutedtext">{t("skills.attempts", { count: num(data.skillAttempts, 0) })}</p>
        </>
      )}
    </section>
  );
}

export function ModulesSection({ data, labels }: { data: InsightsData; labels: InsightLabels }) {
  const t = useTranslations("CC.admin.insights");
  const { locale, num, pct } = useFmt();
  const nameOf = (code: string) => {
    const l = labels.modules.find((m) => m.code === code);
    const n = (locale === "ar" ? l?.ar || l?.en : l?.en || l?.ar) ?? "";
    return n ? `${code} · ${n}` : code;
  };
  const rows = (data.modules ?? []).filter((m) => m.average != null);
  return (
    <section className={cardCls}>
      <Head title={t("modules.title")} purpose={t("modules.purpose")} />
      {!data.modules ? (
        <Unavailable />
      ) : rows.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("modules.empty")}</p>
      ) : (
        <>
          <BarChart
            bars={rows.map((m) => ({ label: nameOf(m.module), value: m.average as number, display: pct(m.average as number) }))}
            max={100}
            title={t("modules.chartTitle")}
            emptyText={t("modules.empty")}
          />
          <ul className="space-y-1 text-xs text-mutedtext">
            {rows.map((m) => (
              <li key={m.module}>
                <Ltr>{m.module}</Ltr>: {t("modules.points", { earned: num(m.earned), max: num(m.max) })}
              </li>
            ))}
          </ul>
          <p className="text-xs text-mutedtext">{t("modules.attempts", { count: num(data.moduleAttempts, 0) })}</p>
        </>
      )}
    </section>
  );
}

export function ImprovementSection({ data }: { data: InsightsData }) {
  const t = useTranslations("CC.admin.insights");
  const { num, pct } = useFmt();
  const i = data.improvement;
  return (
    <section className={cardCls}>
      <Head title={t("improvement.title")} purpose={t("improvement.purpose")} />
      {!i ? (
        <Unavailable />
      ) : i.students === 0 ? (
        <p className="text-sm text-mutedtext">{t("improvement.empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("improvement.students")} value={num(i.students, 0)} />
          <Stat label={t("improvement.improved")} value={num(i.improved, 0)} />
          <Stat label={t("improvement.first")} value={i.averageFirst == null ? "-" : pct(i.averageFirst)} />
          <Stat label={t("improvement.latest")} value={i.averageLatest == null ? "-" : pct(i.averageLatest)} />
          <Stat label={t("improvement.gain")} value={i.averageGain == null ? "-" : `${i.averageGain > 0 ? "+" : ""}${num(i.averageGain)}`} />
        </div>
      )}
    </section>
  );
}

// ─── who took part ────────────────────────────────────────────────────────

export function PeopleSection({ data }: { data: InsightsData }) {
  const t = useTranslations("CC.admin.insights");
  const { num } = useFmt();
  const levels = data.studyLevels;
  const inst = data.institutions;
  const levelBars: Bar[] = levels
    ? levels.items.map((l) => {
        const known = ["secondary", "diploma", "bachelor", "graduate", "working"].includes(l.label);
        return { label: known ? t(`people.levelNames.${l.label}`) : l.label, value: l.count, display: num(l.count, 0) };
      })
    : [];
  const instBars: Bar[] = inst ? inst.items.slice(0, 12).map((x) => ({ label: x.label, value: x.count, display: num(x.count, 0) })) : [];
  return (
    <section className={cardCls}>
      <Head title={t("people.title")} purpose={t("people.purpose")} />
      {!levels || !inst ? (
        <Unavailable />
      ) : levels.total === 0 ? (
        <p className="text-sm text-mutedtext">{t("people.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-bold text-ink">{t("people.levels")}</h3>
            <BarChart bars={levelBars} title={t("people.levels")} emptyText={t("people.empty")} />
            {levels.unknown > 0 ? <p className="text-xs text-mutedtext">{t("people.unknown", { count: num(levels.unknown, 0) })}</p> : null}
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-bold text-ink">{t("people.institutions")}</h3>
            <BarChart bars={instBars} title={t("people.institutions")} emptyText={t("people.empty")} />
            {inst.unknown > 0 ? <p className="text-xs text-mutedtext">{t("people.unknown", { count: num(inst.unknown, 0) })}</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── grading health ───────────────────────────────────────────────────────

export function GradingSection({ data }: { data: InsightsData }) {
  const t = useTranslations("CC.admin.insights");
  const { locale, num, pct } = useFmt();
  const h = data.health;
  const duration = (ms: number) => {
    const s = ms / 1000;
    if (s < 60) return t("grading.seconds", { value: num(s) });
    if (s < 3600) return t("grading.minutes", { value: num(s / 60) });
    return t("grading.hours", { value: num(s / 3600) });
  };
  const date = (ymd: string) => formatDate(`${ymd}T12:00:00+03:00`, locale);
  return (
    <section className={cardCls}>
      <Head title={t("grading.title")} purpose={t("grading.purpose")} />
      {!h ? (
        <Unavailable />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("grading.autoGraded")} value={num(h.grading.autoGraded, 0)} hint={t("grading.autoGradedHelp")} />
            <Stat label={t("grading.avgTime")} value={h.grading.avgDurationMs == null ? "-" : duration(h.grading.avgDurationMs)} />
            <Stat label={t("grading.failedRuns")} value={num(h.grading.failed, 0)} />
            <Stat label={t("grading.backlog")} value={h.backlog == null ? "-" : num(h.backlog, 0)} />
            <Stat label={t("grading.aiChecks")} value={num(h.ai.checks, 0)} hint={t("grading.aiSince", { date: date(h.aiMonthStart) })} />
            <Stat label={t("grading.aiCost")} value={`$${num(h.ai.costUsd, 2)}`} />
            <Stat
              label={t("grading.avgReview")}
              value={h.avgReviewHours == null ? "-" : t("grading.hours", { value: num(h.avgReviewHours) })}
              hint={t("grading.reviewed", { count: num(h.reviewed, 0) })}
            />
          </div>
          {h.backlog ? (
            <Link href={ccPath(locale, "/admin/review")} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
              {t("grading.backlogOpen")}
            </Link>
          ) : null}

          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-ink">{t("grading.errorsTitle")}</h3>
            <p className="text-xs text-mutedtext">{t("grading.errorsPurpose")}</p>
            {h.grading.errors.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("grading.errorsEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse">
                  <caption className="sr-only">{t("grading.errorsTitle")}</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={th}>
                        {t("grading.colCode")}
                      </th>
                      <th scope="col" className={th}>
                        {t("grading.colCount")}
                      </th>
                      <th scope="col" className={th}>
                        {t("grading.colRate")}
                      </th>
                      <th scope="col" className={th}>
                        {t("grading.colHelp")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.grading.errors.map((e) => (
                      <tr key={e.code} className="border-b border-border/60">
                        <th scope="row" className={`${td} font-mono text-ink`}>
                          <Ltr>{e.code}</Ltr>
                        </th>
                        <td className={td}>{num(e.count, 0)}</td>
                        <td className={td}>{e.ratePct == null ? "-" : pct(e.ratePct)}</td>
                        <td className={td}>
                          {e.helpSlug ? (
                            <Link href={ccPath(locale, `/help/${e.helpSlug}`)} className="font-semibold text-accent underline-offset-2 hover:underline">
                              {t("grading.helpArticle")}
                            </Link>
                          ) : (
                            <span className="text-mutedtext">{t("grading.noArticle")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
