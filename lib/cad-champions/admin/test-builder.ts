// Test and exercise builder input rules (Prompt 11 Step B). PURE: no I/O;
// tested in test-builder.test.ts. Server actions call these before writing;
// the forms show the returned field codes next to the fields.

import type { CcAttachment, CcCompetitionModuleCode, CcExpectedUpload, CcGraderMode, CcGradingMode, CcSkillAreaId, CcTestType, CcUploadMode, Json } from "../db/types";
import { CC_COMPETITION_MODULE_CODES, CC_EXPECTED_UPLOADS, CC_GRADER_MODES, CC_GRADING_MODES, CC_TEST_TYPES, CC_UPLOAD_MODES } from "../db/types";

export const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
/** "new" is taken by the /admin/tests/new and /admin/exercises/new routes. */
export const isValidSlug = (v: unknown): v is string => typeof v === "string" && SLUG_RE.test(v) && v !== "new";

/** "Mock M1: Parts" -> "mock-m1-parts" (Latin letters and digits only; may be empty for Arabic-only titles). */
export function slugify(title: string): string {
  return (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optText = (v: unknown, max: number): string | null => text(v, max) || null;

/** Whole number in [min, max]; "" -> fallback; anything else -> NaN. */
function int(v: unknown, min: number, max: number, fallback: number | null): number | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return Number.NaN;
  return n;
}

function decimal(v: unknown, min: number, max: number, fallback: number | null): number | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < min || n > max) return Number.NaN;
  return Math.round(n * 1000) / 1000;
}

const bad = (n: number | null) => n != null && Number.isNaN(n);

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return (list as readonly string[]).includes(String(v)) ? (v as T) : null;
}

function moduleOrNull(v: unknown): CcCompetitionModuleCode | null | undefined {
  const s = text(v, 4);
  if (!s) return null;
  return oneOf(CC_COMPETITION_MODULE_CODES, s) ?? undefined;
}

function skillArea(v: unknown): CcSkillAreaId | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? (n as CcSkillAreaId) : null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ------------------------------------------------------------------ tests

export interface TestCreateFields {
  slug: string;
  title_en: string;
  title_ar: string;
  type: CcTestType;
}

export function parseTestCreate(raw: Record<string, unknown>): Parsed<TestCreateFields> {
  const errors: string[] = [];
  const slug = text(raw.slug, 80).toLowerCase();
  const title_en = text(raw.title_en, 200);
  const title_ar = text(raw.title_ar, 200);
  const type = oneOf(CC_TEST_TYPES, raw.type);
  if (!isValidSlug(slug)) errors.push("slug");
  if (!title_en) errors.push("title_en");
  if (!title_ar) errors.push("title_ar");
  if (!type) errors.push("type");
  return errors.length ? { ok: false, errors } : { ok: true, value: { slug, title_en, title_ar, type: type! } };
}

export interface TestSettingsFields {
  title_en: string;
  title_ar: string;
  type: CcTestType;
  time_limit_minutes: number | null;
  grace_seconds: number;
  retake_cooldown_days: number;
  intro_en: string | null;
  intro_ar: string | null;
  rules_en: string | null;
  rules_ar: string | null;
  admin_only: boolean;
  upload_mode: CcUploadMode;
}

export function parseTestSettings(raw: Record<string, unknown>): Parsed<TestSettingsFields> {
  const errors: string[] = [];
  const title_en = text(raw.title_en, 200);
  const title_ar = text(raw.title_ar, 200);
  const type = oneOf(CC_TEST_TYPES, raw.type);
  const time = int(raw.time_limit_minutes, 1, 1440, null);
  const grace = int(raw.grace_seconds, 0, 3600, 60);
  const cooldown = int(raw.retake_cooldown_days, 0, 365, 0);
  const upload_mode = oneOf(CC_UPLOAD_MODES, raw.upload_mode);
  if (!title_en) errors.push("title_en");
  if (!title_ar) errors.push("title_ar");
  if (!type) errors.push("type");
  if (bad(time)) errors.push("time_limit_minutes");
  if (bad(grace)) errors.push("grace_seconds");
  if (bad(cooldown)) errors.push("retake_cooldown_days");
  if (!upload_mode) errors.push("upload_mode");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title_en,
      title_ar,
      type: type!,
      time_limit_minutes: time,
      grace_seconds: grace ?? 60,
      retake_cooldown_days: cooldown ?? 0,
      intro_en: optText(raw.intro_en, 20000),
      intro_ar: optText(raw.intro_ar, 20000),
      rules_en: optText(raw.rules_en, 20000),
      rules_ar: optText(raw.rules_ar, 20000),
      admin_only: raw.admin_only === true || raw.admin_only === "on" || raw.admin_only === "true",
      upload_mode: upload_mode!,
    },
  };
}

