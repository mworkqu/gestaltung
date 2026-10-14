"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { saveLessonAction } from "@/app/[locale]/cad-champions/admin/lessons/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { BilingualMarkdownEditor } from "@/components/cad-champions/admin/markdown-editor";
import { Alert, useToast } from "@/components/cad-champions/ui";
import {
  VIDEO_TRACK_ORDER,
  linesToText,
  parseDownloads,
  parseTrackNotes,
  type LessonDownload,
  type TrackNotesState,
} from "@/lib/cad-champions/admin/lessons";
import { CC_COMPETITION_MODULE_CODES, type CcLesson } from "@/lib/cad-champions/db/types";

import { DownloadsField } from "./downloads-field";
import { GlossaryPicker } from "./glossary-picker";
import { FormError, SaveBar, Section, fieldHasError, selectCls, type SaveFailure } from "./shared";
import { TrackNotesField } from "./track-notes-field";
import { VideoField } from "./video-field";

// Lesson editor (Prompt 11): every column of cc_lessons in one form, EN and
// AR side by side. Videos, notes and downloads are read and written with the
// service role on the server (students cannot select them since 0083).

type VideoState = Record<string, string>;

const VIDEO_KEYS = VIDEO_TRACK_ORDER.flatMap((track) => (["en", "ar"] as const).map((lang) => `${track}_${lang}`));

