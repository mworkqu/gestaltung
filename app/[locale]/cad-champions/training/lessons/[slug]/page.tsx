import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleAlert, ClipboardList, Download, Lock, MessageCircleQuestion, Target } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { AskQuestion } from "@/components/cad-champions/training/ask-question";
import { BackToTraining, TrainingUnavailable } from "@/components/cad-champions/training/page-bits";
import { TrackSwitcher } from "@/components/cad-champions/training/track-switcher";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip, Term } from "@/components/cad-champions/ui";
import { LessonPlayer } from "@/components/cad-champions/video/lesson-player";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import type { CcLesson, CcLessonQuestion } from "@/lib/cad-champions/db/types";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { GLOSSARY_IDS, type GlossaryId } from "@/lib/cad-champions/glossary";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { canWatchLesson } from "@/lib/cad-champions/training/access";
import { isExercisePassed } from "@/lib/cad-champions/training/ladder";
import { loadTrainingState, locate, pick, signedFileLinks } from "@/lib/cad-champions/training/server";
import { isNeutralLesson, lessonVideos, pickVideoSlot, trackNoteFor } from "@/lib/cad-champions/training/video-pick";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Lesson page (Prompt 9 Step E + F): objectives, video (track + language
// pick with notes and the track switcher), notes, common mistakes,
// downloads, glossary terms, Q&A, previous / next and "Go to exercise".
// Notes, video and downloads only for students with access (server check).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

const PUBLIC_COLUMNS =
  "id,level_id,competition_module,skill_area_id,slug,sort,title_en,title_ar,objectives_en,objectives_ar,duration_minutes,glossary_terms,track_notes,is_free_preview,is_published";
const CONTENT_COLUMNS =
  "video_inventor_en,video_inventor_ar,video_fusion_en,video_fusion_ar,video_solidworks_en,video_solidworks_ar,video_neutral_en,video_neutral_ar,notes_en,notes_ar,common_mistakes_en,common_mistakes_ar,downloads";

type PublicLesson = Pick<
  CcLesson,
  | "id"
  | "level_id"
  | "competition_module"
  | "skill_area_id"
  | "slug"
  | "sort"
  | "title_en"
  | "title_ar"
  | "objectives_en"
  | "objectives_ar"
  | "duration_minutes"
  | "glossary_terms"
  | "track_notes"
  | "is_free_preview"
  | "is_published"
>;
type LessonContent = Pick<
  CcLesson,
  | "video_inventor_en"
  | "video_inventor_ar"
  | "video_fusion_en"
  | "video_fusion_ar"
  | "video_solidworks_en"
  | "video_solidworks_ar"
  | "video_neutral_en"
  | "video_neutral_ar"
  | "notes_en"
  | "notes_ar"
  | "common_mistakes_en"
  | "common_mistakes_ar"
  | "downloads"
>;

/** The catalog part of a lesson, with the student's session (RLS: published, or staff). */
async function loadLesson(slug: string): Promise<PublicLesson | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  try {
    const db = await createClient();
    const { data } = await db.from("cc_lessons").select(PUBLIC_COLUMNS).eq("slug", slug).maybeSingle<PublicLesson>();
    return data ?? null;
  } catch {
    return null;
  }
}

/** Paid content (notes, videos, downloads): service role, only after the access check. */
async function loadContent(id: string): Promise<LessonContent | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data } = await service.from("cc_lessons").select(CONTENT_COLUMNS).eq("id", id).maybeSingle<LessonContent>();
  return data ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const lesson = await loadLesson(slug);
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: `/training/lessons/${slug}`, title: lesson ? pick(locale, lesson.title_en, lesson.title_ar) : t("overview") });
}

type Question = Pick<CcLessonQuestion, "id" | "body" | "answer" | "status" | "created_at" | "image_path" | "user_id" | "public">;

async function loadQuestions(userId: string, lessonId: string): Promise<{ own: (Question & { imageUrl: string | null })[]; faq: Question[] }> {
  try {
    const db = await createClient();
    const [own, faq] = await Promise.all([
      db.from("cc_lesson_questions").select("id,body,answer,status,created_at,image_path,user_id,public").eq("lesson_id", lessonId).eq("user_id", userId).eq("kind", "lesson").order("created_at", { ascending: false }).limit(20),
      db.from("cc_lesson_questions").select("id,body,answer,status,created_at,image_path,user_id,public").eq("lesson_id", lessonId).eq("kind", "lesson").eq("public", true).eq("status", "answered").neq("user_id", userId).order("answered_at", { ascending: false }).limit(20),
    ]);
    const service = createServiceClient();
    const ownRows = await Promise.all(
      ((own.data ?? []) as Question[]).map(async (q) => {
        let imageUrl: string | null = null;
        if (q.image_path && service && q.image_path.startsWith(`${userId}/`)) {
          const { data } = await service.storage.from("cc-submissions").createSignedUrl(q.image_path, 600);
          imageUrl = data?.signedUrl ?? null;
        }
        return { ...q, imageUrl };
      })
    );
    return { own: ownRows, faq: (faq.data ?? []) as Question[] };
  } catch {
    return { own: [], faq: [] };
  }
}

