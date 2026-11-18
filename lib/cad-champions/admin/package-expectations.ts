// Package expectations editor (Prompt 11, COMPETITION_ALIGNMENT section F).
// PURE: no I/O; tested in package-expectations.test.ts.
//
// cc_tests.package_expectations is read by the student validator
// (lib/cad-champions/upload/package-check.ts parseExpectations) and the
// grader queue. This file writes the long form it accepts:
//   { "required_folders": ["Parts and Assemblies", ...],
//     "tasks": { "<task_id>": { "files": ["Parts and Assemblies/Part_03.*"], "require_step": true } } }
// Patterns are "<Results folder>/<file name glob>" (* and ? only). The folder
// must be one of the eight Results folders (any case); it is written back in
// its canonical spelling so the trainer sees one form.

import { folderByName, parseExpectations, RESULTS_FOLDERS, type ResultsFolderKey } from "../upload/package-check";

export const MAX_PATTERNS_PER_TASK = 20;
export const MAX_PATTERN_LENGTH = 200;

export type PatternError = "empty" | "too_long" | "unsafe" | "no_folder" | "unknown_folder" | "no_name" | "bad_chars";

/** Checks one pattern. Returns null when it is fine. */
export function validatePattern(raw: string): PatternError | null {
  const p = (raw ?? "").trim();
  if (!p) return "empty";
  if (p.length > MAX_PATTERN_LENGTH) return "too_long";
  const s = p.replace(/\\/g, "/");
  if (s.startsWith("/") || /^[a-zA-Z]:/.test(s) || s.split("/").some((seg) => seg === ".." || seg === ".")) return "unsafe";
  if (/[\u0000-\u001f<>|"]/.test(s)) return "bad_chars";
  const slash = s.lastIndexOf("/");
  if (slash <= 0) return "no_folder";
  const folderPart = s.slice(0, slash);
  const name = s.slice(slash + 1);
  if (!name || name === "*" || name === "*.*") return "no_name";
  if (!/^[\p{L}\p{N} _.\-*?()[\]+&#,']+$/u.test(name)) return "bad_chars";
  const last = folderPart.split("/").pop() ?? "";
  if (!folderByName(last)) return "unknown_folder";
  return null;
}

/** Writes the folder of a valid pattern in its canonical spelling ("parts and assemblies/x" -> "Parts and Assemblies/x"). */
export function normalizePattern(raw: string): string {
  const s = raw.trim().replace(/\\/g, "/");
  const slash = s.lastIndexOf("/");
  if (slash <= 0) return s;
  const segs = s.slice(0, slash).split("/");
  const f = folderByName(segs[segs.length - 1] ?? "");
  if (f) segs[segs.length - 1] = f.name;
  return `${segs.join("/")}/${s.slice(slash + 1)}`;
}

/** One pattern per line; blank lines dropped. */
export function patternsFromText(text: string): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** A sensible first pattern for task number n (1-based): "Parts and Assemblies/Part_03.*". */
export function suggestPattern(taskNumber: number, expectedUpload: string): string {
  const nn = String(Math.max(1, Math.trunc(taskNumber))).padStart(2, "0");
  switch (expectedUpload) {
    case "pdf":
      return `PDF files/Drawing_${nn}.pdf`;
    case "image":
      return `Rendered Images/Render_${nn}.*`;
    case "video":
      return `Animations/Animation_${nn}.*`;
    default:
      return `Parts and Assemblies/Part_${nn}.*`;
  }
}

// ------------------------------------------------------------------ draft

export interface ExpectationsDraftTask {
  taskId: string;
  patterns: string[];
  requireStep: boolean;
}

export interface ExpectationsDraft {
  requiredFolders: ResultsFolderKey[];
  tasks: ExpectationsDraftTask[];
}

/** Editor state from the stored JSON: one entry per current task (in the given order). */
export function draftFromJson(json: unknown, taskIds: readonly string[]): ExpectationsDraft {
  const parsed = parseExpectations(json);
  const byTask = new Map(parsed.tasks.map((t) => [t.taskId, t]));
  return {
    requiredFolders: parsed.requiredFolders,
    tasks: taskIds.map((id) => {
      const t = byTask.get(id);
      return { taskId: id, patterns: t ? [...t.patterns] : [], requireStep: t ? t.requireStep : true };
    }),
  };
}

export interface ExpectationsIssue {
  taskId: string | null;
  pattern: string | null;
  error: PatternError | "too_many" | "unknown_task" | "duplicate";
}

export type BuildResult = { ok: true; json: Record<string, unknown> } | { ok: false; issues: ExpectationsIssue[] };

/**
 * Validates the draft and builds the long-form JSON. Tasks that are not in
 * `validTaskIds` are refused; tasks without patterns are left out.
 */
export function buildExpectationsJson(draft: ExpectationsDraft, validTaskIds: readonly string[]): BuildResult {
  const valid = new Set(validTaskIds);
  const issues: ExpectationsIssue[] = [];
  const keys = new Set<string>(RESULTS_FOLDERS.map((f) => f.key));
  const required = [...new Set((draft.requiredFolders ?? []).filter((k) => keys.has(k)))] as ResultsFolderKey[];

  const tasks: Record<string, { files: string[]; require_step: boolean }> = {};
  for (const t of draft.tasks ?? []) {
    if (!valid.has(t.taskId)) {
      issues.push({ taskId: t.taskId, pattern: null, error: "unknown_task" });
      continue;
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of t.patterns ?? []) {
      if (!raw || !raw.trim()) continue;
      const err = validatePattern(raw);
      if (err) {
        issues.push({ taskId: t.taskId, pattern: raw, error: err });
        continue;
      }
      const norm = normalizePattern(raw);
      const key = norm.toLowerCase();
      if (seen.has(key)) {
        issues.push({ taskId: t.taskId, pattern: raw, error: "duplicate" });
        continue;
      }
      seen.add(key);
      cleaned.push(norm);
    }
    if (cleaned.length > MAX_PATTERNS_PER_TASK) issues.push({ taskId: t.taskId, pattern: null, error: "too_many" });
    if (cleaned.length > 0) tasks[t.taskId] = { files: cleaned.slice(0, MAX_PATTERNS_PER_TASK), require_step: !!t.requireStep };
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    json: {
      required_folders: RESULTS_FOLDERS.filter((f) => required.includes(f.key)).map((f) => f.name),
      tasks,
    },
  };
}

/** Task ids that have at least one expected file in the stored JSON. */
export function tasksWithExpectations(json: unknown): Set<string> {
  return new Set(parseExpectations(json).tasks.map((t) => t.taskId));
}

/** Invalid stored patterns (for the publish check). */
export function invalidStoredPatterns(json: unknown): { taskId: string; pattern: string; error: PatternError }[] {
  const out: { taskId: string; pattern: string; error: PatternError }[] = [];
  for (const t of parseExpectations(json).tasks) {
    for (const p of t.patterns) {
      const e = validatePattern(p);
      if (e) out.push({ taskId: t.taskId, pattern: p, error: e });
    }
  }
  return out;
}