// ------------------------------------------------------------------ tolerances

export const TOLERANCE_KEYS = ["volume", "area", "moment", "assembly_match", "practice_volume"] as const;
export type ToleranceKey = (typeof TOLERANCE_KEYS)[number];

/**
 * cc_test_tasks.tolerances: relative tolerances the grader accepts
 * (each > 0 and <= 0.5, e.g. 0.005 = 0.5 %). "" / {} -> null (grader defaults).
 */
export function parseTolerances(raw: unknown): { ok: true; value: Record<string, number> | null } | { ok: false } {
  let obj: unknown = raw;
  if (raw == null) return { ok: true, value: null };
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "null") return { ok: true, value: null };
    try {
      obj = JSON.parse(s);
    } catch {
      return { ok: false };
    }
  }
  if (obj == null) return { ok: true, value: null };
  if (typeof obj !== "object" || Array.isArray(obj)) return { ok: false };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!(TOLERANCE_KEYS as readonly string[]).includes(k)) return { ok: false };
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 0.5) return { ok: false };
    out[k] = n;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

// ------------------------------------------------------------------ attachments

export const ATTACHMENT_KINDS = ["drawing", "image", "model", "file"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Cleans cc_test_tasks.attachments (CcAttachment[]); invalid rows are dropped. Max 20. */
export function normalizeAttachments(raw: unknown): CcAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: CcAttachment[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const path = text(r.path, 500);
    if (!path || path.startsWith("/") || path.split("/").some((s) => s === ".." || s === "") || seen.has(path)) continue;
    seen.add(path);
    const kind = oneOf(ATTACHMENT_KINDS, r.kind) ?? "file";
    out.push({ path, label_en: text(r.label_en, 200) || undefined, label_ar: text(r.label_ar, 200) || undefined, kind });
    if (out.length >= 20) break;
  }
  return out.map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as unknown as CcAttachment);
}

/** Attachment kind from the uploaded file name. */
export function attachmentKindFor(fileName: string): AttachmentKind {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "drawing";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) return "image";
  if (["step", "stp"].includes(ext)) return "model";
  return "file";
}

// ------------------------------------------------------------------ tasks

export interface GradableFields {
  skill_area_id: CcSkillAreaId;
  competition_module: CcCompetitionModuleCode | null;
  title_en: string;
  title_ar: string;
  brief_en: string | null;
  brief_ar: string | null;
  attachments: CcAttachment[];
  expected_upload: CcExpectedUpload;
  max_points: number;
  grading_mode: CcGradingMode;
  grader_mode: CcGraderMode | null;
  density_kg_m3: number | null;
  material_name_en: string | null;
  material_name_ar: string | null;
  tolerances: Json | null;
}

