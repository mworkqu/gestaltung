import { describe, expect, it } from "vitest";

import { contentIssues, groupIssues, hasTodo, isEmptyJson, messageTodoIssues, rubricHasItems, totalIssues, type ContentInput } from "./health";

const links = { testSlugById: new Map([["t1", "diagnostic-v1"]]) };
const video = { video_inventor_en: null, video_inventor_ar: null, video_fusion_en: null, video_fusion_ar: null, video_solidworks_en: null, video_solidworks_ar: null, video_neutral_en: null, video_neutral_ar: null };

function run(partial: Partial<ContentInput["rows"]>, aspects: ContentInput["rubricAspectOwners"] = null) {
  return contentIssues({ rows: partial, rubricAspectOwners: aspects, links });
}

describe("missing text", () => {
  it("flags one empty side while the other has text, with the missing side", () => {
    const issues = run({
      test: [{ id: "a", slug: "diag", title_en: "Diagnostic", title_ar: "", intro_en: "", intro_ar: "", rules_en: "x", rules_ar: "  " }],
    });
    const m = issues.filter((i) => i.kind === "missing_text");
    expect(m.map((i) => `${i.field}:${i.side}`).sort()).toEqual(["rules:ar", "title:ar"]);
    expect(m[0].href).toBe("/admin/tests/diag");
  });

  it("does not flag when both sides are empty or both filled", () => {
    const issues = run({ cohort: [{ id: "c", slug: "c1", name_en: "Spring", name_ar: "ربيع", schedule_en: null, schedule_ar: null, location_en: "Doha", location_ar: "الدوحة" }] });
    expect(issues).toEqual([]);
  });

  it("compares string arrays (objectives, hints, includes)", () => {
    const issues = run({
      lesson: [{ id: "l", slug: "l1", is_published: true, title_en: "A", title_ar: "ب", objectives_en: ["a"], objectives_ar: [], notes_en: null, notes_ar: null, common_mistakes_en: null, common_mistakes_ar: null, ...video, video_neutral_en: "abc" }],
      plan: [{ id: "p", slug: "online", name_en: "Online", name_ar: "أونلاين", who_for_en: null, who_for_ar: null, includes_en: [], includes_ar: ["x"] }],
    });
    expect(issues.map((i) => `${i.entity}:${i.field}:${i.side}`).sort()).toEqual(["lesson:objectives:ar", "plan:includes:en"]);
  });

  it("links tasks to their test editor and levels to their editors", () => {
    const issues = run({
      task: [{ id: "k", test_id: "t1", title_en: "Part", title_ar: "", brief_en: null, brief_ar: null, material_name_en: null, material_name_ar: null, grading_mode: "manual" }],
      level: [{ id: "lv", module_id: "m", level_number: 1, title_en: "L1", title_ar: "", goal_en: null, goal_ar: null }],
      help: [{ id: "h1", slug: "s", is_published: true, title_en: "", title_ar: "عنوان", body_en: "", body_ar: "" }],
    });
    const byEntity = Object.fromEntries(issues.map((i) => [i.entity, i.href]));
    expect(byEntity.task).toBe("/admin/tests/diagnostic-v1");
    expect(byEntity.level).toBe("/admin/lessons/levels/lv");
    expect(byEntity.help).toBe("/admin/help/h1");
  });
});

describe("lessons and help", () => {
  it("flags a lesson with no video in any slot", () => {
    const base = { id: "l", slug: "l1", is_published: false, title_en: "A", title_ar: "ب", objectives_en: [], objectives_ar: [], notes_en: null, notes_ar: null, common_mistakes_en: null, common_mistakes_ar: null };
    const none = run({ lesson: [{ ...base, ...video }] });
    expect(none.map((i) => i.kind)).toEqual(["lesson_no_video"]);
    expect(none[0].published).toBe(false);
    expect(run({ lesson: [{ ...base, ...video, video_fusion_ar: "guid" }] })).toEqual([]);
  });

  it("flags unpublished help articles", () => {
    const issues = run({ help: [{ id: "h", slug: "a", is_published: false, title_en: "A", title_ar: "ب", body_en: "x", body_ar: "y" }] });
    expect(issues.map((i) => i.kind)).toEqual(["help_unpublished"]);
  });
});

