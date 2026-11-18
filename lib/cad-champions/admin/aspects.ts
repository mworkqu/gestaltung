// Marking aspects in the admin test / exercise builder (Prompt 11,
// COMPETITION_ALIGNMENT section D). PURE: no I/O; tested in aspects.test.ts.
//
// - aspectSplit: measurement vs judgement points (and %) of a task or a whole
//   test; judgement above 20 % is flagged (EuroSkills used about 93 / 7).
// - validateAspect: cleans one aspect form before it is written.
// - standardAutoAspects: the four STEP checks (volume, area, inertia, solids)
//   as all-or-nothing measurement aspects that add up to the task's points.
// - planRubricAspectSync: the TypeScript twin of cc_sync_rubric_aspects()
//   (0082) for EXERCISES (the SQL function only reads cc_test_tasks).

import type { CcAspectMethod, CcAspectType, CcCompetitionModuleCode, CcSkillAreaId, Json } from "../db/types";
import { CC_ASPECT_METHODS, CC_ASPECT_TYPES, CC_COMPETITION_MODULE_CODES } from "../db/types";
import { aspectMethodFor, rubricCheckKey, type Rubric } from "../drawing/rubric";

export const JUDGEMENT_WARN_PERCENT = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ------------------------------------------------------------------ split

export interface SplitInput {
  type: string;
  max_points: number | string | null;
}

export interface AspectSplit {
  measurement: number;
  judgement: number;
  total: number;
  /** 0-100, one decimal. 0 when there are no points. */
  measurementPercent: number;
  judgementPercent: number;
  /** Judgement share above JUDGEMENT_WARN_PERCENT (a warning, never a block). */
  judgementTooHigh: boolean;
}

export function aspectSplit(aspects: readonly SplitInput[]): AspectSplit {
  let measurement = 0;
  let judgement = 0;
  for (const a of aspects) {
    const p = Math.max(0, num(a.max_points));
    if (a.type === "judgement") judgement += p;
    else measurement += p;
  }
  measurement = round2(measurement);
  judgement = round2(judgement);
  const total = round2(measurement + judgement);
  const judgementPercent = total > 0 ? round1((judgement / total) * 100) : 0;
  const measurementPercent = total > 0 ? round1(100 - judgementPercent) : 0;
  return {
    measurement,
    judgement,
    total,
    measurementPercent,
    judgementPercent,
    judgementTooHigh: total > 0 && (judgement / total) * 100 > JUDGEMENT_WARN_PERCENT,
  };
}

/** Sum of aspect points (2 decimals). */
export function sumAspectPoints(aspects: readonly Pick<SplitInput, "max_points">[]): number {
  return round2(aspects.reduce((s, a) => s + Math.max(0, num(a.max_points)), 0));
}

/** Aspect points add up to the task's max points (half a hundredth of slack). */
export function pointsMatch(aspects: readonly Pick<SplitInput, "max_points">[], maxPoints: number | string | null): boolean {
  return Math.abs(sumAspectPoints(aspects) - round2(num(maxPoints))) < 0.005;
}

// ------------------------------------------------------------------ check keys

/** STEP grader checks an auto_step aspect can map to (lib/cad-champions/grader/mapping.ts). */
export const AUTO_CHECK_KEYS = ["volume", "area", "inertia", "solids", "parts_count", "assembly_position"] as const;

/**
 * Valid check keys: the auto keys above, `part:<name>` (one part of an
 * assembly reference), `rubric:<id>` (drawing rubric item). Empty = none.
 */
export function isValidCheckKey(key: string): boolean {
  if ((AUTO_CHECK_KEYS as readonly string[]).includes(key)) return true;
  if (/^rubric:[a-z0-9_]{1,40}$/.test(key)) return true;
  if (/^part:[A-Za-z0-9 _.\-]{1,100}$/.test(key)) return true;
  return false;
}

// ------------------------------------------------------------------ validate

export interface AspectFields {
  description_en: string;
  description_ar: string;
  skill_area_id: CcSkillAreaId;
  competition_module: CcCompetitionModuleCode | null;
  type: CcAspectType;
  max_points: number;
  method: CcAspectMethod;
  partial_rule: Json | null;
  check_key: string | null;
  student_hint_en: string | null;
  student_hint_ar: string | null;
}

