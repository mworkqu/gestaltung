import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, History, Lock, PlayCircle, Timer } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { ExerciseWorkspace } from "@/components/cad-champions/training/exercise-workspace";
import { BackToTraining, TrainingUnavailable } from "@/components/cad-champions/training/page-bits";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import type { CcExerciseAttempt, CcExercisePublic } from "@/lib/cad-champions/db/types";
import { formatDateTime, formatNumber } from "@/lib/cad-champions/format";
import { EXPORT_STEP_HELP, actionSoftwareFor } from "@/lib/cad-champions/get-ready/content";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { canSeeSolution, canUseExercise, hintsAvailable } from "@/lib/cad-champions/training/access";
import { loadTrainingState, locate, pick, signedFileLinks } from "@/lib/cad-champions/training/server";
import { createClient } from "@/lib/supabase/server";

// Exercise page (Prompt 9 Step E): brief, time, files, upload -> immediate
// grading, unlimited attempts with the best score kept, attempt history,
// hints (server-gated) and the solution video (after a pass or 5 attempts).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function loadExercise(slug: string): Promise<CcExercisePublic | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  try {
    const db = await createClient();
    const { data } = await db.from("cc_exercises_public").select("*").eq("slug", slug).maybeSingle<CcExercisePublic>();
    return data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const ex = await loadExercise(slug);
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: `/training/exercises/${slug}`, title: ex ? pick(locale, ex.title_en, ex.title_ar) : t("overview") });
}

type AttemptRow = Pick<CcExerciseAttempt, "id" | "status" | "percent" | "passed" | "file_name" | "created_at">;

function attemptState(a: AttemptRow): { key: "passed" | "failed" | "pending" | "review" | "error"; tone: ChipTone } {
  if (a.status === "error") return { key: "error", tone: "neutral" };
  if (a.status === "ai_pending_review") return { key: "review", tone: "info" };
  if (a.passed === true) return { key: "passed", tone: "success" };
  if (a.passed === false) return { key: "failed", tone: "warning" };
  return { key: "pending", tone: "info" };
}

async function loadAttempts(userId: string, exerciseId: string): Promise<AttemptRow[]> {
  try {
    const db = await createClient();
    const { data } = await db
      .from("cc_exercise_attempts")
      .select("id,status,percent,passed,file_name,created_at")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as AttemptRow[];
  } catch {
    return [];
  }
}

async function loadLinkedTest(testId: string | null): Promise<{ slug: string; minutes: number | null } | null> {
  if (!testId) return null;
  try {
    const db = await createClient();
    const { data } = await db.from("cc_tests").select("slug,time_limit_minutes").eq("id", testId).maybeSingle<{ slug: string; time_limit_minutes: number | null }>();
    return data ? { slug: data.slug, minutes: data.time_limit_minutes } : null;
  } catch {
    return null;
  }
}

