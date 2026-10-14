// Results page sections (Prompt 7 Step B + C), shared by the results page
// (app/[locale]/cad-champions/results/[attemptId]/page.tsx) and the test-only
// e2e fixture (app/[locale]/cad-champions/e2e-fixtures). Server components.
// `offer` (optional) skips the free-lesson / plan reads; the page leaves it
// unset so they load from the database as before.

import Link from "next/link";
import { BookOpen, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Download, FileX2, GraduationCap, MessageCircle, PlayCircle, UserCheck, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { QuestionForm } from "@/components/cad-champions/results/question-form";
import { RadarChart } from "@/components/cad-champions/results/radar-chart";
import { ShareToggle } from "@/components/cad-champions/results/share-toggle";
import { ModuleChip } from "@/components/cad-champions/test/module-chip";
import { Alert, Button, EmptyState, HelpTip, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatNumber, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { UNASSESSED_COVERAGE } from "@/lib/cad-champions/scoring/config";
import { loadFreeLesson, loadPlanOffer, type FreeLesson, type PlanOffer, type ResultsView, type TaskCardView } from "@/lib/cad-champions/scoring/load";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

/** Preloaded training-path offer (free lesson + plan); unset = read from the database. */
export type ResultsOffer = { lesson: FreeLesson | null; plan: PlanOffer | null };

export const BAND_TONE: Record<string, ChipTone> = { beginner: "neutral", developing: "info", competitive: "success", competition_ready: "success" };

export function pct(n: number | null, locale: Locale): string {
  if (n == null) return "";
  return `${formatNumber(Math.round(n), locale)}%`;
}

// ─── states ─────────────────────────────────────────────────────────────────

export async function InProgress({ v, locale }: { v: ResultsView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.results.states" });
  return (
    <EmptyState
      icon={Clock3}
      title={t("inProgressTitle")}
      description={t("inProgressText")}
      action={
        <Button asChild>
          <Link href={ccPath(locale, `/test/${v.test.slug}/attempt`)}>{t("continue")}</Link>
        </Button>
      }
    />
  );
}

export async function Expired({ v, locale }: { v: ResultsView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.results.states" });
  const canNow = v.retakeAt == null || v.retakeAt <= Date.now();
  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-expired-title">
      <div className="flex items-start gap-3">
        <FileX2 aria-hidden="true" strokeWidth={1.75} className="mt-1 h-6 w-6 shrink-0 text-accent" />
        <div>
          <h2 id="cc-expired-title" className="text-xl font-extrabold text-heading">
            {t("expiredTitle")}
          </h2>
          <p className="mt-1 text-sm text-body">{t("expiredText")}</p>
          <p className="mt-2 text-sm font-semibold text-ink">
            {canNow ? t("retakeNow") : t("retakeOn", { date: formatDate(v.retakeAt as number, locale) })}
          </p>
        </div>
      </div>
      <Button asChild variant={canNow ? "primary" : "secondary"}>
        <Link href={ccPath(locale, `/test/${v.test.slug}`)}>{t("retake")}</Link>
      </Button>
    </section>
  );
}

// ─── full results ───────────────────────────────────────────────────────────

export async function FullResults({ v, locale, isOwner, offer }: { v: ResultsView; locale: Locale; isOwner: boolean; offer?: ResultsOffer }) {
  const t = await getTranslations({ locale, namespace: "CC.results" });
  const band = v.band ?? "beginner";
  const other: Locale = locale === "ar" ? "en" : "ar";
  const reportHref = (lang: Locale) => `/api/cad-champions/results/${v.attemptId}/report?lang=${lang}`;

  return (
    <>
      {/* Header */}
      <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby="cc-results-score">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="neu-inset flex h-32 w-32 shrink-0 flex-col items-center justify-center rounded-full">
            <span id="cc-results-score" className="text-xs font-semibold text-body">
              {t("header.overall")}
            </span>
            <span className="text-4xl font-extrabold text-heading">
              <Ltr>{pct(v.percent, locale)}</Ltr>
            </span>
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-body">{t("header.bandLabel")}</span>
              <StatusChip tone={BAND_TONE[band] ?? "info"} icon={GraduationCap}>
                {t(`band.${band}.name`)}
              </StatusChip>
              {v.status === "provisional" ? (
                <span className="inline-flex items-center gap-1">
                  <StatusChip tone="warning" icon={UserCheck}>
                    {t("header.provisional")}
                  </StatusChip>
                  <HelpTip label={t("header.provisionalHelpLabel")}>{t("header.provisionalHelp")}</HelpTip>
                </span>
              ) : (
                <StatusChip tone="success" icon={CheckCircle2}>
                  {t("header.final")}
                </StatusChip>
              )}
            </div>
            <p className="text-lg font-bold text-heading">{t(`band.${band}.meaning`)}</p>
            <p className="text-sm text-body">
              {v.submittedAt ? t("header.takenOn", { date: formatDate(v.submittedAt, locale) }) : null}
              {v.timeUsedMinutes != null ? (
                <>
                  {" · "}
                  {v.timeAllowedMinutes != null
                    ? t("header.time", { used: String(v.timeUsedMinutes), allowed: String(v.timeAllowedMinutes) })
                    : t("header.timeUntimed", { used: String(v.timeUsedMinutes) })}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href={reportHref(locale)} download>
              <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("header.download")}
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href={reportHref(other)} download>
              {other === "ar" ? t("header.downloadAr") : t("header.downloadEn")}
            </a>
          </Button>
        </div>
        <p className="text-xs text-mutedtext">{t("header.reportNote")}</p>
      </section>

      {v.anyManualCheck ? (
        <Alert tone="info" title={t("states.manualTitle")}>
          {t("states.manualText")}
        </Alert>
      ) : null}

      {/* How to read */}
      <details className="neu group p-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-lg font-extrabold text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
          {t("howTo.title")}
          <ChevronDown aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-3 list-disc space-y-2 ps-5 text-sm text-body">
          <li>{t("howTo.b1")}</li>
          <li>{t("howTo.b2")}</li>
          <li>{t("howTo.b3")}</li>
        </ul>
      </details>

      <SkillMap v={v} locale={locale} />
      {v.modules.length > 0 ? <Modules v={v} locale={locale} /> : null}
      <Tasks v={v} locale={locale} isOwner={isOwner} />
      <TrainingPath v={v} locale={locale} offer={offer} />
      {isOwner ? <ShareToggle attemptId={v.attemptId} initialEnabled={v.shareEnabled} initialToken={v.shareToken} ready /> : null}
    </>
  );
}

async function SkillMap({ v, locale }: { v: ResultsView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.results.skillMap" });
  const tShort = await getTranslations({ locale, namespace: "CC.results.areaShort" });
  const unassessed = v.areas.filter((a) => !a.assessed);
  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-skillmap-title">
      <div>
        <h2 id="cc-skillmap-title" className="text-xl font-extrabold text-heading">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-body">{t("purpose")}</p>
      </div>
      <div className="flex justify-center">
        <RadarChart
          axes={v.areas.map((a) => ({ id: a.id, label: tShort(String(a.id) as "1"), percent: a.percent }))}
          label={t("chartLabel")}
          notAssessed={t("notAssessedShort")}
          rtl={locale === "ar"}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">{t("chartLabel")}</caption>
          <thead>
            <tr className="border-b border-border text-start text-xs font-semibold text-body">
              <th scope="col" className="py-2 pe-3 text-start">
                {t("area")}
              </th>
              <th scope="col" className="py-2 pe-3 text-start">
                <span className="inline-flex items-center gap-1">
                  {t("weight")}
                  <HelpTip label={t("weightHelpLabel")}>{t("weightHelp")}</HelpTip>
                </span>
              </th>
              <th scope="col" className="py-2 pe-3 text-start">
                {t("score")}
              </th>
              <th scope="col" className="py-2 text-start">
                <span className="inline-flex items-center gap-1">
                  {t("level")}
                  <HelpTip label={t("levelHelpLabel")}>{t("levelHelp")}</HelpTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {v.areas.map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <th scope="row" className="py-2 pe-3 text-start font-semibold text-ink">
                  {a.name}
                </th>
                <td className="py-2 pe-3 text-body">
                  <Ltr>{`${formatNumber(a.weight, locale)}%`}</Ltr>
                </td>
                <td className="py-2 pe-3 font-bold text-ink">{a.assessed ? <Ltr>{pct(a.percent, locale)}</Ltr> : <span className="font-normal text-mutedtext">{t("notAssessed")}</span>}</td>
                <td className="py-2 text-ink">{a.level ? <Ltr>{t("levelValue", { level: String(a.level) })}</Ltr> : <span className="text-mutedtext">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unassessed.length > 0 ? (
        <ul className="space-y-1.5 text-sm text-body">
          {unassessed.map((a) => (
            <li key={a.id} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
              {t(`coverage.${UNASSESSED_COVERAGE[a.id as 1]}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

async function Modules({ v, locale }: { v: ResultsView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.results.modules" });
  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-modules-title">
      <div>
        <div className="flex items-center gap-2">
          <h2 id="cc-modules-title" className="text-xl font-extrabold text-heading">
            {t("title")}
          </h2>
          <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
        </div>
        <p className="mt-1 text-sm text-body">{t("purpose")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {v.modules.map((m) => (
          <li key={m.code} className="tile space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <ModuleChip code={m.code} name={null} />
                <span className="truncate text-sm font-bold text-ink">{m.name}</span>
              </span>
              <span className="text-lg font-extrabold text-heading">
                <Ltr>{pct(m.percent, locale)}</Ltr>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel shadow-neu-inset" aria-hidden="true">
              <div className="h-full rounded-full bg-cobalt" style={{ width: `${Math.max(2, Math.min(100, m.percent))}%` }} />
            </div>
            <p className="text-xs font-semibold text-body">{t("level", { level: String(m.level) })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const METHOD_TONE: Record<TaskCardView["method"], ChipTone> = { auto: "info", checklist: "warning", trainer: "neutral" };

async function Tasks({ v, locale, isOwner }: { v: ResultsView; locale: Locale; isOwner: boolean }) {
  const t = await getTranslations({ locale, namespace: "CC.results.tasks" });
  const ts = await getTranslations({ locale, namespace: "CC.review.student" });
  return (
    <section className="space-y-4" aria-labelledby="cc-tasks-title">
      <h2 id="cc-tasks-title" className="text-xl font-extrabold text-heading">
        {t("title")}
      </h2>
      {v.tasks.map((task) => (
        <article key={task.id} className="neu space-y-4 p-6" aria-labelledby={`cc-task-${task.id}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-body">{t("taskN", { n: String(task.number) })}</p>
              <h3 id={`cc-task-${task.id}`} className="text-lg font-extrabold text-heading">
                {task.title}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {task.skillName ? <StatusChip tone="neutral">{task.skillName}</StatusChip> : null}
                {task.moduleCode ? <ModuleChip code={task.moduleCode} name={task.moduleName} /> : null}
                <span className="inline-flex items-center gap-1">
                  <StatusChip tone={METHOD_TONE[task.method]}>{t(`method.${task.method}`)}</StatusChip>
                  <HelpTip label={t("methodHelpLabel")}>{t(`methodHelp.${task.method}`)}</HelpTip>
                </span>
              </div>
            </div>
            <p className="shrink-0 text-lg font-extrabold text-heading">
              {t("score", { earned: formatNumber(task.earned, locale), max: formatNumber(task.max, locale) })}
            </p>
          </div>

          {!task.hasFile ? <p className="text-sm text-body">{t("noFile")}</p> : null}
          {task.checking ? <p className="text-sm text-body">{t("checking")}</p> : null}
          {task.manualCheck ? <p className="text-sm font-semibold text-ink">{t("manualCheck")}</p> : null}
          {task.checklistPending ? (
            <span className="inline-flex items-center gap-1">
              <StatusChip tone="info" icon={ClipboardCheck}>
                {ts("checklistDone")}
              </StatusChip>
              <HelpTip label={ts("checklistHelpLabel")}>{ts("checklistHelp")}</HelpTip>
            </span>
          ) : task.waitingTrainer ? (
            <p className="text-sm text-body">{t("waitingTrainer")}</p>
          ) : null}

          {task.feedback ? (
            <div>
              <h4 className="text-sm font-bold text-ink">{t("feedback")}</h4>
              <p className="mt-1 whitespace-pre-line text-sm text-body">{task.feedback}</p>
            </div>
          ) : null}
          {task.reviewerComment ? (
            <div>
              <h4 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
                {t("reviewer")}
                {task.commentMachineTranslated ? <StatusChip tone="neutral">{ts("machineTranslated")}</StatusChip> : null}
              </h4>
              <p className="mt-1 whitespace-pre-line text-sm text-body">{task.reviewerComment}</p>
            </div>
          ) : null}

          {task.checklist ? (
            <div>
              <h4 className="text-sm font-bold text-ink">{ts("checklistTitle")}</h4>
              <ul className="mt-2 space-y-2">
                {task.checklist.map((c, i) => (
                  <li key={i} className="tile flex items-start gap-2 text-sm">
                    {c.passed === true ? (
                      <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-buy" />
                    ) : (
                      <XCircle aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-[#a1231f]" />
                    )}
                    <span className="min-w-0">
                      <span className="sr-only">{c.passed === true ? ts("passed") : ts("failed")}: </span>
                      <span className="font-semibold text-ink">{c.description}</span>
                      {c.hint ? <span className="mt-1 block text-body">{c.hint}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : task.hasFile && !task.checking && !task.checklistPending ? (
            task.failed.length > 0 ? (
              <div>
                <h4 className="text-sm font-bold text-ink">{t("failedTitle")}</h4>
                <ul className="mt-2 space-y-2">
                  {task.failed.map((f, i) => (
                    <li key={i} className="tile text-sm">
                      <span className="font-semibold text-ink">{f.description}</span>
                      {f.hint ? <span className="mt-1 block text-body">{f.hint}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : task.error == null && !task.manualCheck ? (
              <p className="flex items-center gap-2 text-sm text-body">
                <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-buy" />
                {t("allPassed")}
              </p>
            ) : null
          ) : null}

          {task.judgements.length > 0 ? (
            <div>
              <div className="flex items-center gap-1">
                <h4 className="text-sm font-bold text-ink">{t("judgementTitle")}</h4>
                <HelpTip label={t("scaleHelpLabel")}>{t("scale")}</HelpTip>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {task.judgements.map((j, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body">{j.description}</span>
                    <span className="text-end">
                      <span className="block font-bold text-ink">{j.score == null ? t("judgementPending") : t("judgementScore", { score: String(j.score) })}</span>
                      {j.score != null && j.score >= 0 && j.score <= 3 ? <span className="block text-xs text-body">{ts(`scale.${j.score}`)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {task.error ? (
            <Alert
              tone="warning"
              title={task.error.message}
              action={
                <Link href={ccPath(locale, `/help/${task.error.helpSlug}`)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline">
                  <BookOpen aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("helpLink")}
                </Link>
              }
            />
          ) : null}

          {task.question ? (
            <div className="neu-inset space-y-2 p-4 text-sm">
              <h4 className="font-bold text-ink">{ts("yourQuestion")}</h4>
              <p dir="auto" className="whitespace-pre-line text-body">
                {task.question.body}
              </p>
              <h4 className="font-bold text-ink">{ts("answer")}</h4>
              {task.question.answer ? (
                <>
                  <p dir="auto" className="whitespace-pre-line text-ink">
                    {task.question.answer}
                  </p>
                  {task.question.answeredAt ? <p className="text-xs text-body">{ts("answeredOn", { date: formatDate(task.question.answeredAt, locale) })}</p> : null}
                </>
              ) : (
                <p className="text-body">{ts("answerPending")}</p>
              )}
            </div>
          ) : null}

          {isOwner && task.taskResultId && task.hasFile && !task.checking ? (
            <QuestionForm attemptId={v.attemptId} taskResultId={task.taskResultId} alreadyAsked={task.queryOpen} />
          ) : null}
        </article>
      ))}
    </section>
  );
}

async function TrainingPath({ v, locale, offer }: { v: ResultsView; locale: Locale; offer?: ResultsOffer }) {
  const t = await getTranslations({ locale, namespace: "CC.results.path" });
  const tShort = await getTranslations({ locale, namespace: "CC.results.areaShort" });
  const top = v.path[0]?.skillAreaId ?? null;
  const [lesson, plan] = offer ? [offer.lesson, offer.plan] : await Promise.all([loadFreeLesson(top, locale), loadPlanOffer(locale)]);
  const { whatsappNumber, supportEmail } = getCcContact();
  const wa = buildWhatsAppUrl(whatsappNumber, t("offer.whatsappText"));

  return (
    <section className="space-y-4" aria-labelledby="cc-path-title">
      <div>
        <h2 id="cc-path-title" className="text-xl font-extrabold text-heading">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-body">{t("purpose")}</p>
      </div>

      <div className="neu p-6">
        {v.path.length === 0 ? (
          <p className="text-sm text-body">{t("empty")}</p>
        ) : (
          <ol className="space-y-3">
            {v.path.map((s, i) => (
              <li key={s.skillAreaId} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cobalt text-sm font-bold text-white">
                  <Ltr>{String(i + 1)}</Ltr>
                </span>
                <div>
                  <p className="text-xs font-semibold text-body">{t("rank", { n: String(i + 1) })}</p>
                  <p className="text-sm font-semibold text-ink">
                    {t(`reason.${s.reasonKey}`, {
                      area: tShort(String(s.skillAreaId) as "1"),
                      weight: formatNumber(s.weight, locale),
                      percent: formatNumber(Math.round(s.percent), locale),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="neu flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-extrabold text-heading">{t("freeLesson.title")}</h3>
          </div>
          <p className="text-base font-bold text-ink">{lesson ? lesson.title : t("freeLesson.placeholderTitle")}</p>
          {lesson ? (
            lesson.minutes ? <p className="text-sm text-body">{t("freeLesson.minutes", { minutes: String(lesson.minutes) })}</p> : null
          ) : (
            <p className="text-sm text-body">{t("freeLesson.placeholderText")}</p>
          )}
          <div className="mt-auto">
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, lesson ? `/training/lessons/${lesson.slug}` : "/training")}>{t("freeLesson.watch")}</Link>
            </Button>
          </div>
        </div>

        <div className="neu flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <GraduationCap aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-extrabold text-heading">{t("offer.title")}</h3>
          </div>
          <p className="text-sm font-bold text-ink">{t("offer.includes")}</p>
          {plan && plan.includes.length > 0 ? (
            <ul className="list-disc space-y-1 ps-5 text-sm text-body">
              {plan.includes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-body">{t("offer.todoPlan")}</p>
          )}
          {plan ? (
            <p className="text-sm text-body">
              <span className="font-semibold text-ink">{plan.name} · {t("offer.price")}: </span>
              {plan.priceQar != null ? <Ltr>{formatQAR(plan.priceQar, locale)}</Ltr> : t("offer.priceSoon")}
              {plan.priceQar != null && plan.durationDays ? ` · ${t("offer.days", { days: String(plan.durationDays) })}` : null}
            </p>
          ) : null}
          <div className="mt-auto flex flex-wrap gap-3">
            <Button asChild>
              <Link href={ccPath(locale, "/training/join")}>{t("offer.join")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <a href={wa ?? `mailto:${supportEmail}`} target={wa ? "_blank" : undefined} rel={wa ? "noopener noreferrer" : undefined}>
                <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("offer.questions")}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
