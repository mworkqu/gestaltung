// Module package check (COMPETITION_ALIGNMENT §F). Pure: no I/O. Tested in
// package-check.test.ts.
//
// A module_package test takes ONE ZIP of the competition Results folder:
//   <CODE>/DAY 01/Results/{2D Drawings, 3D Scannings, Animations, Parts and Assemblies,
//                          PDF files, Rendered Images, Reports, STL files}
//   <CODE>/DAY 01/Workspace/   (not collected)
// After upload the server lists the ZIP's central directory (zip-manifest.ts)
// and this file compares it with cc_tests.package_expectations:
//   - zip-slip safety (no "..", no absolute paths, no drive letters)
//   - limits: 500 entries, 2 GB uncompressed
//   - required folders present (case-insensitive)
//   - file types allowed per folder
//   - per task: expected files by name pattern, e.g. "Parts and Assemblies/Part_03.*",
//     with a warning when only native CAD files are found (no STEP to auto-check)
// The result (PackageManifest) is stored in cc_submissions.package_manifest.

export const PACKAGE_MAX_BYTES = 300 * 1024 * 1024;
export const PACKAGE_MAX_ENTRIES = 500;
export const PACKAGE_MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024;
export const TEMPLATE_ZIP_NAME = "CAD-Champions-Results-Template.zip";

export const STEP_EXTENSIONS = [".step", ".stp"] as const;

export const RESULTS_FOLDERS = [
  { key: "2d_drawings", name: "2D Drawings", ext: [".idw", ".dwg", ".f3d", ".f2d"] },
  { key: "3d_scannings", name: "3D Scannings", ext: [".stl", ".obj", ".ply"] },
  { key: "animations", name: "Animations", ext: [".avi", ".mp4", ".wmv"] },
  { key: "parts_and_assemblies", name: "Parts and Assemblies", ext: [".step", ".stp", ".ipt", ".iam", ".ipn", ".f3d", ".f3z"] },
  { key: "pdf_files", name: "PDF files", ext: [".pdf"] },
  { key: "rendered_images", name: "Rendered Images", ext: [".png", ".jpg", ".jpeg", ".bmp"] },
  { key: "reports", name: "Reports", ext: [".pdf", ".docx", ".xlsx"] },
  { key: "stl_files", name: "STL files", ext: [".stl"] },
] as const;

export type ResultsFolderKey = (typeof RESULTS_FOLDERS)[number]["key"];

const FOLDER_BY_NAME = new Map<string, (typeof RESULTS_FOLDERS)[number]>(
  RESULTS_FOLDERS.map((f) => [f.name.toLowerCase(), f])
);

/** The empty folder layout of the template ZIP (directory entries end in "/"). */
export function templateEntries(code = "CODE", day = "DAY 01"): string[] {
  return [
    `${code}/`,
    `${code}/${day}/`,
    `${code}/${day}/Results/`,
    ...RESULTS_FOLDERS.map((f) => `${code}/${day}/Results/${f.name}/`),
    `${code}/${day}/Workspace/`,
  ];
}

export function folderByName(name: string): (typeof RESULTS_FOLDERS)[number] | null {
  return FOLDER_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

export function folderName(key: string): string {
  return RESULTS_FOLDERS.find((f) => f.key === key)?.name ?? key;
}

/** Lower-case extension with the dot, or "". */
export function extOf(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot).toLowerCase() : "";
}

// ------------------------------------------------------------ zip-slip

export type SafePath = { ok: true; path: string; segments: string[] } | { ok: false };

/**
 * Normalises a ZIP entry name and refuses anything that could escape the
 * extraction folder: "..", absolute paths, drive letters, NUL / control
 * characters. Backslashes count as separators.
 */
export function normalizeEntryPath(raw: string): SafePath {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return { ok: false };
  if (/[\u0000-\u001f]/.test(raw)) return { ok: false };
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return { ok: false };
  const segments: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return { ok: false };
    segments.push(seg);
  }
  if (segments.length === 0) return { ok: false };
  return { ok: true, path: segments.join("/"), segments };
}