export function LessonForm({ lesson, backHref }: { lesson: CcLesson; backHref: string }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const router = useRouter();
  const toast = useToast();

  const rec = lesson as unknown as Record<string, unknown>;
  const savedVideos: VideoState = Object.fromEntries(VIDEO_KEYS.map((k) => [k, (rec[`video_${k}`] as string | null) ?? ""]));
  const [slug, setSlug] = React.useState(lesson.slug);
  const [sort, setSort] = React.useState(String(lesson.sort));
  const [titleEn, setTitleEn] = React.useState(lesson.title_en);
  const [titleAr, setTitleAr] = React.useState(lesson.title_ar);
  const [objEn, setObjEn] = React.useState(linesToText(lesson.objectives_en));
  const [objAr, setObjAr] = React.useState(linesToText(lesson.objectives_ar));
  const [duration, setDuration] = React.useState(lesson.duration_minutes == null ? "" : String(lesson.duration_minutes));
  const [skillArea, setSkillArea] = React.useState(lesson.skill_area_id == null ? "" : String(lesson.skill_area_id));
  const [compModule, setCompModule] = React.useState(lesson.competition_module ?? "");
  const [notesEn, setNotesEn] = React.useState(lesson.notes_en ?? "");
  const [notesAr, setNotesAr] = React.useState(lesson.notes_ar ?? "");
  const [mistakesEn, setMistakesEn] = React.useState(lesson.common_mistakes_en ?? "");
  const [mistakesAr, setMistakesAr] = React.useState(lesson.common_mistakes_ar ?? "");
  const [videos, setVideos] = React.useState<VideoState>(savedVideos);
  const [downloads, setDownloads] = React.useState<LessonDownload[]>(() => parseDownloads(lesson.downloads));
  const [glossary, setGlossary] = React.useState<string[]>(lesson.glossary_terms ?? []);
  const [trackNotes, setTrackNotes] = React.useState<TrackNotesState>(() => parseTrackNotes(lesson.track_notes));
  const [freePreview, setFreePreview] = React.useState(lesson.is_free_preview);
  const [published, setPublished] = React.useState(lesson.is_published);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<SaveFailure>(null);

  // The slug the preview player uses is the SAVED one.
  const savedSlug = lesson.slug;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const raw: Record<string, unknown> = {
        slug,
        sort,
        title_en: titleEn,
        title_ar: titleAr,
        objectives_en: objEn,
        objectives_ar: objAr,
        duration_minutes: duration,
        skill_area_id: skillArea,
        competition_module: compModule,
        notes_en: notesEn,
        notes_ar: notesAr,
        common_mistakes_en: mistakesEn,
        common_mistakes_ar: mistakesAr,
        downloads,
        glossary_terms: glossary,
        track_notes: trackNotes,
        is_free_preview: freePreview,
        is_published: published,
      };
      for (const k of VIDEO_KEYS) raw[`video_${k}`] = videos[k];
      const res = await saveLessonAction(lesson.id, raw);
      if (res.ok) {
        toast.success(tc("saved"), t("lesson.savedBody"));
        router.refresh();
      } else {
        setFailure({ error: res.error, detail: res.detail });
        toast.error(tc(`errors.${res.error}`));
      }
    } catch (err) {
      console.error("[cc-admin-lessons] save failed", err);
      setFailure({ error: "error" });
      toast.error(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  const invalidTracks = (["fusion", "solidworks"] as const).filter((tr) => fieldHasError(failure, `track_${tr}`));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormError failure={failure} />

      <Section title={t("lesson.basics")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("lesson.slug")} hint={t("lesson.slugHint")}>
            <input dir="ltr" lang="en" value={slug} onChange={(e) => setSlug(e.target.value)} className={inputCls + " font-mono"} aria-invalid={fieldHasError(failure, "slug") || undefined} required />
          </Field>
          <Field label={t("lesson.sort")} hint={t("lesson.sortHint")}>
            <input type="number" inputMode="numeric" min={0} max={9999} value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("lesson.duration")} hint={t("lesson.durationHint")}>
            <input type="number" inputMode="numeric" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("lesson.skillArea")}>
            <select value={skillArea} onChange={(e) => setSkillArea(e.target.value)} className={selectCls}>
              <option value="">{tc("none")}</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}. {t(`areas.${n}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("lesson.competitionModule")}>
            <select value={compModule} onChange={(e) => setCompModule(e.target.value)} className={selectCls}>
              <option value="">{tc("none")}</option>
              {CC_COMPETITION_MODULE_CODES.map((c) => (
                <option key={c} value={c}>
                  {c} · {t(`competitionModules.${c}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CheckboxField label={t("lesson.freePreview")} hint={t("lesson.freePreviewHint")} checked={freePreview} onChange={setFreePreview} />
          <CheckboxField label={t("lesson.published")} hint={t("lesson.publishedHint")} checked={published} onChange={setPublished} />
        </div>
        {freePreview && !published ? <Alert tone="info" title={t("lesson.freeNotPublished")} /> : null}
      </Section>

      <Section title={t("lesson.titles")}>
        <BilingualField label={t("lesson.title")} required maxLength={200} en={{ value: titleEn, onChange: setTitleEn }} ar={{ value: titleAr, onChange: setTitleAr }} />
        <BilingualField label={t("lesson.objectives")} hint={t("lesson.objectivesHint")} multiline rows={5} en={{ value: objEn, onChange: setObjEn }} ar={{ value: objAr, onChange: setObjAr }} />
      </Section>

      <Section title={t("lesson.notes")} hint={t("lesson.notesHint")}>
        <BilingualMarkdownEditor label={t("lesson.notes")} en={{ value: notesEn, onChange: setNotesEn }} ar={{ value: notesAr, onChange: setNotesAr }} />
        <BilingualMarkdownEditor label={t("lesson.commonMistakes")} rows={6} en={{ value: mistakesEn, onChange: setMistakesEn }} ar={{ value: mistakesAr, onChange: setMistakesAr }} />
      </Section>

      <Section title={t("lesson.videos")} hint={t("lesson.videosHint")}>
        {VIDEO_TRACK_ORDER.map((track) => (
          <div key={track} className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-heading">{t(`tracks.${track}`)}</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(["en", "ar"] as const).map((lang) => {
                const key = `${track}_${lang}`;
                return (
                  <VideoField
                    key={key}
                    slot={key}
                    label={`${t(`tracks.${track}`)} · ${lang === "ar" ? tc("arabic") : tc("english")}`}
                    lessonSlug={savedSlug}
                    value={videos[key] ?? ""}
                    savedValue={savedVideos[key] ?? ""}
                    onChange={(v) => setVideos((s) => ({ ...s, [key]: v }))}
                    invalid={fieldHasError(failure, `video_${key}`)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </Section>

      <Section title={t("lesson.downloads")} hint={t("lesson.downloadsHint")}>
        <DownloadsField lessonId={lesson.id} items={downloads} onChange={setDownloads} />
      </Section>

      <Section title={t("lesson.glossary")} hint={t("lesson.glossaryHint")}>
        <GlossaryPicker label={t("lesson.glossary")} selected={glossary} onChange={setGlossary} />
      </Section>

      <Section title={t("lesson.trackNotes")} hint={t("lesson.trackNotesHint")}>
        <TrackNotesField value={trackNotes} onChange={setTrackNotes} invalid={invalidTracks} />
      </Section>

      <SaveBar
        saving={saving}
        label={tc("save")}
        savingLabel={tc("saving")}
        extra={
          <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("lesson.backToLevel")}
          </Link>
        }
      />
    </form>
  );
}
