"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { BilingualField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { BilingualMarkdownEditor } from "@/components/cad-champions/admin/markdown-editor";
import { HelpTip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { TOLERANCE_KEYS, type ToleranceKey } from "@/lib/cad-champions/admin/test-builder";
import {
  CC_EXPECTED_UPLOADS,
  CC_GRADER_MODES,
  CC_GRADING_MODES,
  type CcAttachment,
  type CcCompetitionModule,
  type CcSkillArea,
  type CcTestTask,
} from "@/lib/cad-champions/db/types";

import { AttachmentsEditor } from "./attachments-editor";

// The fields a test task and an exercise share: skill area, competition
// module, titles, brief (markdown EN + AR), files, expected upload, points,
// grading mode, grader mode, density, material and tolerances.

/** Grader defaults (grader/app/compare.py DEFAULT_TOLERANCES), shown as placeholders in %. */
const DEFAULT_TOLERANCE_PERCENT: Record<ToleranceKey, string> = {
  volume: "0.5",
  area: "1",
  moment: "1",
  assembly_match: "10",
  practice_volume: "1",
};

export interface GradableState {
  skill_area_id: string;
  competition_module: string;
  title_en: string;
  title_ar: string;
  brief_en: string;
  brief_ar: string;
  attachments: CcAttachment[];
  expected_upload: string;
  max_points: string;
  grading_mode: string;
  grader_mode: string;
  density_kg_m3: string;
  material_name_en: string;
  material_name_ar: string;
  /** Percent strings per tolerance key ("" = grader default). */
  tolerances: Record<ToleranceKey, string>;
}

type GradableRow = Pick<
  CcTestTask,
  | "competition_module"
  | "title_en"
  | "title_ar"
  | "brief_en"
  | "brief_ar"
  | "attachments"
  | "expected_upload"
  | "max_points"
  | "grading_mode"
  | "grader_mode"
  | "density_kg_m3"
  | "material_name_en"
  | "material_name_ar"
  | "tolerances"
> & { skill_area_id: number | null };

function percentOf(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100 * 10000) / 10000) : "";
}

export function gradableFromRow(row: Partial<GradableRow> | null, defaults: Partial<GradableState> = {}): GradableState {
  const tol = (row?.tolerances && typeof row.tolerances === "object" && !Array.isArray(row.tolerances) ? row.tolerances : {}) as Record<string, unknown>;
  return {
    skill_area_id: row?.skill_area_id != null ? String(row.skill_area_id) : (defaults.skill_area_id ?? ""),
    competition_module: row?.competition_module ?? defaults.competition_module ?? "",
    title_en: row?.title_en ?? "",
    title_ar: row?.title_ar ?? "",
    brief_en: row?.brief_en ?? "",
    brief_ar: row?.brief_ar ?? "",
    attachments: Array.isArray(row?.attachments) ? (row!.attachments as unknown as CcAttachment[]) : [],
    expected_upload: row?.expected_upload ?? defaults.expected_upload ?? "step",
    max_points: row?.max_points != null ? String(Number(row.max_points)) : (defaults.max_points ?? ""),
    grading_mode: row?.grading_mode ?? defaults.grading_mode ?? "auto_step",
    grader_mode: row?.grader_mode ?? defaults.grader_mode ?? "",
    density_kg_m3: row?.density_kg_m3 != null ? String(Number(row.density_kg_m3)) : (defaults.density_kg_m3 ?? "7850"),
    material_name_en: row?.material_name_en ?? defaults.material_name_en ?? "",
    material_name_ar: row?.material_name_ar ?? defaults.material_name_ar ?? "",
    tolerances: Object.fromEntries(TOLERANCE_KEYS.map((k) => [k, percentOf(tol[k])])) as Record<ToleranceKey, string>,
  };
}

/** Form state -> the plain object the server action validates. */
export function gradablePayload(s: GradableState): Record<string, unknown> {
  const tolerances: Record<string, number | string> = {};
  for (const k of TOLERANCE_KEYS) {
    const v = s.tolerances[k].trim();
    if (!v) continue;
    const n = Number(v);
    tolerances[k] = Number.isFinite(n) ? Math.round((n / 100) * 1e8) / 1e8 : v;
  }
  return { ...s, tolerances };
}