function parseGradable(raw: Record<string, unknown>, errors: string[], skillRequired: boolean, defaultGrader: CcGraderMode): Omit<GradableFields, "skill_area_id"> & { skill_area_id: CcSkillAreaId | null } {
  const skill = skillArea(raw.skill_area_id);
  if (!skill && (skillRequired || text(raw.skill_area_id, 2) !== "")) errors.push("skill_area_id");
  const mod = moduleOrNull(raw.competition_module);
  if (mod === undefined) errors.push("competition_module");
  const title_en = text(raw.title_en, 200);
  const title_ar = text(raw.title_ar, 200);
  if (!title_en) errors.push("title_en");
  if (!title_ar) errors.push("title_ar");
  const expected = oneOf(CC_EXPECTED_UPLOADS, raw.expected_upload);
  if (!expected) errors.push("expected_upload");
  const points = decimal(raw.max_points, 0, 10000, null);
  if (points == null || bad(points)) errors.push("max_points");
  const grading = oneOf(CC_GRADING_MODES, raw.grading_mode);
  if (!grading) errors.push("grading_mode");
  const graderRaw = text(raw.grader_mode, 20);
  const grader = graderRaw ? oneOf(CC_GRADER_MODES, graderRaw) : null;
  if (graderRaw && !grader) errors.push("grader_mode");
  const density = decimal(raw.density_kg_m3, 1, 30000, null);
  if (bad(density)) errors.push("density_kg_m3");
  const tol = parseTolerances(raw.tolerances);
  if (!tol.ok) errors.push("tolerances");
  return {
    skill_area_id: skill,
    competition_module: mod ?? null,
    title_en,
    title_ar,
    brief_en: optText(raw.brief_en, 20000),
    brief_ar: optText(raw.brief_ar, 20000),
    attachments: normalizeAttachments(raw.attachments),
    expected_upload: (expected ?? "step") as CcExpectedUpload,
    max_points: points != null && !bad(points) ? Math.round(points * 100) / 100 : 0,
    grading_mode: (grading ?? "auto_step") as CcGradingMode,
    grader_mode: grading === "auto_step" ? grader ?? defaultGrader : grader,
    density_kg_m3: density != null && !bad(density) ? density : null,
    material_name_en: optText(raw.material_name_en, 120),
    material_name_ar: optText(raw.material_name_ar, 120),
    tolerances: tol.ok ? (tol.value as Json | null) : null,
  };
}

export type TaskFields = GradableFields;

export function parseTaskInput(raw: Record<string, unknown>): Parsed<TaskFields> {
  const errors: string[] = [];
  const v = parseGradable(raw, errors, true, "part");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...v, skill_area_id: v.skill_area_id! } };
}

// ------------------------------------------------------------------ exercises

export interface ExerciseFields extends Omit<GradableFields, "skill_area_id"> {
  level_id: string;
  slug: string;
  sort: number;
  skill_area_id: CcSkillAreaId | null;
  pass_mark: number;
  estimated_minutes: number | null;
  hints_en: string[];
  hints_ar: string[];
  solution_video_id: string | null;
  is_free_sample: boolean;
}

/** Text area -> list: one item per line, blanks dropped, max `max` items of 500 chars. */
export function linesToList(raw: unknown, max = 10): string[] {
  const src = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\r?\n/) : [];
  return src
    .map((s) => s.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, max);
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function parseExerciseInput(raw: Record<string, unknown>): Parsed<ExerciseFields> {
  const errors: string[] = [];
  const v = parseGradable(raw, errors, false, "practice");
  const level_id = text(raw.level_id, 60);
  if (!isUuid(level_id)) errors.push("level_id");
  const slug = text(raw.slug, 80).toLowerCase();
  if (!isValidSlug(slug)) errors.push("slug");
  const sort = int(raw.sort, -100000, 100000, 0);
  if (bad(sort)) errors.push("sort");
  const pass = decimal(raw.pass_mark, 0, 100, 80);
  if (bad(pass)) errors.push("pass_mark");
  const minutes = int(raw.estimated_minutes, 1, 1440, null);
  if (bad(minutes)) errors.push("estimated_minutes");
  const video = text(raw.solution_video_id, 100);
  if (video && !VIDEO_ID_RE.test(video)) errors.push("solution_video_id");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...v,
      level_id,
      slug,
      sort: sort ?? 0,
      pass_mark: pass ?? 80,
      estimated_minutes: minutes,
      hints_en: linesToList(raw.hints_en),
      hints_ar: linesToList(raw.hints_ar),
      solution_video_id: video || null,
      is_free_sample: raw.is_free_sample === true || raw.is_free_sample === "on" || raw.is_free_sample === "true",
    },
  };
}

