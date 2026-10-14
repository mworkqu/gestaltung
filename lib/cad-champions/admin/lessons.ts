// Admin training content (Prompt 11, lessons / levels / modules) — PURE logic:
// validation of the module, level and lesson forms, video id format, the
// downloads list, per-track notes, unlock rules and up/down reordering.
// No React, no database: tested in lessons.test.ts.

import { CC_COMPETITION_MODULE_CODES, type CcCompetitionModuleCode, type CcSkillAreaId } from "../db/types";
import { GLOSSARY_IDS } from "../glossary";
import { SLOT_KEYS, type SlotKey } from "../training/video-pick";
import { parseStoredVideo } from "../videos/registry";

export type FieldErrors = Record<string, string>;
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
export const SKILL_AREA_IDS: readonly CcSkillAreaId[] = [1, 2, 3, 4, 5, 6];
export const TITLE_MAX = 200;
export const TEXT_MAX = 20000;
export const OBJECTIVES_MAX = 20;
export const DOWNLOADS_MAX = 20;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const BUNNY_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── small helpers ────────────────────────────────────────────────────────

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isSlug(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= SLUG_MAX && SLUG_RE.test(v);
}

/** "My new lesson!" -> "my-new-lesson". Latin letters and digits only. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Empty string -> null. */
export function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s ? s : null;
}

function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** One entry per line: trimmed, empty lines dropped, capped. */
export function parseLines(text: unknown, maxItems = OBJECTIVES_MAX, maxLen = 300): string[] {
  if (Array.isArray(text)) text = text.join("\n");
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((l) => l.slice(0, maxLen));
}

export function linesToText(lines: readonly string[] | null | undefined): string {
  return (lines ?? []).join("\n");
}

// ─── video ids ────────────────────────────────────────────────────────────

export type VideoIdCheck = { ok: true; value: string | null; provider: "youtube" | "bunny" | null } | { ok: false };

/**
 * Format check for a stored video id: empty (= no video), "youtube:<11 chars>"
 * or a Bunny Stream GUID. Normalises the prefix case and the GUID to lower case.
 */
export function validateVideoId(raw: unknown): VideoIdCheck {
  const v = str(raw);
  if (!v) return { ok: true, value: null, provider: null };
  if (v.toLowerCase().startsWith("youtube:")) {
    const id = v.slice(8).trim();
    return YOUTUBE_ID.test(id) ? { ok: true, value: `youtube:${id}`, provider: "youtube" } : { ok: false };
  }
  if (BUNNY_GUID.test(v)) return { ok: true, value: v.toLowerCase(), provider: "bunny" };
  return { ok: false };
}

/** What the player will make of a stored value (matches the video route). */
export function videoProviderOf(value: string | null | undefined): "youtube" | "bunny" | "none" {
  const p = parseStoredVideo(value).provider;
  return p === "placeholder" ? "none" : p;
}

export const VIDEO_TRACK_ORDER = ["inventor", "fusion", "solidworks", "neutral"] as const;

/** The eight slots in display order: inventor, fusion, solidworks, neutral x en, ar. */
export const VIDEO_SLOT_ORDER: readonly SlotKey[] = VIDEO_TRACK_ORDER.flatMap((t) => [`${t}_en`, `${t}_ar`] as SlotKey[]);

export function isAllSlots(): boolean {
  return VIDEO_SLOT_ORDER.length === SLOT_KEYS.length && VIDEO_SLOT_ORDER.every((s) => SLOT_KEYS.includes(s));
}

/** How many of the eight video slots hold a value. */
export function recordedVideos(l: object): number {
  let n = 0;
  for (const t of ["inventor", "fusion", "solidworks", "neutral"]) {
    for (const lang of ["en", "ar"]) {
      const v = (l as Record<string, unknown>)[`video_${t}_${lang}`];
      if (typeof v === "string" && v.trim()) n += 1;
    }
  }
  return n;
}

// ─── downloads ────────────────────────────────────────────────────────────

export interface LessonDownload {
  path: string;
  label_en: string;
  label_ar: string;
}

function safePath(p: string): boolean {
  if (!p || p.length > 512) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("//")) return false;
  return !p.split("/").some((s) => s === ".." || s === ".");
}

/** Reads the stored JSON list (skips malformed entries). */
export function parseDownloads(json: unknown): LessonDownload[] {
  if (!Array.isArray(json)) return [];
  const out: LessonDownload[] = [];
  for (const f of json) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const path = str(o.path);
    if (!safePath(path)) continue;
    out.push({ path, label_en: str(o.label_en), label_ar: str(o.label_ar) });
  }
  return out.slice(0, DOWNLOADS_MAX);
}

