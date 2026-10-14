"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { createLessonAction, deleteLessonAction, moveLessonAction } from "@/app/[locale]/cad-champions/admin/lessons/actions";
import { BilingualField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, ConfirmDialog, EmptyState, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { recordedVideos, slugify } from "@/lib/cad-champions/admin/lessons";
import type { LessonListRow } from "@/lib/cad-champions/admin/lessons-server";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

import { FormError, type SaveFailure } from "./shared";
import { FreePreviewToggle, PublishToggle } from "./toggles";

// The lessons of one level: reorder (up / down), edit, free preview, publish,
// delete (ConfirmDialog) and a "new lesson" form.

export function LessonList({ levelId, lessons }: { levelId: string; lessons: LessonListRow[] }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [moving, setMoving] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<LessonListRow | null>(null);
  const [adding, setAdding] = React.useState(false);

  async function move(id: string, direction: "up" | "down") {
    setMoving(id);
    try {
      const res = await moveLessonAction(id, direction);
      if (res.ok) router.refresh();
      else toast.error(tc(`errors.${res.error}`));
    } catch (e) {
      console.error("[cc-admin-lessons] move failed", e);
      toast.error(tc("errors.error"));
    } finally {
      setMoving(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const res = await deleteLessonAction(toDelete.id);
    if (res.ok) {
      toast.success(t("list.deleted", { title: toDelete.title_en }));
      setToDelete(null);
      router.refresh();
    } else {
      toast.error(tc(`errors.${res.error}`));
      setToDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {lessons.length === 0 ? (
        <EmptyState icon={BookOpen} title={t("list.emptyTitle")} description={t("list.emptyBody")} />
      ) : (
        <ol className="flex flex-col gap-3">
          {lessons.map((l, i) => {
            const title = locale === "ar" ? l.title_ar || l.title_en : l.title_en || l.title_ar;
            const videos = recordedVideos(l);
            return (
              <li key={l.id} className="neu flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveUp")} disabled={i === 0 || moving !== null} onClick={() => move(l.id, "up")}>
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveDown")} disabled={i === lessons.length - 1 || moving !== null} onClick={() => move(l.id, "down")}>
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center text-sm font-bold text-mutedtext">{formatNumber(i + 1, locale)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={ccPath(locale, `/admin/lessons/lesson/${l.id}`)} className="text-base font-bold text-heading underline-offset-2 hover:underline">
                    {title}
                  </Link>
                  <p className="mt-0.5 text-xs text-mutedtext">
                    <Ltr className="font-mono">{l.slug}</Ltr>
                    {" · "}
                    {t("list.videos", { count: formatNumber(videos, locale), total: formatNumber(8, locale) })}
                    {l.duration_minutes ? ` · ${t("list.minutes", { count: formatNumber(l.duration_minutes, locale) })}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FreePreviewToggle id={l.id} value={l.is_free_preview} name={title} />
                  <PublishToggle entity="lesson" id={l.id} published={l.is_published} name={title} />
                  <Button asChild variant="secondary" size="sm">
                    <Link href={ccPath(locale, `/admin/lessons/lesson/${l.id}`)}>{tc("edit")}</Link>
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setToDelete(l)} aria-label={t("list.deleteNamed", { name: title })}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    {tc("delete")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding ? (
        <NewLessonForm levelId={levelId} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("list.addLesson")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (!o ? setToDelete(null) : undefined)}
        title={t("list.deleteTitle", { title: toDelete?.title_en ?? "" })}
        consequence={t("list.deleteConsequence")}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        tone="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function NewLessonForm({ levelId, onDone }: { levelId: string; onDone: () => void }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [titleEn, setTitleEn] = React.useState("");
  const [titleAr, setTitleAr] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<SaveFailure>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const res = await createLessonAction(levelId, { slug, title_en: titleEn, title_ar: titleAr });
      if (res.ok) {
        toast.success(t("list.created"), t("list.createdBody"));
        router.push(ccPath(locale, `/admin/lessons/lesson/${res.data.id}`));
      } else {
        setFailure({ error: res.error, detail: res.detail });
        toast.error(tc(`errors.${res.error}`));
      }
    } catch (err) {
      console.error("[cc-admin-lessons] create failed", err);
      setFailure({ error: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="neu flex flex-col gap-4 p-5" noValidate>
      <h3 className="title-card">{t("list.newLesson")}</h3>
      <FormError failure={failure} />
      <BilingualField
        label={t("lesson.title")}
        required
        maxLength={200}
        en={{
          value: titleEn,
          onChange: (v) => {
            setTitleEn(v);
            if (!slugTouched) setSlug(slugify(v));
          },
        }}
        ar={{ value: titleAr, onChange: setTitleAr }}
      />
      <Field label={t("lesson.slug")} hint={t("lesson.slugHint")}>
        <input
          dir="ltr"
          lang="en"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          className={inputCls + " font-mono"}
          required
        />
      </Field>
      <p className="text-xs text-mutedtext">{t("list.newHint")}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving} loadingText={tc("creating")}>
          {tc("create")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