// ------------------------------------------------------------------ ordering

/** Moves `id` one step up or down; returns the same order when it cannot move. */
export function moveInList(ids: readonly string[], id: string, dir: "up" | "down"): string[] {
  const out = [...ids];
  const i = out.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 1-based positions for an ordered id list; only rows whose position changes. */
export function positionUpdates(ordered: readonly string[], current: ReadonlyMap<string, number>): { id: string; position: number }[] {
  return ordered.map((id, i) => ({ id, position: i + 1 })).filter((u) => current.get(u.id) !== u.position);
}

/** Next position after the existing ones (1 when empty). */
export function nextPosition(rows: readonly { position: number | null }[]): number {
  return rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0) + 1;
}

// ------------------------------------------------------------------ reference data

export interface ReferencePartView {
  name: string;
  volume_mm3: number | null;
  area_mm2: number | null;
  mass_kg: number | null;
}

export interface ReferenceView {
  volume_mm3: number | null;
  area_mm2: number | null;
  mass_kg: number | null;
  density_kg_m3: number | null;
  solids: number | null;
  principal_moments_mm5: number[];
  parts: ReferencePartView[];
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The numbers an admin needs to see from a reference_data object. */
export function referenceView(ref: unknown): ReferenceView | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const r = ref as Record<string, unknown>;
  const parts = Array.isArray(r.parts) ? r.parts : [];
  return {
    volume_mm3: n(r.volume_mm3),
    area_mm2: n(r.area_mm2),
    mass_kg: n(r.mass_kg),
    density_kg_m3: n(r.density_kg_m3),
    solids: n(r.solids),
    principal_moments_mm5: Array.isArray(r.principal_moments_mm5) ? r.principal_moments_mm5.map((x) => (typeof x === "number" ? x : NaN)).filter(Number.isFinite) : [],
    parts: parts
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p, i) => ({ name: typeof p.name === "string" && p.name ? p.name : `part_${i + 1}`, volume_mm3: n(p.volume_mm3), area_mm2: n(p.area_mm2), mass_kg: n(p.mass_kg) })),
  };
}

const PART_NAME_RE = /^[A-Za-z0-9 _.\-]{1,100}$/;

export function isValidPartName(name: string): boolean {
  return PART_NAME_RE.test(name.trim());
}

/**
 * Renames reference_data.parts[i].name (assemblies). Names must be unique and
 * match [A-Za-z0-9 _.-]{1,100} (they become `part:<name>` check keys);
 * blank -> keep the current name. Returns null when a name is invalid or repeated.
 */
export function renameReferenceParts(ref: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const r = { ...(ref as Record<string, unknown>) };
  const parts = Array.isArray(r.parts) ? (r.parts as unknown[]) : [];
  const seen = new Set<string>();
  const next = parts.map((p, i) => {
    const obj = p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {};
    const wanted = (names[i] ?? "").trim();
    const name = wanted || (typeof obj.name === "string" && obj.name ? obj.name : `part_${i + 1}`);
    obj.name = name;
    return obj;
  });
  for (const p of next) {
    const name = String(p.name);
    if (!isValidPartName(name) || seen.has(name.toLowerCase())) return null;
    seen.add(name.toLowerCase());
  }
  r.parts = next;
  return r;
}

// ------------------------------------------------------------------ storage paths

export type TargetKind = "task" | "exercise";

/** Brief PDFs / images (bucket cc-task-files, readable by every signed-in user). */
export function briefFilesPrefix(kind: TargetKind, id: string): string {
  return `${kind === "task" ? "tasks" : "exercises"}/${id}/`;
}

/** Answer STEP files (bucket cc-answer-files, staff only). */
export function answerFilesPrefix(kind: TargetKind, id: string): string {
  return `answers/${kind}/${id}/`;
}

/** "Grade a sample" uploads (bucket cc-answer-files, removed after grading). */
export function sampleFilesPrefix(kind: TargetKind, id: string): string {
  return `samples/${kind}/${id}/`;
}