export function validateDownloads(input: unknown): Validated<LessonDownload[]> {
  if (input == null || input === "") return { ok: true, value: [] };
  if (!Array.isArray(input) || input.length > DOWNLOADS_MAX) return { ok: false, errors: { downloads: "invalid" } };
  const out: LessonDownload[] = [];
  for (const f of input) {
    if (!f || typeof f !== "object") return { ok: false, errors: { downloads: "invalid" } };
    const o = f as Record<string, unknown>;
    const path = str(o.path);
    const label_en = str(o.label_en);
    const label_ar = str(o.label_ar);
    if (!safePath(path) || label_en.length > 120 || label_ar.length > 120) return { ok: false, errors: { downloads: "invalid" } };
    out.push({ path, label_en, label_ar });
  }
  return { ok: true, value: out };
}

// ─── per-track notes ──────────────────────────────────────────────────────

export type TrackNoteMode = "none" | "inventor_only" | "equivalent";
export interface TrackNoteState {
  mode: TrackNoteMode;
  en: string;
  ar: string;
}
export const NOTE_TRACKS = ["fusion", "solidworks"] as const;
export type NoteTrack = (typeof NOTE_TRACKS)[number];
export type TrackNotesState = Record<NoteTrack, TrackNoteState>;

export function emptyTrackNotes(): TrackNotesState {
  return { fusion: { mode: "none", en: "", ar: "" }, solidworks: { mode: "none", en: "", ar: "" } };
}

/** cc_lessons.track_notes -> form state. Unknown shapes read as "none". */
export function parseTrackNotes(json: unknown): TrackNotesState {
  const out = emptyTrackNotes();
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  const o = json as Record<string, unknown>;
  for (const t of NOTE_TRACKS) {
    const v = o[t];
    if (v === "inventor_only") out[t] = { mode: "inventor_only", en: "", ar: "" };
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const e = v as Record<string, unknown>;
      out[t] = { mode: "equivalent", en: str(e.en), ar: str(e.ar) };
    }
  }
  return out;
}

/**
 * Form state -> the JSON stored in cc_lessons.track_notes. `existing` keeps
 * keys this form does not edit (e.g. "inventor"). "equivalent" needs both texts.
 */
export function buildTrackNotes(state: unknown, existing: unknown = {}): Validated<Record<string, unknown>> {
  const base: Record<string, unknown> = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const errors: FieldErrors = {};
  for (const t of NOTE_TRACKS) {
    delete base[t];
    const one = s[t] && typeof s[t] === "object" ? (s[t] as Record<string, unknown>) : {};
    const mode = str(one.mode) || "none";
    if (mode === "none") continue;
    if (mode === "inventor_only") {
      base[t] = "inventor_only";
      continue;
    }
    if (mode === "equivalent") {
      const en = str(one.en);
      const ar = str(one.ar);
      if (!en || !ar || en.length > 600 || ar.length > 600) errors[`track_${t}`] = "invalid";
      else base[t] = { en, ar };
      continue;
    }
    errors[`track_${t}`] = "invalid";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: base };
}

// ─── unlock rule ──────────────────────────────────────────────────────────

export type UnlockRuleState = { mode: "open" } | { mode: "previous_level_passed"; passMark: number } | { mode: "keep" };

export function parseUnlockRule(json: unknown): UnlockRuleState {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (o.type === "open") return { mode: "open" };
    if (o.type === "previous_level_passed") {
      const n = typeof o.pass_mark === "number" ? o.pass_mark : 80;
      return { mode: "previous_level_passed", passMark: Number.isFinite(n) ? n : 80 };
    }
  }
  return { mode: "keep" };
}

/** `keep` returns null: the caller leaves the stored rule untouched. */
export function buildUnlockRule(state: unknown): Validated<Record<string, unknown> | null> {
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const mode = str(s.mode);
  if (mode === "open") return { ok: true, value: { type: "open" } };
  if (mode === "previous_level_passed") {
    const n = typeof s.passMark === "number" ? s.passMark : Number(s.passMark);
    if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, errors: { unlock_rule: "invalid" } };
    return { ok: true, value: { type: "previous_level_passed", pass_mark: Math.round(n * 100) / 100 } };
  }
  if (mode === "keep") return { ok: true, value: null };
  return { ok: false, errors: { unlock_rule: "invalid" } };
}

// ─── module ───────────────────────────────────────────────────────────────

export interface ModuleInput {
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  why_it_matters_en: string | null;
  why_it_matters_ar: string | null;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  icon: string | null;
  sort: number;
  is_orientation: boolean;
  is_published: boolean;
}

