"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { createExerciseAction, updateExerciseAction } from "@/app/[locale]/cad-champions/admin/exercises/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, HelpTip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { briefFilesPrefix, slugify } from "@/lib/cad-champions/admin/test-builder";
import type { LevelOption, ModuleOption, SkillOption } from "@/lib/cad-champions/admin/test-builder-server";
import type { CcExercise } from "@/lib/cad-champions/db/types";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";

import { GradableFields, gradableFromRow, gradablePayload, type GradableState } from "./gradable-fields";
import { useAdminAction } from "./use-admin-action";

// Exercise fields (Prompt 11 Step B, Task 9 fields): level, slug, order,
// the shared task fields, pass mark, time, hints EN/AR, solution video,
// free sample. Publishing is separate (PublishPanel).

export function ExerciseForm({ exercise, levels, skills, modules }: { exercise: CcExercise | null; levels: LevelOption[]; skills: SkillOption[]; modules: ModuleOption[] }) {
  const t = useTranslations("CC.admin.exercises");
  const tt = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { run, busy } = useAdminAction();
  const [g, setG] = React.useState<GradableState>(() => gradableFromRow(exercise, { max_points: "100", grader_mode: "" }));
  const [extra, setExtra] = React.useState({
    level_id: exercise?.level_id ?? "",
    slug: exercise?.slug ?? "",
    sort: String(exercise?.sort ?? 0),
    pass_mark: String(exercise?.pass_mark ?? 80),
    estimated_minutes: exercise?.estimated_minutes == null ? "" : String(exercise.estimated_minutes),
    hints_en: (exercise?.hints_en ?? []).join("\n"),
    hints_ar: (exercise?.hints_ar ?? []).join("\n"),
    solution_video_id: exercise?.solution_video_id ?? "",
    is_free_sample: !!exercise?.is_free_sample,
  });
  const [slugTouched, setSlugTouched] = React.useState(!!exercise);
  const set = <K extends keyof typeof extra>(k: K, v: (typeof extra)[K]) => setExtra((p) => ({ ...p, [k]: v }));
  const label = (en: string, ar: string) => (locale === "ar" ? ar || en : en || ar);

  const onGradable = (next: GradableState) => {
    if (!slugTouched && next.title_en !== g.title_en) setExtra((p) => ({ ...p, slug: slugify(next.title_en) }));
    setG(next);
  };

  // Level choice also fills an empty competition module from its module.
  const onLevel = (id: string) => {
    set("level_id", id);
    const lv = levels.find((l) => l.id === id);
    if (lv?.competition_module && !g.competition_module) setG((p) => ({ ...p, competition_module: lv.competition_module ?? "" }));
  };

  const groups = React.useMemo(() => {
    const m = new Map<string, LevelOption[]>();
    for (const l of levels) m.set(l.moduleId, [...(m.get(l.moduleId) ?? []), l]);
    return [...m.values()];
  }, [levels]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...gradablePayload(g), ...extra };
    if (exercise) {
      const res = await run(() => updateExerciseAction(exercise.id, payload), { success: tc("saved") });
      if (res?.ok && res.data.slug !== exercise.slug) router.replace(ccPath(locale, `/admin/exercises/${res.data.slug}`));
    } else {
      const res = await run(() => createExerciseAction(payload), { success: t("created"), successBody: t("createdBody"), refresh: false });
      if (res?.ok) router.push(ccPath(locale, `/admin/exercises/${res.data.slug}`));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={t("fields.level")} hint={t("levelHint")}>
          <select className={inputCls} required value={extra.level_id} onChange={(e) => onLevel(e.target.value)}>
            <option value="">{t("chooseLevel")}</option>
            {groups.map((list) => (
              <optgroup key={list[0].moduleId} label={label(list[0].moduleTitle_en, list[0].moduleTitle_ar)}>
                {list.map((l) => (
                  <option key={l.id} value={l.id}>
                    {t("levelOption", { n: formatNumber(l.level_number, locale), title: label(l.title_en, l.title_ar) })}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={tt("fields.slug")} hint={t("slugHint")}>
          <input
            className={inputCls}
            dir="ltr"
            required
            pattern="[a-z0-9-]{1,80}"
            value={extra.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label={tt("fields.sort")} hint={t("sortHint")}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={extra.sort} onChange={(e) => set("sort", e.target.value)} />
        </Field>
      </div>

      <GradableFields value={g} onChange={onGradable} skills={skills} modules={modules} attachmentsPrefix={exercise ? briefFilesPrefix("exercise", exercise.id) : null} skillOptional />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={tt("fields.pass_mark")} hint={t("passMarkHint")}>
          <input className={inputCls} dir="ltr" inputMode="decimal" value={extra.pass_mark} onChange={(e) => set("pass_mark", e.target.value)} />
        </Field>
        <Field label={tt("fields.estimated_minutes")}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={extra.estimated_minutes} onChange={(e) => set("estimated_minutes", e.target.value)} />
        </Field>
        <Field label={tt("fields.solution_video_id")} hint={t("videoHint")}>
          <input className={inputCls} dir="ltr" value={extra.solution_video_id} onChange={(e) => set("solution_video_id", e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1 text-sm font-semibold text-ink">
          {t("hintsTitle")}
          <HelpTip label={t("hintsHelpLabel")}>{t("hintsHelp")}</HelpTip>
        </span>
        <BilingualField label={t("hintsLabel")} hint={t("hintsHint")} multiline rows={4} en={{ value: extra.hints_en, onChange: (v) => set("hints_en", v) }} ar={{ value: extra.hints_ar, onChange: (v) => set("hints_ar", v) }} />
      </div>

      <CheckboxField label={t("freeSample")} hint={t("freeSampleHint")} checked={extra.is_free_sample} onChange={(v) => set("is_free_sample", v)} />

      <div>
        <Button type="submit" loading={busy} loadingText={exercise ? tc("saving") : tc("creating")}>
          {exercise ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
