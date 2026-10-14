import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, CheckCircle2, ClipboardList, Lock, PlayCircle, Timer } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining, LevelStatusChip, TrainingUnavailable } from "@/components/cad-champions/training/page-bits";
import { LevelBadge, ProgressRing } from "@/components/cad-champions/training/visuals";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { MODULE_SLUGS } from "@/lib/cad-champions/training/catalog";
import { isExercisePassed, type LockReason } from "@/lib/cad-champions/training/ladder";
import { loadTrainingState, pick } from "@/lib/cad-champions/training/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Module page (Prompt 9 Step E): the ladder of levels with locked / open /
// completed states and the unlock reason; admin manual unlocks
// (cc_level_unlocks) count. The Mock Competitions module also lists the
// published mock tests.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, module } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: `/training/${module}`, title: t("overview") });
}

async function reasonText(locale: Locale, reason: LockReason): Promise<string> {
  const t = await getTranslations({ locale, namespace: "CC.training.ladder.reason" });
  if (reason.key === "passPrevious") return t("passPrevious", { level: formatNumber(reason.level, locale), passMark: formatNumber(reason.passMark, locale) });
  if (reason.key === "completePrevious") return t("completePrevious", { level: formatNumber(reason.level, locale) });
  return t("enroll");
}

type MockTest = { slug: string; title_en: string; title_ar: string; time_limit_minutes: number | null };

async function loadMocks(): Promise<MockTest[]> {
  try {
    const db = await createClient();
    const { data } = await db.from("cc_tests").select("slug,title_en,title_ar,time_limit_minutes").eq("type", "mock").eq("is_published", true).order("created_at");
    return (data ?? []) as MockTest[];
  } catch {
    return [];
  }
}

