// View models for the test pages (pure, server + client safe). Turns the
// public task rows into the small, serialisable shapes the client components
// get (localised names, attachments, package patterns per task).

import type { Locale } from "@/i18n/routing";

import type { CcAttachment, CcCompetitionModuleCode, CcExpectedUpload, CcGradingMode, CcTestTaskPublic } from "../db/types";
import { parseExpectations } from "../upload/package-check";

export interface LabelMaps {
  skills: Map<number, { name_en: string; name_ar: string }>;
  modules: Map<string, { name_en: string; name_ar: string; hours?: number }>;
}

export interface TaskView {
  id: string;
  position: number;
  /** 1-based number shown as "Task n". */
  number: number;
  title: string;
  skillAreaId: number;
  skillName: string | null;
  moduleCode: CcCompetitionModuleCode | null;
  moduleName: string | null;
  points: number;
  expectedUpload: CcExpectedUpload;
  gradingMode: CcGradingMode;
  density: number | null;
  material: string | null;
  attachments: { path: string; label: string }[];
  /** module_package: expected file patterns for this task. */
  expectedFiles: string[];
}

function pick<T extends { name_en: string; name_ar: string }>(row: T | undefined, locale: Locale): string | null {
  if (!row) return null;
  return (locale === "ar" ? row.name_ar : row.name_en) || row.name_en || null;
}

function attachments(raw: unknown, locale: Locale): { path: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as CcAttachment[])
    .filter((a) => a && typeof a.path === "string" && a.path.length > 0)
    .map((a) => ({
      path: a.path,
      label: (locale === "ar" ? a.label_ar : a.label_en) || a.label_en || a.path.split("/").pop() || a.path,
    }));
}

export function toTaskViews(
  tasks: readonly CcTestTaskPublic[],
  labels: LabelMaps,
  locale: Locale,
  packageExpectations?: unknown
): TaskView[] {
  const expectations = parseExpectations(packageExpectations ?? {});
  return [...tasks]
    .sort((a, b) => a.position - b.position)
    .map((t, i) => ({
      id: t.id,
      position: t.position,
      number: i + 1,
      title: (locale === "ar" ? t.title_ar : t.title_en) || t.title_en,
      skillAreaId: Number(t.skill_area_id),
      skillName: pick(labels.skills.get(Number(t.skill_area_id)), locale),
      moduleCode: t.competition_module ?? null,
      moduleName: t.competition_module ? pick(labels.modules.get(t.competition_module), locale) : null,
      points: Number(t.max_points) || 0,
      expectedUpload: t.expected_upload,
      gradingMode: t.grading_mode,
      density: t.density_kg_m3 == null ? null : Number(t.density_kg_m3),
      material: (locale === "ar" ? t.material_name_ar : t.material_name_en) || t.material_name_en || null,
      attachments: attachments(t.attachments, locale),
      expectedFiles: expectations.tasks.find((x) => x.taskId === t.id)?.patterns ?? [],
    }));
}

/** The brief markdown of a task in the page locale (English as fallback). */
export function briefFor(t: Pick<CcTestTaskPublic, "brief_en" | "brief_ar">, locale: Locale): string {
  return ((locale === "ar" ? t.brief_ar : t.brief_en) || t.brief_en || "").trim();
}

/** Distinct material + density pairs, in task order. */
export function densitiesOf(tasks: readonly TaskView[]): { material: string; density: number }[] {
  const seen = new Set<string>();
  const out: { material: string; density: number }[] = [];
  for (const t of tasks) {
    if (t.density == null || !t.material) continue;
    const k = `${t.material}|${t.density}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ material: t.material, density: t.density });
  }
  return out;
}

/** The task (in an attempt's test) that belongs to M4 reverse engineering, if any. */
export function hasModule(tasks: readonly Pick<TaskView, "moduleCode">[], code: CcCompetitionModuleCode): boolean {
  return tasks.some((t) => t.moduleCode === code);
}
