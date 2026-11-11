// Content health rules (Prompt 11 Step C). PURE: rows in, issues out; tested
// in health.test.ts. The database reads and the message trees are loaded in
// health-server.ts.
//
// An issue is one thing an admin can fix, with a direct edit link:
//   missing_text          one language empty while the other has text
//   lesson_no_video       lesson with no video id in any track or language
//   no_reference_data     auto_step task/exercise without reference_data
//   no_rubric             ai_drawing task/exercise without a rubric
//   no_rubric_aspects     ai_drawing with a rubric but no rubric aspects
//   help_unpublished      help article not published
//   todo_content          "[TODO-MO" in a database text column
//   todo_message          "[TODO-MO" in a message file visible on public pages

export type EntityKind = "test" | "task" | "module" | "level" | "lesson" | "exercise" | "help" | "plan" | "cohort";

export const HEALTH_KINDS = [
  "missing_text",
  "lesson_no_video",
  "no_reference_data",
  "no_rubric",
  "no_rubric_aspects",
  "help_unpublished",
  "todo_content",
  "todo_message",
] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

export interface HealthIssue {
  /** Stable key (React key, tests). */
  id: string;
  kind: HealthKind;
  entity: EntityKind | "message";
  entityId: string | null;
  /** What is incomplete (a title, or the message key). */
  title: string;
  /** Which field (message key under CC.admin.health.fields), for missing_text and todo_content. */
  field?: string;
  /** The language that is missing (missing_text) or that holds the placeholder. */
  side?: "en" | "ar";
  /** Message file + key, for todo_message ("account.retention"). */
  messageKey?: string;
  /** Short excerpt of the placeholder text. */
  excerpt?: string;
  /** Lesson / help article published state, when relevant. */
  published?: boolean;
  /** Public CC path (no locale) of the editor, e.g. "/admin/tests/diagnostic-v1"; null = no editor yet. */
  href: string | null;
}

export interface HealthGroup {
  kind: HealthKind;
  count: number;
  issues: HealthIssue[];
}

// ─── entity specs ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** [field label key, EN column, AR column, true when the column is a string array] */
type Pair = readonly [field: string, en: string, ar: string, array?: boolean];

export interface EntitySpec {
  kind: EntityKind;
  table: string;
  /** Columns to select (comma separated). */
  select: string;
  titleCols: readonly [en: string, ar: string];
  pairs: readonly Pair[];
}

export const LESSON_VIDEO_COLUMNS = [
  "video_inventor_en",
  "video_inventor_ar",
  "video_fusion_en",
  "video_fusion_ar",
  "video_solidworks_en",
  "video_solidworks_ar",
  "video_neutral_en",
  "video_neutral_ar",
] as const;

export const ENTITY_SPECS: readonly EntitySpec[] = [
  {
    kind: "test",
    table: "cc_tests",
    select: "id,slug,title_en,title_ar,intro_en,intro_ar,rules_en,rules_ar",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["intro", "intro_en", "intro_ar"],
      ["rules", "rules_en", "rules_ar"],
    ],
  },
  {
    kind: "task",
    table: "cc_test_tasks",
    select: "id,test_id,title_en,title_ar,brief_en,brief_ar,material_name_en,material_name_ar,grading_mode,reference_data,rubric",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["brief", "brief_en", "brief_ar"],
      ["material", "material_name_en", "material_name_ar"],
    ],
  },
  {
    kind: "module",
    table: "cc_modules",
    select: "id,slug,title_en,title_ar,description_en,description_ar,why_it_matters_en,why_it_matters_ar",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["description", "description_en", "description_ar"],
      ["whyItMatters", "why_it_matters_en", "why_it_matters_ar"],
    ],
  },
  {
    kind: "level",
    table: "cc_levels",
    select: "id,module_id,level_number,title_en,title_ar,goal_en,goal_ar",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["goal", "goal_en", "goal_ar"],
    ],
  },
  {
    kind: "lesson",
    table: "cc_lessons",
    select: `id,slug,is_published,title_en,title_ar,objectives_en,objectives_ar,notes_en,notes_ar,common_mistakes_en,common_mistakes_ar,${LESSON_VIDEO_COLUMNS.join(",")}`,
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["objectives", "objectives_en", "objectives_ar", true],
      ["notes", "notes_en", "notes_ar"],
      ["commonMistakes", "common_mistakes_en", "common_mistakes_ar"],
    ],
  },
  {
    kind: "exercise",
    table: "cc_exercises",
    select: "id,slug,is_published,title_en,title_ar,brief_en,brief_ar,material_name_en,material_name_ar,hints_en,hints_ar,grading_mode,reference_data,rubric",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["brief", "brief_en", "brief_ar"],
      ["material", "material_name_en", "material_name_ar"],
      ["hints", "hints_en", "hints_ar", true],
    ],
  },
  {
    kind: "help",
    table: "cc_help_articles",
    select: "id,slug,is_published,title_en,title_ar,body_en,body_ar",
    titleCols: ["title_en", "title_ar"],
    pairs: [
      ["title", "title_en", "title_ar"],
      ["body", "body_en", "body_ar"],
    ],
  },
  {
    kind: "plan",
    table: "cc_plans",
    select: "id,slug,name_en,name_ar,who_for_en,who_for_ar,includes_en,includes_ar",
    titleCols: ["name_en", "name_ar"],
    pairs: [
      ["name", "name_en", "name_ar"],
      ["whoFor", "who_for_en", "who_for_ar"],
      ["includes", "includes_en", "includes_ar", true],
    ],
  },
  {
    kind: "cohort",
    table: "cc_cohorts",
    select: "id,slug,name_en,name_ar,schedule_en,schedule_ar,location_en,location_ar",
    titleCols: ["name_en", "name_ar"],
    pairs: [
      ["name", "name_en", "name_ar"],
      ["schedule", "schedule_en", "schedule_ar"],
      ["location", "location_en", "location_ar"],
    ],
  },
];