function skillArea(v: unknown): { ok: true; value: CcSkillAreaId | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = intIn(v, 1, 6);
  return n === null ? { ok: false } : { ok: true, value: n as CcSkillAreaId };
}

function competitionModule(v: unknown): { ok: true; value: CcCompetitionModuleCode | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  return (CC_COMPETITION_MODULE_CODES as readonly unknown[]).includes(v) ? { ok: true, value: v as CcCompetitionModuleCode } : { ok: false };
}

function checkTitle(errors: FieldErrors, key: string, v: string) {
  if (!v || v.length > TITLE_MAX) errors[key] = "invalid";
}

function checkText(errors: FieldErrors, key: string, v: string | null, max = TEXT_MAX) {
  if (v && v.length > max) errors[key] = "invalid";
}

export function validateModuleInput(raw: Record<string, unknown>): Validated<ModuleInput> {
  const errors: FieldErrors = {};
  const title_en = str(raw.title_en);
  const title_ar = str(raw.title_ar);
  checkTitle(errors, "title_en", title_en);
  checkTitle(errors, "title_ar", title_ar);
  const description_en = strOrNull(raw.description_en);
  const description_ar = strOrNull(raw.description_ar);
  const why_en = strOrNull(raw.why_it_matters_en);
  const why_ar = strOrNull(raw.why_it_matters_ar);
  checkText(errors, "description_en", description_en, 2000);
  checkText(errors, "description_ar", description_ar, 2000);
  checkText(errors, "why_it_matters_en", why_en, 2000);
  checkText(errors, "why_it_matters_ar", why_ar, 2000);
  const sa = skillArea(raw.skill_area_id);
  if (!sa.ok) errors.skill_area_id = "invalid";
  const cm = competitionModule(raw.competition_module);
  if (!cm.ok) errors.competition_module = "invalid";
  const icon = strOrNull(raw.icon);
  if (icon && !/^[A-Za-z0-9_-]{1,40}$/.test(icon)) errors.icon = "invalid";
  const sort = intIn(raw.sort ?? 0, 0, 9999);
  if (sort === null) errors.sort = "invalid";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title_en,
      title_ar,
      description_en,
      description_ar,
      why_it_matters_en: why_en,
      why_it_matters_ar: why_ar,
      skill_area_id: sa.ok ? sa.value : null,
      competition_module: cm.ok ? cm.value : null,
      icon,
      sort: sort ?? 0,
      is_orientation: raw.is_orientation === true,
      is_published: raw.is_published === true,
    },
  };
}

// ─── level ────────────────────────────────────────────────────────────────

export interface LevelInput {
  title_en: string;
  title_ar: string;
  goal_en: string | null;
  goal_ar: string | null;
  level_number: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** null = leave the stored rule as it is. */
  unlock_rule: Record<string, unknown> | null;
  is_published: boolean;
}

export function validateLevelInput(raw: Record<string, unknown>): Validated<LevelInput> {
  const errors: FieldErrors = {};
  const title_en = str(raw.title_en);
  const title_ar = str(raw.title_ar);
  checkTitle(errors, "title_en", title_en);
  checkTitle(errors, "title_ar", title_ar);
  const goal_en = strOrNull(raw.goal_en);
  const goal_ar = strOrNull(raw.goal_ar);
  checkText(errors, "goal_en", goal_en, 1000);
  checkText(errors, "goal_ar", goal_ar, 1000);
  const n = intIn(raw.level_number, 0, 6);
  if (n === null) errors.level_number = "invalid";
  const rule = buildUnlockRule(raw.unlock_rule);
  if (!rule.ok) Object.assign(errors, rule.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title_en,
      title_ar,
      goal_en,
      goal_ar,
      level_number: n as LevelInput["level_number"],
      unlock_rule: rule.ok ? rule.value : null,
      is_published: raw.is_published === true,
    },
  };
}

// ─── lesson ───────────────────────────────────────────────────────────────

export type LessonVideoColumns = { [K in SlotKey as `video_${K}`]: string | null };

export interface LessonInput extends LessonVideoColumns {
  slug: string;
  sort: number;
  title_en: string;
  title_ar: string;
  objectives_en: string[];
  objectives_ar: string[];
  duration_minutes: number | null;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  notes_en: string | null;
  notes_ar: string | null;
  common_mistakes_en: string | null;
  common_mistakes_ar: string | null;
  downloads: LessonDownload[];
  glossary_terms: string[];
  /** Form state; merge with the stored JSON via buildTrackNotes on the server. */
  track_notes: unknown;
  is_free_preview: boolean;
  is_published: boolean;
}

