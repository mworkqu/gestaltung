"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { saveModuleAction } from "@/app/[locale]/cad-champions/admin/lessons/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { useToast } from "@/components/cad-champions/ui";
import { CC_COMPETITION_MODULE_CODES, type CcModule } from "@/lib/cad-champions/db/types";
import { Ltr } from "@/lib/cad-champions/ltr";

import { FormError, SaveBar, Section, fieldHasError, selectCls, type SaveFailure } from "./shared";

// Module editor (Prompt 11). The slug is shown but not editable: the student
// URLs and the training catalog constants point at it.

export function ModuleForm({ module: m, backHref }: { module: CcModule; backHref: string }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const router = useRouter();
  const toast = useToast();
  const [titleEn, setTitleEn] = React.useState(m.title_en);
  const [titleAr, setTitleAr] = React.useState(m.title_ar);
  const [descEn, setDescEn] = React.useState(m.description_en ?? "");
  const [descAr, setDescAr] = React.useState(m.description_ar ?? "");
  const [whyEn, setWhyEn] = React.useState(m.why_it_matters_en ?? "");
  const [whyAr, setWhyAr] = React.useState(m.why_it_matters_ar ?? "");
  const [skillArea, setSkillArea] = React.useState(m.skill_area_id == null ? "" : String(m.skill_area_id));
  const [compModule, setCompModule] = React.useState(m.competition_module ?? "");
  const [icon, setIcon] = React.useState(m.icon ?? "");
  const [sort, setSort] = React.useState(String(m.sort));
  const [orientation, setOrientation] = React.useState(m.is_orientation);
  const [published, setPublished] = React.useState(m.is_published);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<SaveFailure>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const res = await saveModuleAction(m.id, {
        title_en: titleEn,
        title_ar: titleAr,
        description_en: descEn,
        description_ar: descAr,
        why_it_matters_en: whyEn,
        why_it_matters_ar: whyAr,
        skill_area_id: skillArea,
        competition_module: compModule,
        icon,
        sort,
        is_orientation: orientation,
        is_published: published,
      });
      if (res.ok) {
        toast.success(tc("saved"), t("module.savedBody"));
        router.refresh();
      } else {
        setFailure({ error: res.error, detail: res.detail });
        toast.error(tc(`errors.${res.error}`));
      }
    } catch (err) {
      console.error("[cc-admin-lessons] module save failed", err);
      setFailure({ error: "error" });
      toast.error(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormError failure={failure} />
      <Section title={t("module.basics")}>
        <p className="text-sm text-body">
          {t("module.slug")}: <Ltr className="font-mono">{m.slug}</Ltr>
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("lesson.skillArea")} hint={t("module.skillAreaHint")}>
            <select value={skillArea} onChange={(e) => setSkillArea(e.target.value)} className={selectCls} aria-invalid={fieldHasError(failure, "skill_area_id") || undefined}>
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
          <Field label={t("module.icon")} hint={t("module.iconHint")}>
            <input dir="ltr" lang="en" value={icon} onChange={(e) => setIcon(e.target.value)} className={inputCls + " font-mono"} aria-invalid={fieldHasError(failure, "icon") || undefined} />
          </Field>
          <Field label={t("lesson.sort")} hint={t("module.sortHint")}>
            <input type="number" inputMode="numeric" min={0} max={9999} value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CheckboxField label={t("module.orientation")} hint={t("module.orientationHint")} checked={orientation} onChange={setOrientation} />
          <CheckboxField label={t("lesson.published")} hint={t("module.publishedHint")} checked={published} onChange={setPublished} />
        </div>
      </Section>
      <Section title={t("module.texts")}>
        <BilingualField label={t("lesson.title")} required maxLength={200} en={{ value: titleEn, onChange: setTitleEn }} ar={{ value: titleAr, onChange: setTitleAr }} />
        <BilingualField label={t("module.description")} multiline rows={3} maxLength={2000} en={{ value: descEn, onChange: setDescEn }} ar={{ value: descAr, onChange: setDescAr }} />
        <BilingualField label={t("module.whyItMatters")} hint={t("module.whyItMattersHint")} multiline rows={3} maxLength={2000} en={{ value: whyEn, onChange: setWhyEn }} ar={{ value: whyAr, onChange: setWhyAr }} />
      </Section>
      <SaveBar
        saving={saving}
        label={tc("save")}
        savingLabel={tc("saving")}
        extra={
          <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("backToTree")}
          </Link>
        }
      />
    </form>
  );
}