// ─── edit links ───────────────────────────────────────────────────────────

export interface LinkContext {
  /** test id -> test slug (task rows live inside a test editor). */
  testSlugById: ReadonlyMap<string, string>;
}

/**
 * Where an admin edits each kind of record (CC path, no locale). One place to
 * change if an editor route moves. null = no dedicated editor (the list page
 * is used instead where one exists).
 */
export function editHref(kind: EntityKind, row: Row, ctx: LinkContext): string | null {
  const slug = typeof row.slug === "string" && row.slug ? row.slug : null;
  const id = typeof row.id === "string" ? row.id : null;
  switch (kind) {
    case "test":
      return slug ? `/admin/tests/${slug}` : "/admin/tests";
    case "task": {
      const testSlug = typeof row.test_id === "string" ? ctx.testSlugById.get(row.test_id) : undefined;
      return testSlug ? `/admin/tests/${testSlug}` : "/admin/tests";
    }
    case "exercise":
      return slug ? `/admin/exercises/${slug}` : "/admin/exercises";
    case "lesson":
      return id ? `/admin/lessons/lesson/${id}` : "/admin/lessons";
    case "module":
      return id ? `/admin/lessons/modules/${id}` : "/admin/lessons";
    case "level":
      return id ? `/admin/lessons/levels/${id}` : "/admin/lessons";
    case "help":
      return id ? `/admin/help/${id}` : "/admin/help";
    case "plan":
    case "cohort":
      return "/admin/plans";
  }
}

/** Message files whose texts an admin can edit in the admin panel; the rest are code-owned. */
const EDITABLE_MESSAGE_FILES: Readonly<Record<string, string>> = {
  "get-ready": "/admin/get-ready",
  landing: "/admin/landing",
};

// ─── small helpers ────────────────────────────────────────────────────────

export const TODO_MARKER = "[TODO-MO";

export function hasTodo(text: unknown): boolean {
  return typeof text === "string" && text.toUpperCase().includes(TODO_MARKER);
}

function asText(v: unknown, isArray?: boolean): string {
  if (isArray) return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).join("\n") : "";
  return typeof v === "string" ? v : "";
}

export function isEmptyText(v: unknown, isArray = false): boolean {
  return asText(v, isArray).trim() === "";
}