export default async function CcTrainingModulePage({ params }: Props) {
  const { locale, module: slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/training/${slug}`));
  const t = await getTranslations({ locale, namespace: "CC.training" });

  const state = await loadTrainingState(cc);
  const view = state.ok ? state.views.find((v) => v.module.slug === slug) : undefined;
  if (!state.ok || !view) {
    return (
      <div className="container page-stack">
        <PageHeader title={t("meta.overview")} purpose={t("overview.purpose")} actions={<BackToTraining locale={locale} />} />
        <TrainingUnavailable locale={locale} reason={!state.ok ? state.reason : "not_found"} />
        <SignedInExtras pageName={t("meta.overview")} />
      </div>
    );
  }

  const { progress } = state;
  const m = view.module;
  const moduleIndex = state.views.indexOf(view);
  const title = pick(locale, m.title_en, m.title_ar);
  const cert = progress.certificates.find((c) => c.moduleId === m.id);
  const isMocks = m.slug === MODULE_SLUGS.mocks;
  const mocks = isMocks ? await loadMocks() : [];
  const reasons = await Promise.all(view.states.map((s) => (s.reason ? reasonText(locale, s.reason) : Promise.resolve(""))));

  return (
    <div className="container page-stack">
      <PageHeader title={title} purpose={pick(locale, m.description_en, m.description_ar) || t("overview.purpose")} actions={<BackToTraining locale={locale} />} />

      <section className="neu flex flex-col gap-4 p-6 sm:flex-row sm:items-center" aria-label={t("overview.progressLabel", { percent: formatNumber(view.progress.percent, locale) })}>
        <ProgressRing percent={view.progress.percent} size={80} label={t("overview.progressLabel", { percent: formatNumber(view.progress.percent, locale) })} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-ink">
            {t("overview.levelsDone", { done: formatNumber(view.progress.levelsDone, locale), total: formatNumber(view.progress.levelsTotal, locale) })}
          </p>
          {m.why_en || m.why_ar ? (
            <p className="text-sm text-body">
              <span className="font-semibold text-ink">{t("module.why")}: </span>
              {pick(locale, m.why_en, m.why_ar)}
            </p>
          ) : null}
        </div>
      </section>

      {cert ? (
        <Alert
          tone="success"
          title={t("module.certificateTitle")}
          action={
            <Button asChild size="sm">
              <Link href={ccPath(locale, `/training/certificates/${cert.code}`)}>{t("overview.viewCertificate")}</Link>
            </Button>
          }
        >
          {t("module.certificateText")}
        </Alert>
      ) : null}

      {isMocks ? (
        <section className="neu space-y-3 p-6" aria-labelledby="cc-mocks">
          <div className="flex items-center gap-2">
            <Timer aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <h2 id="cc-mocks" className="title-section">
              {t("module.mocksTitle")}
            </h2>
          </div>
          <p className="text-sm text-body">{t("module.mocksText")}</p>
          {cc.profile?.track_software === "solidworks" ? (
            <Alert tone="warning" title={t("overview.solidworksTitle")}>
              {t("overview.solidworksText")}
            </Alert>
          ) : (
            <p className="text-sm text-body">{t("module.mockSoftwareNote")}</p>
          )}
          {mocks.length === 0 ? (
            <EmptyState icon={Timer} title={t("module.mocksTitle")} description={t("module.mocksEmpty")} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {mocks.map((x) => (
                <li key={x.slug} className="tile flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-ink">{pick(locale, x.title_en, x.title_ar)}</p>
                    {x.time_limit_minutes ? (
                      <p className="text-xs text-body">{t("module.mockHours", { hours: formatNumber(Math.round((x.time_limit_minutes / 60) * 10) / 10, locale) })}</p>
                    ) : null}
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={ccPath(locale, `/test/${x.slug}`)}>{t("module.mockOpen")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="cc-ladder">
        <div className="flex items-center gap-2">
          <h2 id="cc-ladder" className="title-section">
            {t("module.levelsTitle")}
          </h2>
          <HelpTip label={t("ladder.helpLabel")}>{t("ladder.help")}</HelpTip>
        </div>
        {m.levels.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("common.notSetUpTitle")} description={t("ladder.empty")} />
        ) : (
          <ol className="relative space-y-4 border-s-2 border-dashed border-border ps-6">
            {m.levels.map((level, i) => {
              const s = view.states.find((x) => x.id === level.id);
              const status = s?.status ?? "locked";
              const levelTitle = pick(locale, level.title_en, level.title_ar);
              return (
                <li key={level.id} className={cn("neu relative space-y-3 p-5 sm:p-6", status === "locked" && "opacity-90")}>
                  <span className="absolute -start-[2.35rem] top-6 rounded-full bg-surface">
                    <LevelBadge
                      level={level.number}
                      moduleIndex={moduleIndex}
                      earned={status === "completed"}
                      size={36}
                      label={progress.badges.has(level.id) ? t("stats.badgeLabel", { level: levelTitle }) : levelTitle}
                    />
                  </span>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="title-card">{levelTitle}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {progress.badges.has(level.id) ? (
                        <StatusChip tone="success" icon={Award}>
                          {t("ladder.badgeEarned")}
                        </StatusChip>
                      ) : null}
                      <LevelStatusChip locale={locale} status={status} />
                    </div>
                  </div>
                  {level.goal_en || level.goal_ar ? <p className="text-sm text-body">{pick(locale, level.goal_en, level.goal_ar)}</p> : null}
                  {s && status === "locked" && reasons[i] ? (
                    <p className="flex items-start gap-2 text-sm font-semibold text-ink">
                      <Lock aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-mutedtext" />
                      {reasons[i]}
                    </p>
                  ) : null}
                  {s ? (
                    <p className="text-xs text-body">
                      {s.lessonsTotal > 0 ? t("common.lessonsCount", { done: formatNumber(s.lessonsDone, locale), total: formatNumber(s.lessonsTotal, locale) }) : null}
                      {s.lessonsTotal > 0 && s.exercisesTotal > 0 ? " · " : null}
                      {s.exercisesTotal > 0 ? t("common.exercisesCount", { done: formatNumber(s.exercisesPassed, locale), total: formatNumber(s.exercisesTotal, locale) }) : null}
                    </p>
                  ) : null}

                  {level.lessons.length === 0 && level.exercises.length === 0 ? <p className="text-sm text-body">{t("ladder.empty")}</p> : null}

                  {level.lessons.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">{t("ladder.lessonsTitle")}</p>
                      <ul className="mt-1 divide-y divide-border">
                        {level.lessons.map((x) => {
                          const done = progress.completedLessons.has(x.id);
                          return (
                            <li key={x.id}>
                              <Link
                                href={ccPath(locale, `/training/lessons/${x.slug}`)}
                                className="tap-target-y flex items-center justify-between gap-3 py-2 text-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {done ? (
                                    <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-buy" />
                                  ) : (
                                    <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-accent" />
                                  )}
                                  <span className="font-semibold text-ink">{pick(locale, x.title_en, x.title_ar)}</span>
                                  {done ? <span className="sr-only">{t("ladder.lessonDone")}</span> : null}
                                </span>
                                <span className="flex shrink-0 items-center gap-2 text-xs text-body">
                                  {x.isFreePreview ? <StatusChip tone="info">{t("common.freePreview")}</StatusChip> : null}
                                  {x.minutes ? t("common.minutes", { minutes: formatNumber(x.minutes, locale) }) : null}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {level.exercises.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">{t("ladder.exercisesTitle")}</p>
                      <ul className="mt-1 divide-y divide-border">
                        {level.exercises.map((x) => {
                          const best = progress.bestPercent.get(x.id);
                          const passed = isExercisePassed(best, x.passMark);
                          const bestText = best != null ? formatNumber(Math.round(best), locale) : "";
                          return (
                            <li key={x.id}>
                              <Link
                                href={ccPath(locale, `/training/exercises/${x.slug}`)}
                                className="tap-target-y flex items-center justify-between gap-3 py-2 text-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {passed ? (
                                    <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-buy" />
                                  ) : (
                                    <ClipboardList aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-accent" />
                                  )}
                                  <span className="font-semibold text-ink">{pick(locale, x.title_en, x.title_ar)}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2 text-xs text-body">
                                  {x.isFreeSample ? <StatusChip tone="info">{t("common.freeSample")}</StatusChip> : null}
                                  {passed ? t("ladder.exercisePassed", { percent: bestText }) : best != null ? t("ladder.exerciseBest", { percent: bestText }) : t("ladder.exerciseNew")}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <SignedInExtras pageName={title} />
    </div>
  );
}