/** Keeps only known glossary ids, in the order given, no duplicates. */
export function cleanGlossaryTerms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const known = new Set<string>(GLOSSARY_IDS);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && known.has(x) && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export function validateLessonInput(raw: Record<string, unknown>): Validated<LessonInput> {
  const errors: FieldErrors = {};
  const slug = str(raw.slug);
  if (!isSlug(slug)) errors.slug = "invalid";
  const title_en = str(raw.title_en);
  const title_ar = str(raw.title_ar);
  checkTitle(errors, "title_en", title_en);
  checkTitle(errors, "title_ar", title_ar);
  const sort = intIn(raw.sort ?? 0, 0, 9999);
  if (sort === null) errors.sort = "invalid";
  const duration = raw.duration_minutes === null || raw.duration_minutes === undefined || raw.duration_minutes === "" ? null : intIn(raw.duration_minutes, 1, 600);
  if (duration === null && raw.duration_minutes !== null && raw.duration_minutes !== undefined && raw.duration_minutes !== "") errors.duration_minutes = "invalid";
  const sa = skillArea(raw.skill_area_id);
  if (!sa.ok) errors.skill_area_id = "invalid";
  const cm = competitionModule(raw.competition_module);
  if (!cm.ok) errors.competition_module = "invalid";

  const notes_en = strOrNull(raw.notes_en);
  const notes_ar = strOrNull(raw.notes_ar);
  const mistakes_en = strOrNull(raw.common_mistakes_en);
  const mistakes_ar = strOrNull(raw.common_mistakes_ar);
  checkText(errors, "notes_en", notes_en);
  checkText(errors, "notes_ar", notes_ar);
  checkText(errors, "common_mistakes_en", mistakes_en);
  checkText(errors, "common_mistakes_ar", mistakes_ar);

  const videos: Partial<Record<`video_${SlotKey}`, string | null>> = {};
  for (const slot of SLOT_KEYS) {
    const key = `video_${slot}` as const;
    const check = validateVideoId(raw[key]);
    if (!check.ok) errors[key] = "invalid";
    else videos[key] = check.value;
  }

  const downloads = validateDownloads(raw.downloads);
  if (!downloads.ok) Object.assign(errors, downloads.errors);

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      sort: sort ?? 0,
      title_en,
      title_ar,
      objectives_en: parseLines(raw.objectives_en),
      objectives_ar: parseLines(raw.objectives_ar),
      duration_minutes: duration,
      skill_area_id: sa.ok ? sa.value : null,
      competition_module: cm.ok ? cm.value : null,
      notes_en,
      notes_ar,
      common_mistakes_en: mistakes_en,
      common_mistakes_ar: mistakes_ar,
      downloads: downloads.ok ? downloads.value : [],
      glossary_terms: cleanGlossaryTerms(raw.glossary_terms),
      track_notes: raw.track_notes ?? {},
      is_free_preview: raw.is_free_preview === true,
      is_published: raw.is_published === true,
      ...(videos as LessonVideoColumns),
    },
  };
}

// ─── reordering ───────────────────────────────────────────────────────────

export interface SortItem {
  id: string;
  sort: number;
}

/**
 * Moves `id` one place up or down inside a list ordered by (sort, current
 * order). Returns ONLY the rows whose sort value changes, using steps of 10
 * from 10 so equal or gappy sort values heal themselves. Empty array = no move
 * (unknown id or already at the edge).
 */
export function computeReorder(items: readonly SortItem[], id: string, direction: "up" | "down"): SortItem[] {
  const ordered = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.sort - b.sort || a.i - b.i);
  const at = ordered.findIndex((x) => x.id === id);
  if (at < 0) return [];
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= ordered.length) return [];
  [ordered[at], ordered[to]] = [ordered[to], ordered[at]];
  const changed: SortItem[] = [];
  ordered.forEach((x, idx) => {
    const sort = (idx + 1) * 10;
    if (x.sort !== sort) changed.push({ id: x.id, sort });
  });
  return changed;
}

/** Next free sort for a new item: last sort + 10 (10 for an empty list). */
export function nextSort(sorts: readonly number[]): number {
  return sorts.length ? Math.max(...sorts) + 10 : 10;
}

/** The audit action for a publish / free-preview change, or null when nothing changed. */
export function publishAuditAction(entity: "lesson" | "level" | "module" | "help", before: boolean, after: boolean): string | null {
  if (before === after) return null;
  return `${entity}.${after ? "publish" : "unpublish"}`;
}

export function freePreviewAuditAction(before: boolean, after: boolean): string | null {
  if (before === after) return null;
  return after ? "lesson.free_preview_on" : "lesson.free_preview_off";
}