export function isEmptyJson(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "" || v.trim() === "{}" || v.trim() === "[]" || v.trim() === "null";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** A rubric (cc_*.rubric) counts when it has at least one item. */
export function rubricHasItems(rubric: unknown): boolean {
  if (rubric && typeof rubric === "object" && !Array.isArray(rubric)) {
    const items = (rubric as { items?: unknown }).items;
    return Array.isArray(items) && items.length > 0;
  }
  return Array.isArray(rubric) && rubric.length > 0;
}

function excerpt(text: string): string {
  const i = text.toUpperCase().indexOf(TODO_MARKER);
  const from = Math.max(0, i - 20);
  const s = text.slice(from, from + 90).replace(/\s+/g, " ").trim();
  return (from > 0 ? "..." : "") + s + (from + 90 < text.length ? "..." : "");
}

function titleOf(spec: EntitySpec, row: Row): string {
  const en = asText(row[spec.titleCols[0]]).trim();
  const ar = asText(row[spec.titleCols[1]]).trim();
  if (en) return en;
  if (ar) return ar;
  return typeof row.slug === "string" && row.slug ? row.slug : typeof row.id === "string" ? row.id : "-";
}

// ─── the rules ────────────────────────────────────────────────────────────

export interface ContentInput {
  /** Rows per entity kind (columns as in ENTITY_SPECS select). A missing kind is skipped. */
  rows: Partial<Record<EntityKind, readonly Row[]>>;
  /** Task / exercise ids that have at least one rubric aspect (check_key "rubric:..."). null = could not check. */
  rubricAspectOwners: { taskIds: ReadonlySet<string>; exerciseIds: ReadonlySet<string> } | null;
  links: LinkContext;
}

export function contentIssues(input: ContentInput): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const spec of ENTITY_SPECS) {
    const rows = input.rows[spec.kind];
    if (!rows) continue;
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      const title = titleOf(spec, row);
      const href = editHref(spec.kind, row, input.links);
      const published = typeof row.is_published === "boolean" ? row.is_published : undefined;
      const base = { entity: spec.kind, entityId: id, title, href, ...(published === undefined ? {} : { published }) };

      for (const [field, enCol, arCol, arr] of spec.pairs) {
        const en = asText(row[enCol], arr);
        const ar = asText(row[arCol], arr);
        const enEmpty = en.trim() === "";
        const arEmpty = ar.trim() === "";
        if (enEmpty !== arEmpty) {
          const side = enEmpty ? "en" : "ar";
          out.push({ ...base, id: `missing:${spec.kind}:${id}:${field}:${side}`, kind: "missing_text", field, side });
        }
        for (const [side, text] of [["en", en], ["ar", ar]] as const) {
          if (hasTodo(text)) {
            out.push({ ...base, id: `todo:${spec.kind}:${id}:${field}:${side}`, kind: "todo_content", field, side, excerpt: excerpt(text) });
          }
        }
      }

      if (spec.kind === "lesson" && LESSON_VIDEO_COLUMNS.every((c) => isEmptyText(row[c]))) {
        out.push({ ...base, id: `novideo:${id}`, kind: "lesson_no_video" });
      }

      if (spec.kind === "help" && published === false) {
        out.push({ ...base, id: `unpublished:${id}`, kind: "help_unpublished" });
      }

      if ((spec.kind === "task" || spec.kind === "exercise") && typeof row.grading_mode === "string") {
        if (row.grading_mode === "auto_step" && isEmptyJson(row.reference_data)) {
          out.push({ ...base, id: `noref:${spec.kind}:${id}`, kind: "no_reference_data" });
        }
        if (row.grading_mode === "ai_drawing") {
          if (!rubricHasItems(row.rubric)) {
            out.push({ ...base, id: `norubric:${spec.kind}:${id}`, kind: "no_rubric" });
          } else if (input.rubricAspectOwners && id) {
            const owners = spec.kind === "task" ? input.rubricAspectOwners.taskIds : input.rubricAspectOwners.exerciseIds;
            if (!owners.has(id)) out.push({ ...base, id: `norubricaspects:${spec.kind}:${id}`, kind: "no_rubric_aspects" });
          }
        }
      }
    }
  }
  return out;
}

/** Message keys (file.path) whose text still holds a [TODO-MO placeholder, per locale; the admin namespace is skipped. */
export function messageTodoIssues(
  trees: Partial<Record<"en" | "ar", unknown>>,
  opts: { skipFiles?: readonly string[] } = {},
): HealthIssue[] {
  const skip = new Set(opts.skipFiles ?? ["admin"]);
  const out: HealthIssue[] = [];
  const walk = (node: unknown, path: string, side: "en" | "ar", file: string) => {
    if (typeof node === "string") {
      if (hasTodo(node)) {
        out.push({
          id: `msg:${side}:${path}`,
          kind: "todo_message",
          entity: "message",
          entityId: null,
          title: path,
          side,
          messageKey: path,
          excerpt: excerpt(node),
          href: EDITABLE_MESSAGE_FILES[file] ?? null,
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}.${i}`, side, file));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, side, file);
    }
  };
  for (const side of ["en", "ar"] as const) {
    const tree = trees[side];
    if (!tree || typeof tree !== "object") continue;
    for (const [file, sub] of Object.entries(tree as Record<string, unknown>)) {
      if (skip.has(file)) continue;
      walk(sub, file, side, file);
    }
  }
  return out;
}

/** Groups by kind in a fixed order; empty kinds are included with count 0. */
export function groupIssues(issues: readonly HealthIssue[]): HealthGroup[] {
  return HEALTH_KINDS.map((kind) => {
    const list = issues.filter((i) => i.kind === kind);
    return { kind, count: list.length, issues: list };
  });
}

export function totalIssues(groups: readonly HealthGroup[]): number {
  return groups.reduce((s, g) => s + g.count, 0);
}