export default async function CcExercisePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/training/exercises/${slug}`));
  const t = await getTranslations({ locale, namespace: "CC.training" });

  const [state, ex] = await Promise.all([loadTrainingState(cc), loadExercise(slug)]);
  const where = state.ok && ex ? locate(state.catalog, state.progress, state.access, { exerciseId: ex.id }) : null;
  if (!state.ok || !ex || !where) {
    return (
      <div className="container page-stack">
        <PageHeader title={t("meta.overview")} purpose={t("overview.purpose")} actions={<BackToTraining locale={locale} />} />
        <TrainingUnavailable locale={locale} reason={!state.ok ? state.reason : "not_found"} />
        <SignedInExtras pageName={t("meta.overview")} />
      </div>
    );
  }

  const { access, progress } = state;
  const { module: mod, level, state: levelState } = where;
  const title = pick(locale, ex.title_en, ex.title_ar);
  const canUse = canUseExercise(access, ex);
  const levelLocked = !access.staff && levelState?.status === "locked";
  const open = canUse && !levelLocked;
  const brief = pick(locale, ex.brief_en, ex.brief_ar);
  const attachments = open ? await signedFileLinks("cc-task-files", ex.attachments, locale) : [];
  const attempts = await loadAttempts(cc.user.id, ex.id);
  const counted = attempts.filter((a) => a.status !== "error");
  const failed = counted.filter((a) => a.passed === false).length;
  const passed = counted.some((a) => a.passed === true);
  const best = progress.bestPercent.get(ex.id) ?? null;
  const linkedTest = ex.test_id ? await loadLinkedTest(ex.test_id) : null;
  const lesson = level.lessons[0] ?? null;
  const track = cc.profile?.track_software ?? null;
  const lockReason = levelState?.reason;
  const pct = (n: number) => formatNumber(Math.round(n), locale);

  return (
    <div className="container page-stack">
      <PageHeader
        title={title}
        purpose={`${pick(locale, mod.title_en, mod.title_ar)} · ${pick(locale, level.title_en, level.title_ar)}`}
        actions={<BackToTraining locale={locale} href={ccPath(locale, `/training/${mod.slug}`)} />}
      />

      <div className="flex flex-wrap gap-2">
        {ex.skill_area_id ? <StatusChip tone="neutral">{`${t("common.skillArea")}: ${t(`common.areas.${ex.skill_area_id}` as "common.areas.1")}`}</StatusChip> : null}
        {ex.competition_module ? <StatusChip tone="info">{`${t("common.competitionModule")} ${ex.competition_module}`}</StatusChip> : null}
        {ex.is_free_sample ? <StatusChip tone="success">{t("common.freeSample")}</StatusChip> : null}
        <StatusChip tone={best != null ? "info" : "neutral"}>{best != null ? t("exercise.best", { percent: pct(best) }) : t("exercise.noBest")}</StatusChip>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-brief">
            <div className="flex items-center gap-2">
              <FileText aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
              <h2 id="cc-brief" className="title-section">
                {t("exercise.brief")}
              </h2>
            </div>
            {brief ? <ArticleBody markdown={brief} locale={locale} hasVideoId={false} /> : null}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-body">
              {ex.estimated_minutes ? <span>{t("exercise.estimated", { minutes: formatNumber(ex.estimated_minutes, locale) })}</span> : null}
              <span className="inline-flex items-center gap-1">
                {t("exercise.passMark", { percent: formatNumber(Number(ex.pass_mark), locale) })}
                <HelpTip label={t("exercise.passMarkHelpLabel")}>{t("exercise.passMarkHelp")}</HelpTip>
              </span>
              {ex.material_name_en ? (
                <span>
                  {t("exercise.material", { material: pick(locale, ex.material_name_en, ex.material_name_ar) })}
                  {ex.density_kg_m3 ? (
                    <>
                      {" "}
                      (<Ltr>{`${formatNumber(Number(ex.density_kg_m3), locale)} kg/m³`}</Ltr>)
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          </section>

          {!open ? (
            <Alert
              tone="info"
              title={canUse ? t("exercise.lockedTitle") : t("exercise.errors.forbidden")}
              action={
                canUse ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={ccPath(locale, `/training/${mod.slug}`)}>{t("exercise.backToLevel")}</Link>
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href={ccPath(locale, "/training/join")}>{t("common.seePlans")}</Link>
                  </Button>
                )
              }
            >
              {canUse && lockReason?.key === "passPrevious"
                ? t("ladder.reason.passPrevious", { level: formatNumber(lockReason.level, locale), passMark: formatNumber(lockReason.passMark, locale) })
                : canUse && lockReason?.key === "completePrevious"
                  ? t("ladder.reason.completePrevious", { level: formatNumber(lockReason.level, locale) })
                  : canUse
                    ? t("exercise.errors.locked")
                    : t("overview.notEnrolledText")}
            </Alert>
          ) : ex.test_id ? (
            <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-test">
              <div className="flex items-center gap-2">
                <Timer aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-test" className="title-section">
                  {t("exercise.testTitle")}
                </h2>
              </div>
              {linkedTest ? (
                <>
                  <p className="text-sm text-body">{t("exercise.testText", { minutes: formatNumber(linkedTest.minutes ?? ex.estimated_minutes ?? 60, locale) })}</p>
                  <Button asChild>
                    <Link href={ccPath(locale, `/test/${linkedTest.slug}`)}>{t("exercise.testOpen")}</Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-body">{t("exercise.testSoon")}</p>
              )}
            </section>
          ) : ex.expected_upload === "step" || ex.expected_upload === "pdf" ? (
            <ExerciseWorkspace
              slug={ex.slug}
              exerciseId={ex.id}
              userId={cc.user.id}
              accept={ex.expected_upload}
              passMark={Number(ex.pass_mark) || 80}
              hintCount={ex.hint_count}
              hasSolution={ex.has_solution_video}
              stepHelpSlug={EXPORT_STEP_HELP[actionSoftwareFor(track)]}
              initial={{
                best,
                attempts: counted.length,
                failed,
                passed,
                hintsAvailable: access.staff ? ex.hint_count : hintsAvailable(failed, ex.hint_count),
                solutionUnlocked: canSeeSolution({ hasVideo: ex.has_solution_video, passed, attempts: counted.length, staff: access.staff }),
              }}
            />
          ) : null}

          {!ex.test_id ? (
            <section className="neu space-y-3 p-6" aria-labelledby="cc-history">
              <div className="flex items-center gap-2">
                <History aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-history" className="title-card">
                  {t("exercise.historyTitle")}
                </h2>
              </div>
              {attempts.length === 0 ? (
                <p className="text-sm text-body">{t("exercise.historyEmpty")}</p>
              ) : (
                <ol className="divide-y divide-border">
                  {attempts.map((a) => {
                    const s = attemptState(a);
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block text-ink">{formatDateTime(a.created_at, locale)}</span>
                          {a.file_name ? (
                            <span className="block truncate text-xs text-body">
                              <Ltr>{a.file_name}</Ltr>
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          {a.percent != null ? <span className="font-semibold text-ink" dir="ltr">{`${pct(Number(a.percent))}%`}</span> : null}
                          <StatusChip tone={s.tone}>{t(`exercise.historyStatus.${s.key}`)}</StatusChip>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="neu space-y-2 p-5" aria-labelledby="cc-files">
            <h2 id="cc-files" className="title-card">
              {t("exercise.attachments")}
            </h2>
            {!open ? (
              <p className="flex items-center gap-2 text-sm text-body">
                <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
                {t("common.status.locked")}
              </p>
            ) : attachments.length === 0 ? (
              <p className="text-sm text-body">{t("exercise.attachmentsEmpty")}</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((d, i) => (
                  <li key={i}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="tap-target-y inline-flex items-center text-sm font-semibold text-accent underline underline-offset-2">
                      {d.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {lesson ? (
            <section className="neu space-y-2 p-5" aria-labelledby="cc-lessonlink">
              <div className="flex items-center gap-2">
                <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-lessonlink" className="title-card">
                  {t("exercise.lessonLink")}
                </h2>
              </div>
              <Link href={ccPath(locale, `/training/lessons/${lesson.slug}`)} className="tap-target-y inline-flex items-center text-sm font-semibold text-accent underline underline-offset-2">
                {pick(locale, lesson.title_en, lesson.title_ar)}
              </Link>
            </section>
          ) : null}
          {!open && !canUse ? <EmptyState icon={Lock} title={t("exercise.lockedTitle")} description={t("overview.notEnrolledText")} /> : null}
        </aside>
      </div>

      <SignedInExtras pageName={title} />
    </div>
  );
}