export default async function CcLessonPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/training/lessons/${slug}`));
  const t = await getTranslations({ locale, namespace: "CC.training" });

  const [state, lesson] = await Promise.all([loadTrainingState(cc), loadLesson(slug)]);
  const where = state.ok && lesson ? locate(state.catalog, state.progress, state.access, { lessonId: lesson.id }) : null;
  if (!state.ok || !lesson || !where) {
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
  const title = pick(locale, lesson.title_en, lesson.title_ar);
  const hasAccess = canWatchLesson(access, { is_free_preview: lesson.is_free_preview, isOrientation: mod.isOrientation });
  const levelLocked = !access.staff && levelState?.status === "locked" && levelState.reason?.key !== "enroll";
  const open = hasAccess && !levelLocked;
  const track = cc.profile?.track_software ?? "inventor";
  const content = open ? await loadContent(lesson.id) : null;
  const videos = lessonVideos(content ?? {});
  const pickResult = pickVideoSlot(videos, track, locale);
  const trackNote = trackNoteFor(lesson.track_notes, track);
  const info = progress.lessons.get(lesson.id);
  const objectives = (locale === "ar" && lesson.objectives_ar.length ? lesson.objectives_ar : lesson.objectives_en) ?? [];
  const notes = pick(locale, content?.notes_en, content?.notes_ar);
  const mistakes = pick(locale, content?.common_mistakes_en, content?.common_mistakes_ar);
  const terms = (lesson.glossary_terms ?? []).filter((x): x is GlossaryId => (GLOSSARY_IDS as string[]).includes(x));
  const downloads = open && content ? await signedFileLinks("cc-lesson-files", content.downloads, locale) : [];
  const questions = open ? await loadQuestions(cc.user.id, lesson.id) : { own: [], faq: [] };

  // Previous / next across the module (levels in order, lessons by sort).
  const flat = mod.levels.flatMap((l) => l.lessons);
  const idx = flat.findIndex((x) => x.id === lesson.id);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const exercise = level.exercises.find((e) => !isExercisePassed(progress.bestPercent.get(e.id), e.passMark)) ?? level.exercises[0] ?? null;
  const lockReason = levelState?.reason;

  return (
    <div className="container page-stack">
      <PageHeader
        title={title}
        purpose={`${pick(locale, mod.title_en, mod.title_ar)} · ${pick(locale, level.title_en, level.title_ar)}`}
        actions={<BackToTraining locale={locale} href={ccPath(locale, `/training/${mod.slug}`)} />}
      />

      <div className="flex flex-wrap gap-2">
        {lesson.skill_area_id ? <StatusChip tone="neutral">{`${t("common.skillArea")}: ${t(`common.areas.${lesson.skill_area_id}` as "common.areas.1")}`}</StatusChip> : null}
        {lesson.competition_module ? <StatusChip tone="info">{`${t("common.competitionModule")} ${lesson.competition_module}`}</StatusChip> : null}
        {lesson.is_free_preview ? <StatusChip tone="success">{t("common.freePreview")}</StatusChip> : null}
        {lesson.duration_minutes ? <StatusChip tone="neutral">{t("lesson.duration", { minutes: formatNumber(lesson.duration_minutes, locale) })}</StatusChip> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {objectives.length > 0 ? (
            <section className="neu space-y-2 p-6" aria-labelledby="cc-objectives">
              <div className="flex items-center gap-2">
                <Target aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-objectives" className="title-card">
                  {t("lesson.objectives")}
                </h2>
              </div>
              <ul className="list-disc space-y-1 ps-5 text-sm text-body">
                {objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {!open ? (
            <Alert
              tone="info"
              title={hasAccess ? t("lesson.levelLockedTitle") : t("lesson.lockedTitle")}
              action={
                hasAccess ? (
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
              {hasAccess && lockReason?.key === "passPrevious"
                ? t("ladder.reason.passPrevious", { level: formatNumber(lockReason.level, locale), passMark: formatNumber(lockReason.passMark, locale) })
                : hasAccess && lockReason?.key === "completePrevious"
                  ? t("ladder.reason.completePrevious", { level: formatNumber(lockReason.level, locale) })
                  : t("lesson.lockedText")}
            </Alert>
          ) : (
            <>
              <section className="space-y-3" aria-label={t("player.label", { title })}>
                {!isNeutralLesson(videos) ? <TrackSwitcher current={track} /> : null}
                {pickResult.note ? <p className="text-sm text-body">{t(`player.note.${pickResult.note}`)}</p> : null}
                {trackNote ? (
                  <Alert tone="info" title={trackNote.kind === "inventor_only" ? t("player.inventorOnly") : t("player.equivalent", { text: pick(locale, trackNote.en, trackNote.ar) })} />
                ) : null}
                <LessonPlayer slug={lesson.slug} title={title} slot={pickResult.slot} resumeSecond={info?.lastSecond ?? 0} completed={!!info?.completed} />
              </section>

              <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-notes">
                <h2 id="cc-notes" className="title-section">
                  {t("lesson.notes")}
                </h2>
                {notes ? <ArticleBody markdown={notes} locale={locale} hasVideoId={false} /> : <p className="text-sm text-body">{t("lesson.notesSoon")}</p>}
              </section>

              {mistakes ? (
                <section className="neu space-y-3 border-s-4 border-inventory p-6" aria-labelledby="cc-mistakes">
                  <div className="flex items-center gap-2">
                    <CircleAlert aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-inventory" />
                    <h2 id="cc-mistakes" className="title-card">
                      {t("lesson.mistakes")}
                    </h2>
                  </div>
                  <ArticleBody markdown={mistakes} locale={locale} hasVideoId={false} />
                </section>
              ) : null}

              <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby="cc-ask">
                <div className="flex items-center gap-2">
                  <MessageCircleQuestion aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                  <h2 id="cc-ask" className="title-section">
                    {t("ask.title")}
                  </h2>
                  <HelpTip label={t("ask.title")}>{t("ask.help")}</HelpTip>
                </div>
                <AskQuestion slug={lesson.slug} userId={cc.user.id} />

                <div className="space-y-2">
                  <h3 className="title-card">{t("ask.yourQuestions")}</h3>
                  {questions.own.length === 0 ? (
                    <p className="text-sm text-body">{t("ask.yourEmpty")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {questions.own.map((q) => (
                        <li key={q.id} className="tile space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-body">{t("ask.asked", { date: formatDate(q.created_at, locale) })}</span>
                            <StatusChip tone={q.status === "answered" ? "success" : "warning"}>{q.status === "answered" ? t("ask.answered") : t("ask.waiting")}</StatusChip>
                          </div>
                          <p className="whitespace-pre-line text-sm text-ink">{q.body}</p>
                          {q.imageUrl ? (
                            <a href={q.imageUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent underline underline-offset-2">
                              {t("ask.viewImage")}
                            </a>
                          ) : null}
                          {q.answer ? (
                            <div className="rounded-xl border border-buy/20 bg-buy-bg p-3">
                              <p className="text-xs font-semibold text-buy">{t("ask.answer")}</p>
                              <p className="whitespace-pre-line text-sm text-ink">{q.answer}</p>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="title-card">{t("ask.faqTitle")}</h3>
                  {questions.faq.length === 0 ? (
                    <p className="text-sm text-body">{t("ask.faqEmpty")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {questions.faq.map((q) => (
                        <li key={q.id} className="tile space-y-2">
                          <p className="whitespace-pre-line text-sm font-semibold text-ink">{q.body}</p>
                          {q.answer ? <p className="whitespace-pre-line text-sm text-body">{q.answer}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="space-y-4">
          {open ? (
            <section className="neu space-y-2 p-5" aria-labelledby="cc-downloads">
              <div className="flex items-center gap-2">
                <Download aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-downloads" className="title-card">
                  {t("lesson.downloads")}
                </h2>
              </div>
              {downloads.length === 0 ? (
                <p className="text-sm text-body">{t("lesson.downloadsEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {downloads.map((d, i) => (
                    <li key={i}>
                      <a href={d.url} className="tap-target-y inline-flex items-center text-sm font-semibold text-accent underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                        {d.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {terms.length > 0 ? (
            <section className="neu space-y-2 p-5" aria-labelledby="cc-terms">
              <h2 id="cc-terms" className="title-card">
                {t("lesson.terms")}
              </h2>
              <ul className="flex flex-wrap gap-x-3 gap-y-2 text-sm">
                {terms.map((id) => (
                  <li key={id}>
                    <Term id={id} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {exercise ? (
            <section className="neu space-y-2 p-5" aria-labelledby="cc-goex">
              <div className="flex items-center gap-2">
                <ClipboardList aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
                <h2 id="cc-goex" className="title-card">
                  {t("ladder.exercisesTitle")}
                </h2>
              </div>
              <p className="text-sm text-ink">{pick(locale, exercise.title_en, exercise.title_ar)}</p>
              <Button asChild>
                <Link href={ccPath(locale, `/training/exercises/${exercise.slug}`)}>{t("lesson.goExercise")}</Link>
              </Button>
            </section>
          ) : null}

          {!open && !hasAccess ? <EmptyState icon={Lock} title={t("lesson.lockedTitle")} description={t("lesson.lockedText")} /> : null}
        </aside>
      </div>

      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t("lesson.next")}>
        {prev ? (
          <Button asChild variant="secondary">
            <Link href={ccPath(locale, `/training/lessons/${prev.slug}`)}>
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
              {t("lesson.prev")}: {pick(locale, prev.title_en, prev.title_ar)}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button asChild variant="secondary">
            <Link href={ccPath(locale, `/training/lessons/${next.slug}`)}>
              {t("lesson.next")}: {pick(locale, next.title_en, next.title_ar)}
              <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        ) : null}
      </nav>

      <SignedInExtras pageName={title} />
    </div>
  );
}