export type AspectFieldError =
  | "description_en"
  | "description_ar"
  | "skill_area"
  | "module"
  | "type"
  | "points"
  | "method"
  | "judgement_method"
  | "partial_rule"
  | "check_key"
  | "auto_check_key";

export type AspectValidation = { ok: true; value: AspectFields } | { ok: false; errors: AspectFieldError[] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Parses a partial_rule textarea: "" -> null (all-or-nothing); a JSON object -> it; else invalid. */
export function parsePartialRule(raw: unknown): { ok: true; value: Json | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw === "object") return Array.isArray(raw) ? { ok: false } : { ok: true, value: raw as Json };
  const s = String(raw).trim();
  if (s === "" || s === "null") return { ok: true, value: null };
  try {
    const v = JSON.parse(s) as unknown;
    if (v === null) return { ok: true, value: null };
    if (typeof v !== "object" || Array.isArray(v)) return { ok: false };
    return { ok: true, value: v as Json };
  } catch {
    return { ok: false };
  }
}

export function validateAspect(raw: Record<string, unknown>): AspectValidation {
  const errors: AspectFieldError[] = [];
  const description_en = text(raw.description_en, 600);
  const description_ar = text(raw.description_ar, 600);
  if (!description_en) errors.push("description_en");
  if (!description_ar) errors.push("description_ar");

  const skill = Math.trunc(num(raw.skill_area_id));
  if (!(skill >= 1 && skill <= 6)) errors.push("skill_area");

  const modRaw = text(raw.competition_module, 4);
  const competition_module = modRaw === "" ? null : ((CC_COMPETITION_MODULE_CODES as readonly string[]).includes(modRaw) ? (modRaw as CcCompetitionModuleCode) : undefined);
  if (competition_module === undefined) errors.push("module");

  const type = (CC_ASPECT_TYPES as readonly string[]).includes(String(raw.type)) ? (raw.type as CcAspectType) : null;
  if (!type) errors.push("type");

  const points = num(raw.max_points);
  if (!(points >= 0 && points <= 10000) || (typeof raw.max_points === "string" && raw.max_points.trim() === "")) errors.push("points");

  const method = (CC_ASPECT_METHODS as readonly string[]).includes(String(raw.method)) ? (raw.method as CcAspectMethod) : null;
  if (!method) errors.push("method");
  if (type === "judgement" && method && method !== "trainer") errors.push("judgement_method");

  const partial = parsePartialRule(raw.partial_rule);
  if (!partial.ok) errors.push("partial_rule");
  // Judgement aspects are scored 0-3; a partial rule means nothing there.
  const partial_rule = partial.ok && type !== "judgement" ? partial.value : null;

  const keyRaw = text(raw.check_key, 120);
  const check_key = keyRaw === "" ? null : keyRaw;
  if (check_key && !isValidCheckKey(check_key)) errors.push("check_key");
  if (method === "auto_step" && (!check_key || check_key.startsWith("rubric:"))) errors.push("auto_check_key");

  if (errors.length > 0 || !type || !method || competition_module === undefined) return { ok: false, errors };
  return {
    ok: true,
    value: {
      description_en,
      description_ar,
      skill_area_id: skill as CcSkillAreaId,
      competition_module,
      type,
      max_points: round2(points),
      method,
      partial_rule,
      check_key,
      student_hint_en: text(raw.student_hint_en, 1000) || null,
      student_hint_ar: text(raw.student_hint_ar, 1000) || null,
    },
  };
}

// ------------------------------------------------------------------ standard STEP aspects

/** Share of the points per STEP check (same weights as the grader's practice score). */
export const STANDARD_AUTO_WEIGHTS = [
  { key: "volume", weight: 0.4 },
  { key: "area", weight: 0.2 },
  { key: "inertia", weight: 0.3 },
  { key: "solids", weight: 0.1 },
] as const;

export type StandardAutoKey = (typeof STANDARD_AUTO_WEIGHTS)[number]["key"];