/** OS junk that is ignored entirely. */
export function isJunkEntry(segments: string[]): boolean {
  const base = segments[segments.length - 1]?.toLowerCase() ?? "";
  return segments.some((s) => s === "__MACOSX") || base === ".ds_store" || base === "thumbs.db" || base === "desktop.ini";
}

// ------------------------------------------------------------ expectations

export interface TaskExpectation {
  taskId: string;
  patterns: string[];
  /** A STEP file is required among the matches of patterns in "Parts and Assemblies". */
  requireStep: boolean;
}

export interface PackageExpectations {
  requiredFolders: ResultsFolderKey[];
  tasks: TaskExpectation[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 20) : [];
}

function patternFolder(pattern: string): string | null {
  const slash = pattern.replace(/\\/g, "/").lastIndexOf("/");
  return slash > 0 ? pattern.slice(0, slash) : null;
}

/**
 * Reads cc_tests.package_expectations. Accepted shapes:
 *   { "required_folders": ["Parts and Assemblies", ...], "tasks": { "<task_id>": { "files": ["Parts and Assemblies/Part_03.*"], "require_step": true } } }
 *   { "<task_id>": ["Parts and Assemblies/Part_03.*"] }            (short form, 0077 comment)
 * Unknown folders are dropped. Default required folders: all eight.
 */
export function parseExpectations(json: unknown): PackageExpectations {
  const all = RESULTS_FOLDERS.map((f) => f.key);
  if (!json || typeof json !== "object" || Array.isArray(json)) return { requiredFolders: all, tasks: [] };
  const obj = json as Record<string, unknown>;

  let requiredFolders: ResultsFolderKey[] = all;
  if (Array.isArray(obj.required_folders)) {
    requiredFolders = strings(obj.required_folders)
      .map((n) => folderByName(n)?.key)
      .filter((k): k is ResultsFolderKey => !!k);
  }

  const taskSource: Record<string, unknown> =
    obj.tasks && typeof obj.tasks === "object" && !Array.isArray(obj.tasks)
      ? (obj.tasks as Record<string, unknown>)
      : Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "required_folders" && k !== "tasks"));

  const tasks: TaskExpectation[] = [];
  for (const [taskId, v] of Object.entries(taskSource)) {
    const spec = Array.isArray(v) ? { files: v } : v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    if (!spec) continue;
    const patterns = strings(spec.files);
    if (patterns.length === 0) continue;
    const pointsAtParts = patterns.some((p) => folderByName(patternFolder(p) ?? "")?.key === "parts_and_assemblies");
    const requireStep = typeof spec.require_step === "boolean" ? spec.require_step : pointsAtParts;
    tasks.push({ taskId, patterns, requireStep });
  }
  return { requiredFolders, tasks };
}

// ------------------------------------------------------------ patterns

interface CompiledPattern {
  pattern: string;
  folder: ResultsFolderKey | null;
  /** Folder named in the pattern but not one of the eight. */
  unknownFolder: boolean;
  name: RegExp;
  label: string;
}