export function GradableFields({
  value,
  onChange,
  skills,
  modules,
  attachmentsPrefix,
  skillOptional = false,
}: {
  value: GradableState;
  onChange: (next: GradableState) => void;
  skills: Pick<CcSkillArea, "id" | "name_en" | "name_ar">[];
  modules: Pick<CcCompetitionModule, "code" | "name_en" | "name_ar">[];
  /** Folder in cc-task-files for brief files; null = save first. */
  attachmentsPrefix: string | null;
  skillOptional?: boolean;
}) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const set = <K extends keyof GradableState>(k: K, v: GradableState[K]) => onChange({ ...value, [k]: v });
  const label = (en: string, ar: string) => (locale === "ar" ? ar || en : en || ar);
  const isAuto = value.grading_mode === "auto_step";

  return (
    <div className="flex flex-col gap-5">
      <BilingualField label={t("fields.title")} required maxLength={200} en={{ value: value.title_en, onChange: (v) => set("title_en", v) }} ar={{ value: value.title_ar, onChange: (v) => set("title_ar", v) }} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("fields.skill_area_id")} hint={t("task.skillHint")}>
          <select className={inputCls} value={value.skill_area_id} onChange={(e) => set("skill_area_id", e.target.value)}>
            {skillOptional || !value.skill_area_id ? <option value="">{tc("none")}</option> : null}
            {skills.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {`${s.id}. ${label(s.name_en, s.name_ar)}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.competition_module")} hint={t("task.moduleHint")}>
          <select className={inputCls} value={value.competition_module} onChange={(e) => set("competition_module", e.target.value)}>
            <option value="">{t("task.noModule")}</option>
            {modules.map((m) => (
              <option key={m.code} value={m.code}>
                {`${m.code} · ${label(m.name_en, m.name_ar)}`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <BilingualMarkdownEditor label={t("fields.brief")} hint={t("task.briefHint")} rows={8} en={{ value: value.brief_en, onChange: (v) => set("brief_en", v) }} ar={{ value: value.brief_ar, onChange: (v) => set("brief_ar", v) }} />

      <AttachmentsEditor value={value.attachments} onChange={(v) => set("attachments", v)} prefix={attachmentsPrefix} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("fields.expected_upload")}>
          <select className={inputCls} value={value.expected_upload} onChange={(e) => set("expected_upload", e.target.value)}>
            {CC_EXPECTED_UPLOADS.map((x) => (
              <option key={x} value={x}>
                {t(`uploads.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.max_points")} hint={t("task.pointsHint")}>
          <input className={inputCls} dir="ltr" inputMode="decimal" value={value.max_points} onChange={(e) => set("max_points", e.target.value)} />
        </Field>
        <Field label={t("fields.grading_mode")}>
          <select className={inputCls} value={value.grading_mode} onChange={(e) => set("grading_mode", e.target.value)}>
            {CC_GRADING_MODES.map((x) => (
              <option key={x} value={x}>
                {t(`gradingModes.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.grader_mode")} hint={t("task.graderModeHint")}>
          <select className={inputCls} value={value.grader_mode} onChange={(e) => set("grader_mode", e.target.value)} disabled={!isAuto}>
            <option value="">{t("task.graderDefault")}</option>
            {CC_GRADER_MODES.map((x) => (
              <option key={x} value={x}>
                {t(`graderModes.${x}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={t("fields.density_kg_m3")} hint={t("task.densityHint")}>
          <input className={inputCls} dir="ltr" inputMode="decimal" value={value.density_kg_m3} onChange={(e) => set("density_kg_m3", e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <BilingualField label={t("fields.material")} maxLength={120} en={{ value: value.material_name_en, onChange: (v) => set("material_name_en", v) }} ar={{ value: value.material_name_ar, onChange: (v) => set("material_name_ar", v) }} />
        </div>
      </div>

      {isAuto ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="flex items-center gap-1 text-sm font-semibold text-ink">
            {t("fields.tolerances")}
            <HelpTip label={t("task.tolerancesHelpLabel")}>{t("task.tolerancesHelp")}</HelpTip>
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {TOLERANCE_KEYS.map((k) => (
              <Field key={k} label={t(`tolerances.${k}`)}>
                <input
                  className={inputCls}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder={DEFAULT_TOLERANCE_PERCENT[k]}
                  value={value.tolerances[k]}
                  onChange={(e) => set("tolerances", { ...value.tolerances, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-mutedtext">{t("task.tolerancesHint")}</p>
        </fieldset>
      ) : null}
    </div>
  );
}

export { DEFAULT_TOLERANCE_PERCENT };
export type { GradableRow };
export const useGradableState = (row: Partial<GradableRow> | null, defaults?: Partial<GradableState>) => React.useState<GradableState>(() => gradableFromRow(row, defaults));