/** Default texts for the four STEP aspects (stored on the aspect rows; editable afterwards). */
export const STANDARD_AUTO_TEXTS: Record<StandardAutoKey, { en: string; ar: string; hint_en: string; hint_ar: string }> = {
  volume: {
    en: "Part volume matches the drawing",
    ar: "حجم القطعة يطابق الرسمة",
    hint_en: "Check every size against the drawing, including holes and pockets.",
    hint_ar: "راجع كل بُعد مع الرسمة، ومنها الثقوب والجيوب.",
  },
  area: {
    en: "Surface area matches the drawing",
    ar: "مساحة السطح تطابق الرسمة",
    hint_en: "Fillets, chamfers and small features change the surface area. Check them all.",
    hint_ar: "التدويرات والشطفات والملامح الصغيرة تغيّر مساحة السطح. راجعها كلها.",
  },
  inertia: {
    en: "Shape and mass distribution match (principal moments)",
    ar: "الشكل وتوزيع الكتلة متطابقان (عزوم القصور الرئيسية)",
    hint_en: "Features in the wrong place change how the mass is spread. Check positions, not only sizes.",
    hint_ar: "الملامح في غير مكانها تغيّر توزيع الكتلة. راجع المواضع وليس الأبعاد فقط.",
  },
  solids: {
    en: "The file holds the right number of valid solids",
    ar: "يحتوي الملف على العدد الصحيح من الأجسام السليمة",
    hint_en: "Export one closed solid per part, with no extra bodies or surfaces.",
    hint_ar: "صدّر جسمًا مغلقًا واحدًا لكل قطعة، دون أجسام أو أسطح زائدة.",
  },
};

/** Points per standard check, rounded to 2 decimals, the rest on the last one so they add up exactly. */
export function standardAutoPoints(maxPoints: number): { key: StandardAutoKey; points: number }[] {
  const total = round2(Math.max(0, num(maxPoints)));
  let used = 0;
  return STANDARD_AUTO_WEIGHTS.map((w, i) => {
    const points = i === STANDARD_AUTO_WEIGHTS.length - 1 ? round2(total - used) : round2(total * w.weight);
    used = round2(used + points);
    return { key: w.key, points };
  });
}

// ------------------------------------------------------------------ rubric sync (exercises)

export interface ExistingRubricAspect {
  id: string;
  check_key: string | null;
}

export interface RubricAspectRow {
  position: number;
  description_en: string;
  description_ar: string;
  skill_area_id: CcSkillAreaId;
  competition_module: CcCompetitionModuleCode | null;
  type: CcAspectType;
  max_points: number;
  method: CcAspectMethod;
  partial_rule: null;
  check_key: string;
  student_hint_en: string | null;
  student_hint_ar: string | null;
}

export interface RubricSyncPlan {
  updates: { id: string; row: RubricAspectRow }[];
  inserts: RubricAspectRow[];
  deleteIds: string[];
}

/**
 * Same rule as cc_sync_rubric_aspects(): one aspect per rubric item with
 * check_key "rubric:<id>"; existing rows are matched by check_key and updated
 * (ids kept); rubric aspects whose item is gone are deleted; other aspects
 * are never touched. Positions 1..n follow the rubric order.
 */
export function planRubricAspectSync(
  rubric: Rubric | null,
  existing: readonly ExistingRubricAspect[],
  ctx: { skill_area_id: CcSkillAreaId; competition_module: CcCompetitionModuleCode | null },
): RubricSyncPlan {
  const byKey = new Map(existing.filter((a) => a.check_key?.startsWith("rubric:")).map((a) => [a.check_key as string, a.id]));
  const keys = new Set<string>();
  const updates: RubricSyncPlan["updates"] = [];
  const inserts: RubricAspectRow[] = [];
  let pos = 0;
  for (const item of rubric?.items ?? []) {
    if (!/^[a-z0-9_]{1,40}$/.test(item.id)) continue;
    const key = rubricCheckKey(item.id);
    if (keys.has(key)) continue;
    keys.add(key);
    pos++;
    const type: CcAspectType = item.type === "judgement" ? "judgement" : "measurement";
    const row: RubricAspectRow = {
      position: pos,
      description_en: item.text_en || item.id,
      description_ar: item.text_ar || item.text_en || item.id,
      skill_area_id: ctx.skill_area_id,
      competition_module: ctx.competition_module,
      type,
      max_points: Math.max(0, num(item.points)),
      method: aspectMethodFor({ type, check_type: item.check_type }),
      partial_rule: null,
      check_key: key,
      student_hint_en: item.student_hint_en || null,
      student_hint_ar: item.student_hint_ar || null,
    };
    const id = byKey.get(key);
    if (id) updates.push({ id, row });
    else inserts.push(row);
  }
  const deleteIds = existing.filter((a) => a.check_key?.startsWith("rubric:") && !keys.has(a.check_key)).map((a) => a.id);
  return { updates, inserts, deleteIds };
}