function globToRegExp(glob: string): RegExp {
  const src = glob
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${src}$`, "i");
}

/** Display label for a pattern: "Parts and Assemblies/Part_03.*" -> "Part_03". */
export function patternLabel(pattern: string): string {
  const base = pattern.replace(/\\/g, "/").split("/").pop() ?? pattern;
  const stem = base.replace(/\.\*$/, "");
  return stem && !/^\*/.test(stem) ? stem : pattern;
}

function compile(pattern: string): CompiledPattern {
  const folderPart = patternFolder(pattern);
  const base = pattern.replace(/\\/g, "/").split("/").pop() ?? pattern;
  const folder = folderPart ? (folderByName(folderPart.split("/").pop() ?? folderPart)?.key ?? null) : null;
  return { pattern, folder, unknownFolder: !!folderPart && !folder, name: globToRegExp(base), label: patternLabel(pattern) };
}

// ------------------------------------------------------------ check

export interface ZipEntryInfo {
  name: string;
  uncompressedSize: number;
  compressedSize: number;
  isDirectory: boolean;
}

export type PackageError = "unsafe_path" | "too_many_files" | "too_large" | "empty" | "unreadable" | "not_zip";

/** A manifest for a ZIP that could not be listed at all. */
export function failedManifest(error: PackageError, expectations: PackageExpectations, entryCount = 0, now: Date = new Date()): PackageManifest {
  const required = new Set(expectations.requiredFolders);
  return {
    version: 1,
    ok: false,
    errors: [error],
    entryCount,
    fileCount: 0,
    totalUncompressed: 0,
    root: null,
    folders: RESULTS_FOLDERS.map((f) => ({ key: f.key, name: f.name, present: false, required: required.has(f.key), fileCount: 0 })),
    tasks: expectations.tasks.map((t) => ({
      taskId: t.taskId,
      items: t.patterns.map((pattern) => ({ pattern, label: patternLabel(pattern), status: "missing" as const, files: [] })),
    })),
    warnings: [],
    unmatched: [],
    unsafe: [],
    checkedAt: now.toISOString(),
  };
}

export type PackageWarning =
  | { code: "missing_folder"; folder: string }
  | { code: "wrong_type"; folder: string; file: string; ext: string }
  | { code: "no_step"; taskId: string; label: string; exts: string[] }
  | { code: "missing_file"; taskId: string; label: string }
  | { code: "outside_results"; file: string };

export type ExpectedItemStatus = "found" | "native_only" | "missing";

export interface PackageManifest {
  version: 1;
  ok: boolean;
  errors: PackageError[];
  entryCount: number;
  fileCount: number;
  totalUncompressed: number;
  /** Path before "Results", e.g. "A01/DAY 01" (null when the ZIP has no Results folder). */
  root: string | null;
  folders: { key: ResultsFolderKey; name: string; present: boolean; required: boolean; fileCount: number }[];
  tasks: { taskId: string; items: { pattern: string; label: string; status: ExpectedItemStatus; files: string[] }[] }[];
  warnings: PackageWarning[];
  /** Files inside Results that match no task pattern (listed for the trainer). */
  unmatched: string[];
  /** First few unsafe entry names (for the trainer). */
  unsafe: string[];
  checkedAt: string;
}

interface Placed {
  path: string;
  folder: ResultsFolderKey | null;
  /** "results" = inside a known Results subfolder; "workspace" = ignored; "outside" = elsewhere */
  zone: "results" | "workspace" | "outside";
  base: string;
}

function place(segments: string[], isDirectory: boolean): Placed & { rootSegments: string[] | null } {
  const path = segments.join("/");
  const base = isDirectory ? "" : segments[segments.length - 1];
  // Folders that contain the entry (a directory entry is its own folder).
  const dirs = isDirectory ? segments : segments.slice(0, -1);
  const lower = dirs.map((s) => s.trim().toLowerCase());

  const r = lower.indexOf("results");
  if (r >= 0) {
    const rootSegments = segments.slice(0, r);
    const f = r + 1 < dirs.length ? folderByName(dirs[r + 1]) : null;
    if (f) return { path, folder: f.key, zone: "results", base, rootSegments };
    // The Results folder itself, or a file loose in Results / in an unknown subfolder.
    return { path, folder: null, zone: isDirectory ? "workspace" : "outside", base, rootSegments };
  }

  // No "Results" folder: accept the eight folders at any depth.
  for (const d of dirs) {
    const f = folderByName(d);
    if (f) return { path, folder: f.key, zone: "results", base, rootSegments: null };
  }
  if (isDirectory || lower.includes("workspace")) return { path, folder: null, zone: "workspace", base, rootSegments: null };
  return { path, folder: null, zone: "outside", base, rootSegments: null };
}

/** Compares the ZIP listing with the test's expectations. Never throws. */
export function checkPackage(entries: readonly ZipEntryInfo[], expectations: PackageExpectations, now: Date = new Date()): PackageManifest {
  const errors = new Set<PackageError>();
  const warnings: PackageWarning[] = [];
  const unsafe: string[] = [];
  const present = new Map<ResultsFolderKey, number>();
  const files: Placed[] = [];
  let totalUncompressed = 0;
  let root: string | null = null;

  if (entries.length > PACKAGE_MAX_ENTRIES) errors.add("too_many_files");

  for (const e of entries.slice(0, PACKAGE_MAX_ENTRIES * 4)) {
    totalUncompressed += Math.max(0, Number(e.uncompressedSize) || 0);
    const safe = normalizeEntryPath(e.name);
    if (!safe.ok) {
      errors.add("unsafe_path");
      if (unsafe.length < 5) unsafe.push(String(e.name).slice(0, 200));
      continue;
    }
    if (isJunkEntry(safe.segments)) continue;
    const isDir = e.isDirectory || /[\\/]$/.test(e.name);
    const p = place(safe.segments, isDir);
    if (root == null && p.rootSegments) root = p.rootSegments.join("/") || null;
    if (p.folder) present.set(p.folder, (present.get(p.folder) ?? 0) + (isDir ? 0 : 1));
    if (!isDir) files.push(p);
  }
  if (totalUncompressed > PACKAGE_MAX_UNCOMPRESSED) errors.add("too_large");
  if (files.length === 0) errors.add("empty");

  // Folders
  const required = new Set(expectations.requiredFolders);
  const folders = RESULTS_FOLDERS.map((f) => ({
    key: f.key,
    name: f.name,
    present: present.has(f.key),
    required: required.has(f.key),
    fileCount: present.get(f.key) ?? 0,
  }));
  for (const f of folders) if (f.required && !f.present) warnings.push({ code: "missing_folder", folder: f.name });

  // File types + outside files
  for (const file of files) {
    if (file.zone === "outside") {
      warnings.push({ code: "outside_results", file: file.path });
      continue;
    }
    if (file.zone !== "results" || !file.folder) continue;
    const def = RESULTS_FOLDERS.find((f) => f.key === file.folder)!;
    const ext = extOf(file.base);
    if (!(def.ext as readonly string[]).includes(ext)) warnings.push({ code: "wrong_type", folder: def.name, file: file.path, ext: ext || "?" });
  }

  // Tasks
  const matched = new Set<string>();
  const inResults = files.filter((f) => f.zone === "results" && f.folder);
  const tasks = expectations.tasks.map((t) => ({
    taskId: t.taskId,
    items: t.patterns.map((pattern) => {
      const c = compile(pattern);
      const hits = c.unknownFolder ? [] : inResults.filter((f) => (c.folder == null || f.folder === c.folder) && c.name.test(f.base));
      hits.forEach((h) => matched.add(h.path));
      const stepNeeded = t.requireStep && (c.folder === "parts_and_assemblies" || c.folder == null);
      let status: ExpectedItemStatus = hits.length > 0 ? "found" : "missing";
      if (hits.length > 0 && stepNeeded && !hits.some((h) => (STEP_EXTENSIONS as readonly string[]).includes(extOf(h.base)))) {
        status = "native_only";
        warnings.push({ code: "no_step", taskId: t.taskId, label: c.label, exts: [...new Set(hits.map((h) => extOf(h.base) || "?"))] });
      }
      if (status === "missing") warnings.push({ code: "missing_file", taskId: t.taskId, label: c.label });
      return { pattern, label: c.label, status, files: hits.map((h) => h.path).slice(0, 20) };
    }),
  }));

  const unmatched = inResults.filter((f) => !matched.has(f.path)).map((f) => f.path).slice(0, 200);

  return {
    version: 1,
    ok: errors.size === 0,
    errors: [...errors],
    entryCount: entries.length,
    fileCount: files.length,
    totalUncompressed,
    root,
    folders,
    tasks,
    warnings: warnings.slice(0, 300),
    unmatched,
    unsafe,
    checkedAt: now.toISOString(),
  };
}

/** Narrow check that a stored jsonb value looks like a manifest (for reading it back). */
export function isPackageManifest(v: unknown): v is PackageManifest {
  return !!v && typeof v === "object" && (v as { version?: unknown }).version === 1 && Array.isArray((v as { folders?: unknown }).folders);
}

/** Per task: "found" when every expected item was found with STEP where required. */
export function taskPackageStatus(manifest: PackageManifest | null, taskId: string): "none" | "complete" | "partial" | "missing" {
  if (!manifest) return "none";
  const t = manifest.tasks.find((x) => x.taskId === taskId);
  if (!t || t.items.length === 0) return "none";
  if (t.items.every((i) => i.status === "found")) return "complete";
  if (t.items.every((i) => i.status === "missing")) return "missing";
  return "partial";
}
