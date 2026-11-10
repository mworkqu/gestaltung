"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { createHelpArticleAction, saveHelpArticleAction } from "@/app/[locale]/cad-champions/admin/help/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { GlossaryPicker } from "@/components/cad-champions/admin/lessons/glossary-picker";
import { FormError, SaveBar, Section, fieldHasError, selectCls, type SaveFailure } from "@/components/cad-champions/admin/lessons/shared";
import { BilingualMarkdownEditor } from "@/components/cad-champions/admin/markdown-editor";
import { Alert, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { slugify } from "@/lib/cad-champions/admin/lessons";
import type { CcHelpArticle } from "@/lib/cad-champions/db/types";
import { HELP_CATEGORY_IDS, normalizeHelpCategory } from "@/lib/cad-champions/help/categories";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

// Help article editor (Prompt 11): create and edit share this form. Bodies are
// markdown edited with a live preview, EN and AR side by side.

export function HelpArticleForm({ article, backHref, allSlugs }: { article: CcHelpArticle | null; backHref: string; allSlugs: string[] }) {
  const t = useTranslations("CC.admin.help");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [slug, setSlug] = React.useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = React.useState(!!article);
  const [category, setCategory] = React.useState<string>(article ? (normalizeHelpCategory(article.category) ?? article.category) : HELP_CATEGORY_IDS[0]);
  const [titleEn, setTitleEn] = React.useState(article?.title_en ?? "");
  const [titleAr, setTitleAr] = React.useState(article?.title_ar ?? "");
  const [bodyEn, setBodyEn] = React.useState(article?.body_en ?? "");
  const [bodyAr, setBodyAr] = React.useState(article?.body_ar ?? "");
  const [glossary, setGlossary] = React.useState<string[]>(article?.related_glossary_terms ?? []);
  const [related, setRelated] = React.useState((article?.related_slugs ?? []).join("\n"));
  const [videoId, setVideoId] = React.useState(article?.video_id ?? "");
  const [sort, setSort] = React.useState(String(article?.sort ?? 0));
  const [published, setPublished] = React.useState(article?.is_published ?? false);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<SaveFailure>(null);

  const knownCategory = (HELP_CATEGORY_IDS as readonly string[]).includes(category);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const raw = {
        slug,
        category,
        title_en: titleEn,
        title_ar: titleAr,
        body_en: bodyEn,
        body_ar: bodyAr,
        related_glossary_terms: glossary,
        related_slugs: related,
        video_id: videoId,
        sort,
        is_published: published,
      };
      if (article) {
        const res = await saveHelpArticleAction(article.id, raw);
        if (res.ok) {
          toast.success(tc("saved"), t("form.savedBody"));
          router.refresh();
        } else {
          setFailure({ error: res.error, detail: res.detail });
          toast.error(tc(`errors.${res.error}`));
        }
      } else {
        const res = await createHelpArticleAction(raw);
        if (res.ok) {
          toast.success(t("form.created"), t("form.createdBody"));
          router.push(ccPath(locale, `/admin/help/${res.data.id}`));
        } else {
          setFailure({ error: res.error, detail: res.detail });
          toast.error(tc(`errors.${res.error}`));
        }
      }
    } catch (err) {
      console.error("[cc-admin-help] save failed", err);
      setFailure({ error: "error" });
      toast.error(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormError failure={failure} />
      {fieldHasError(failure, "is_published") ? <Alert tone="warning" title={t("form.needsBody")} /> : null}

      <Section title={t("form.basics")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("form.category")}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} aria-invalid={fieldHasError(failure, "category") || undefined}>
              {!knownCategory ? <option value={category}>{category}</option> : null}
              {HELP_CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.slug")} hint={t("form.slugHint")}>
            <input
              dir="ltr"
              lang="en"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              className={inputCls + " font-mono"}
              aria-invalid={fieldHasError(failure, "slug") || undefined}
              required
            />
          </Field>
          <Field label={t("form.sort")} hint={t("form.sortHint")}>
            <input type="number" inputMode="numeric" min={0} max={9999} value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <CheckboxField label={t("form.published")} hint={t("form.publishedHint")} checked={published} onChange={setPublished} />
      </Section>

      <Section title={t("form.titles")}>
        <BilingualField
          label={t("form.title")}
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
      </Section>

      <Section title={t("form.body")} hint={t("form.bodyHint")}>
        <BilingualMarkdownEditor label={t("form.body")} rows={14} en={{ value: bodyEn, onChange: setBodyEn }} ar={{ value: bodyAr, onChange: setBodyAr }} />
      </Section>

      <Section title={t("form.related")}>
        <GlossaryPicker label={t("form.glossary")} selected={glossary} onChange={setGlossary} />
        <Field label={t("form.relatedSlugs")} hint={t("form.relatedSlugsHint")}>
          <textarea dir="ltr" lang="en" rows={3} value={related} onChange={(e) => setRelated(e.target.value)} className="min-h-24 w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </Field>
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer font-semibold text-accent">{t("form.existingSlugs", { count: allSlugs.length })}</summary>
          <p className="mt-2 flex flex-wrap gap-2">
            {allSlugs.map((s) => (
              <Ltr key={s} className="rounded-full bg-panel px-2 py-1 font-mono text-xs text-body">
                {s}
              </Ltr>
            ))}
          </p>
        </details>
        <Field label={t("form.video")} hint={t("form.videoHint")}>
          <input dir="ltr" lang="en" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="youtube:dQw4w9WgXcQ" className={inputCls + " font-mono text-xs"} aria-invalid={fieldHasError(failure, "video_id") || undefined} />
        </Field>
      </Section>

      <SaveBar
        saving={saving}
        label={article ? tc("save") : tc("create")}
        savingLabel={article ? tc("saving") : tc("creating")}
        extra={
          <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("backToList")}
          </Link>
        }
      />
    </form>
  );
}
