import { describe, expect, it } from "vitest";

import {
  attachmentKindFor,
  isValidSlug,
  linesToList,
  moveInList,
  nextPosition,
  normalizeAttachments,
  parseExerciseInput,
  parseTaskInput,
  parseTestCreate,
  parseTestSettings,
  parseTolerances,
  positionUpdates,
  referenceView,
  renameReferenceParts,
  slugify,
} from "./test-builder";

describe("slugs", () => {
  it("validates and builds slugs", () => {
    expect(isValidSlug("mock-m1")).toBe(true);
    expect(isValidSlug("Mock M1")).toBe(false);
    expect(isValidSlug("new")).toBe(false);
    expect(slugify("Mock M1: Parts & Assemblies!")).toBe("mock-m1-parts-assemblies");
    expect(slugify("اختبار")).toBe("");
  });
});

describe("parseTestCreate", () => {
  it("accepts a valid test and lower-cases the slug", () => {
    const r = parseTestCreate({ slug: "Mock-M1", title_en: "Mock M1", title_ar: "تجريبي", type: "mock" });
    expect(r).toEqual({ ok: true, value: { slug: "mock-m1", title_en: "Mock M1", title_ar: "تجريبي", type: "mock" } });
  });
  it("lists the bad fields", () => {
    const r = parseTestCreate({ slug: "bad slug", title_en: "", title_ar: "x", type: "quiz" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["slug", "title_en", "type"]);
  });
});

describe("parseTestSettings", () => {
  const base = { title_en: "T", title_ar: "ت", type: "diagnostic", time_limit_minutes: "90", grace_seconds: "60", retake_cooldown_days: "30", upload_mode: "per_task" };
  it("parses numbers and optional texts", () => {
    const r = parseTestSettings({ ...base, intro_en: "  hi ", admin_only: "on" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ time_limit_minutes: 90, grace_seconds: 60, retake_cooldown_days: 30, intro_en: "hi", intro_ar: null, admin_only: true });
  });
  it("blank time limit = untimed, bad numbers rejected", () => {
    const ok = parseTestSettings({ ...base, time_limit_minutes: "" });
    expect(ok.ok && ok.value.time_limit_minutes).toBeNull();
    const r = parseTestSettings({ ...base, time_limit_minutes: "0", grace_seconds: "-1", retake_cooldown_days: "1.5", upload_mode: "zip" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["time_limit_minutes", "grace_seconds", "retake_cooldown_days", "upload_mode"]);
  });
});

describe("parseTolerances", () => {
  it("accepts known keys in (0, 0.5]", () => {
    expect(parseTolerances('{"volume":0.005,"area":"0.01"}')).toEqual({ ok: true, value: { volume: 0.005, area: 0.01 } });
    expect(parseTolerances("")).toEqual({ ok: true, value: null });
    expect(parseTolerances({})).toEqual({ ok: true, value: null });
  });
  it("rejects unknown keys and out-of-range values", () => {
    expect(parseTolerances('{"mass":0.1}').ok).toBe(false);
    expect(parseTolerances('{"volume":0.6}').ok).toBe(false);
    expect(parseTolerances('{"volume":0}').ok).toBe(false);
    expect(parseTolerances("[1]").ok).toBe(false);
    expect(parseTolerances("{").ok).toBe(false);
  });
});

describe("attachments", () => {
  it("cleans the list", () => {
    const out = normalizeAttachments([
      { path: "tests/a/brief.pdf", label_en: " Brief ", label_ar: "", kind: "drawing" },
      { path: "tests/a/brief.pdf" },
      { path: "../etc" },
      { path: "/abs" },
      { path: "x/y.png", kind: "weird" },
      null,
    ]);
    expect(out).toEqual([
      { path: "tests/a/brief.pdf", label_en: "Brief", kind: "drawing" },
      { path: "x/y.png", kind: "file" },
    ]);
    expect(normalizeAttachments("nope")).toEqual([]);
  });
  it("guesses the kind from the extension", () => {
    expect(attachmentKindFor("a.PDF")).toBe("drawing");
    expect(attachmentKindFor("a.png")).toBe("image");
    expect(attachmentKindFor("a.stp")).toBe("model");
    expect(attachmentKindFor("a.zip")).toBe("file");
  });
});

describe("parseTaskInput", () => {
  const base = {
    skill_area_id: "3",
    competition_module: "M3",
    title_en: "Plate",
    title_ar: "لوح",
    expected_upload: "step",
    max_points: "25",
    grading_mode: "auto_step",
    grader_mode: "",
    density_kg_m3: "7850",
    tolerances: "",
  };
  it("defaults grader mode to part for auto_step", () => {
    const r = parseTaskInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ skill_area_id: 3, competition_module: "M3", max_points: 25, grader_mode: "part", density_kg_m3: 7850, tolerances: null });
  });
  it("rejects missing skill area, points and bad tolerances", () => {
    const r = parseTaskInput({ ...base, skill_area_id: "", max_points: "x", tolerances: '{"volume":2}', competition_module: "M7" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(["skill_area_id", "max_points", "tolerances", "competition_module"]));
  });
});

describe("parseExerciseInput", () => {
  const base = {
    level_id: "11111111-2222-4333-8444-555555555555",
    slug: "l1-plate",
    sort: "2",
    skill_area_id: "",
    title_en: "Plate",
    title_ar: "لوح",
    expected_upload: "step",
    max_points: "100",
    grading_mode: "auto_step",
    pass_mark: "80",
    hints_en: "First\n\nSecond",
    hints_ar: ["أول"],
  };
  it("parses an exercise with practice grading by default", () => {
    const r = parseExerciseInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ skill_area_id: null, grader_mode: "practice", pass_mark: 80, sort: 2, hints_en: ["First", "Second"], hints_ar: ["أول"], solution_video_id: null, is_free_sample: false });
  });
  it("rejects a bad level, slug, pass mark and video id", () => {
    const r = parseExerciseInput({ ...base, level_id: "x", slug: "bad slug", pass_mark: "120", solution_video_id: "a b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(["level_id", "slug", "pass_mark", "solution_video_id"]));
  });
  it("splits hint lines with a cap", () => {
    expect(linesToList(Array.from({ length: 12 }, (_, i) => `h${i}`).join("\n"))).toHaveLength(10);
  });
});

describe("ordering", () => {
  it("moves and renumbers", () => {
    expect(moveInList(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveInList(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveInList(["a", "b", "c"], "x", "down")).toEqual(["a", "b", "c"]);
    const cur = new Map([["a", 1], ["b", 2], ["c", 5]]);
    expect(positionUpdates(["a", "c", "b"], cur)).toEqual([{ id: "c", position: 2 }, { id: "b", position: 3 }]);
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([{ position: 3 }, { position: null }])).toBe(4);
  });
});

describe("reference data", () => {
  const ref = {
    volume_mm3: 125000,
    area_mm2: 15000,
    mass_kg: 0.98,
    principal_moments_mm5: [1, 2, 3],
    solids: 2,
    parts: [{ name: "part_1", volume_mm3: 100 }, { name: "part_2", volume_mm3: 25 }],
  };
  it("builds a view", () => {
    const v = referenceView(ref)!;
    expect(v.volume_mm3).toBe(125000);
    expect(v.parts.map((p) => p.name)).toEqual(["part_1", "part_2"]);
    expect(referenceView(null)).toBeNull();
  });
  it("renames parts and refuses duplicates or bad names", () => {
    const r = renameReferenceParts(ref, ["Base", ""])!;
    expect((r.parts as { name: string }[]).map((p) => p.name)).toEqual(["Base", "part_2"]);
    expect(r.volume_mm3).toBe(125000);
    expect(renameReferenceParts(ref, ["A", "a"])).toBeNull();
    expect(renameReferenceParts(ref, ["bad/name", ""])).toBeNull();
  });
});