describe("grading setup", () => {
  const task = (over: Record<string, unknown>) => ({ id: "k1", test_id: "t1", title_en: "T", title_ar: "ت", brief_en: null, brief_ar: null, material_name_en: null, material_name_ar: null, ...over });

  it("flags auto_step without reference data", () => {
    expect(run({ task: [task({ grading_mode: "auto_step", reference_data: null })] }).map((i) => i.kind)).toEqual(["no_reference_data"]);
    expect(run({ task: [task({ grading_mode: "auto_step", reference_data: {} })] }).map((i) => i.kind)).toEqual(["no_reference_data"]);
    expect(run({ task: [task({ grading_mode: "auto_step", reference_data: { volume: 1 } })] })).toEqual([]);
    expect(run({ task: [task({ grading_mode: "manual", reference_data: null })] })).toEqual([]);
  });

  it("flags ai_drawing without a rubric, or with a rubric but no aspects", () => {
    expect(run({ task: [task({ grading_mode: "ai_drawing", rubric: null })] }).map((i) => i.kind)).toEqual(["no_rubric"]);
    expect(run({ task: [task({ grading_mode: "ai_drawing", rubric: { version: 1, items: [] } })] }).map((i) => i.kind)).toEqual(["no_rubric"]);
    const rubric = { version: 1, kind: "part", items: [{ id: "a" }] };
    const owners = { taskIds: new Set<string>(), exerciseIds: new Set<string>() };
    expect(run({ task: [task({ grading_mode: "ai_drawing", rubric })] }, owners).map((i) => i.kind)).toEqual(["no_rubric_aspects"]);
    expect(run({ task: [task({ grading_mode: "ai_drawing", rubric })] }, { taskIds: new Set(["k1"]), exerciseIds: new Set() })).toEqual([]);
    // aspect lookup unavailable: do not guess
    expect(run({ task: [task({ grading_mode: "ai_drawing", rubric })] }, null)).toEqual([]);
  });

  it("applies the same rules to exercises and links them by slug", () => {
    const issues = run({
      exercise: [{ id: "e1", slug: "bracket", is_published: true, title_en: "E", title_ar: "ت", brief_en: null, brief_ar: null, material_name_en: null, material_name_ar: null, hints_en: [], hints_ar: [], grading_mode: "auto_step", reference_data: null }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].href).toBe("/admin/exercises/bracket");
  });
});

describe("TODO placeholders", () => {
  it("finds placeholders in database text and reports the language", () => {
    const issues = run({
      plan: [{ id: "p", slug: "online", name_en: "Online", name_ar: "أونلاين", who_for_en: "[TODO-MO: who]", who_for_ar: "للطلاب", includes_en: ["a"], includes_ar: ["ب"] }],
    });
    const todo = issues.find((i) => i.kind === "todo_content");
    expect(todo?.side).toBe("en");
    expect(todo?.field).toBe("whoFor");
    expect(todo?.excerpt).toContain("[TODO-MO");
  });

  it("scans message trees of both locales, skips the admin namespace and maps editor links", () => {
    const en = {
      account: { retention: "Within [TODO-MO: days] days" },
      landing: { faq: { a: ["x", "[TODO-MO: y]"] } },
      admin: { home: { note: "[TODO-MO: skip me]" } },
    };
    const ar = { account: { retention: "خلال [TODO-MO: days] يوم" }, admin: { home: { note: "[TODO-MO]" } } };
    const issues = messageTodoIssues({ en, ar });
    expect(issues.map((i) => `${i.side}:${i.messageKey}`).sort()).toEqual(["ar:account.retention", "en:account.retention", "en:landing.faq.a.1"]);
    expect(issues.find((i) => i.messageKey === "landing.faq.a.1")?.href).toBe("/admin/landing");
    expect(issues.find((i) => i.messageKey === "account.retention")?.href).toBeNull();
  });
});

describe("helpers and grouping", () => {
  it("detects empty JSON and rubric items", () => {
    expect(isEmptyJson(null)).toBe(true);
    expect(isEmptyJson({})).toBe(true);
    expect(isEmptyJson([])).toBe(true);
    expect(isEmptyJson("{}")).toBe(true);
    expect(isEmptyJson({ a: 1 })).toBe(false);
    expect(rubricHasItems({ items: [1] })).toBe(true);
    expect(rubricHasItems({ items: [] })).toBe(false);
    expect(rubricHasItems(null)).toBe(false);
    expect(hasTodo("x [todo-mo: y]")).toBe(true);
    expect(hasTodo(5)).toBe(false);
  });

  it("groups by kind in a fixed order with counts, including empty kinds", () => {
    const issues = [
      ...run({ help: [{ id: "h", slug: "a", is_published: false, title_en: "A", title_ar: "ب", body_en: "x", body_ar: "y" }] }),
      ...messageTodoIssues({ en: { account: { a: "[TODO-MO: a]" } } }),
    ];
    const groups = groupIssues(issues);
    expect(groups.map((g) => g.kind)[0]).toBe("missing_text");
    expect(groups.find((g) => g.kind === "help_unpublished")?.count).toBe(1);
    expect(groups.find((g) => g.kind === "todo_message")?.count).toBe(1);
    expect(groups.find((g) => g.kind === "no_rubric")?.count).toBe(0);
    expect(totalIssues(groups)).toBe(2);
  });
});
