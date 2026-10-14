import { describe, expect, it } from "vitest";

import {
  buildTrackNotes,
  buildUnlockRule,
  cleanGlossaryTerms,
  computeReorder,
  freePreviewAuditAction,
  isAllSlots,
  nextSort,
  parseDownloads,
  parseLines,
  parseTrackNotes,
  parseUnlockRule,
  publishAuditAction,
  slugify,
  validateDownloads,
  validateLessonInput,
  validateLevelInput,
  validateModuleInput,
  validateVideoId,
} from "./lessons";

const GUID = "123e4567-e89b-12d3-a456-426614174000";

describe("validateVideoId", () => {
  it("accepts empty as no video", () => {
    expect(validateVideoId("  ")).toEqual({ ok: true, value: null, provider: null });
    expect(validateVideoId(null)).toEqual({ ok: true, value: null, provider: null });
  });
  it("accepts youtube:<11 chars> and normalises the prefix", () => {
    expect(validateVideoId("YouTube:dQw4w9WgXcQ")).toEqual({ ok: true, value: "youtube:dQw4w9WgXcQ", provider: "youtube" });
  });
  it("rejects a bad youtube id and a bare id", () => {
    expect(validateVideoId("youtube:short").ok).toBe(false);
    expect(validateVideoId("dQw4w9WgXcQ").ok).toBe(false);
  });
  it("accepts a Bunny GUID (lower-cased) and rejects near misses", () => {
    expect(validateVideoId(GUID.toUpperCase())).toEqual({ ok: true, value: GUID, provider: "bunny" });
    expect(validateVideoId(GUID.slice(1)).ok).toBe(false);
  });
});

describe("slug and lines", () => {
  it("slugify", () => {
    expect(slugify("  My new Lesson! 2 ")).toBe("my-new-lesson-2");
    expect(slugify("درس")).toBe("");
  });
  it("parseLines drops empty lines and caps", () => {
    expect(parseLines(" a \r\n\n b\n")).toEqual(["a", "b"]);
    expect(parseLines(Array.from({ length: 30 }, (_, i) => `x${i}`).join("\n"))).toHaveLength(20);
  });
});

describe("downloads", () => {
  it("parses stored JSON and skips unsafe paths", () => {
    expect(parseDownloads([{ path: "a/b.pdf", label_en: "A" }, { path: "../x" }, { path: "/abs" }, 5])).toEqual([{ path: "a/b.pdf", label_en: "A", label_ar: "" }]);
  });
  it("validates input", () => {
    expect(validateDownloads([{ path: "a/b.zip", label_en: "x", label_ar: "y" }]).ok).toBe(true);
    expect(validateDownloads([{ path: "../b", label_en: "x", label_ar: "y" }]).ok).toBe(false);
    expect(validateDownloads("nope").ok).toBe(false);
  });
});

describe("track notes", () => {
  it("round-trips inventor_only and equivalent", () => {
    const state = parseTrackNotes({ fusion: "inventor_only", solidworks: { en: "Use X", ar: "استخدم س" } });
    expect(state.fusion.mode).toBe("inventor_only");
    expect(state.solidworks).toEqual({ mode: "equivalent", en: "Use X", ar: "استخدم س" });
    const built = buildTrackNotes(state, { inventor: "keep" });
    expect(built).toEqual({ ok: true, value: { inventor: "keep", fusion: "inventor_only", solidworks: { en: "Use X", ar: "استخدم س" } } });
  });
  it("needs both texts for equivalent", () => {
    const r = buildTrackNotes({ fusion: { mode: "equivalent", en: "only en", ar: "" } });
    expect(r.ok).toBe(false);
  });
  it("none removes the key", () => {
    expect(buildTrackNotes({ fusion: { mode: "none" } }, { fusion: "inventor_only" })).toEqual({ ok: true, value: {} });
  });
});

describe("unlock rule", () => {
  it("parses known and unknown", () => {
    expect(parseUnlockRule({ type: "open" })).toEqual({ mode: "open" });
    expect(parseUnlockRule({ type: "previous_level_passed", pass_mark: 70 })).toEqual({ mode: "previous_level_passed", passMark: 70 });
    expect(parseUnlockRule({ type: "weird" })).toEqual({ mode: "keep" });
  });
  it("builds", () => {
    expect(buildUnlockRule({ mode: "open" })).toEqual({ ok: true, value: { type: "open" } });
    expect(buildUnlockRule({ mode: "previous_level_passed", passMark: "85" })).toEqual({ ok: true, value: { type: "previous_level_passed", pass_mark: 85 } });
    expect(buildUnlockRule({ mode: "previous_level_passed", passMark: 0 }).ok).toBe(false);
    expect(buildUnlockRule({ mode: "keep" })).toEqual({ ok: true, value: null });
    expect(buildUnlockRule({ mode: "x" }).ok).toBe(false);
  });
});

describe("module and level input", () => {
  it("module requires titles and valid enums", () => {
    expect(validateModuleInput({ title_en: "", title_ar: "x" }).ok).toBe(false);
    const ok = validateModuleInput({ title_en: "A", title_ar: "ب", skill_area_id: "3", competition_module: "M2", sort: "20", is_published: true, icon: "Box" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toMatchObject({ skill_area_id: 3, competition_module: "M2", sort: 20, is_published: true, icon: "Box", is_orientation: false });
    expect(validateModuleInput({ title_en: "A", title_ar: "ب", skill_area_id: 9 }).ok).toBe(false);
    expect(validateModuleInput({ title_en: "A", title_ar: "ب", competition_module: "M9" }).ok).toBe(false);
  });
  it("level number 0..6 and unlock rule", () => {
    const ok = validateLevelInput({ title_en: "L", title_ar: "م", level_number: "4", unlock_rule: { mode: "open" } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.unlock_rule).toEqual({ type: "open" });
    expect(validateLevelInput({ title_en: "L", title_ar: "م", level_number: 7, unlock_rule: { mode: "open" } }).ok).toBe(false);
  });
});

describe("validateLessonInput", () => {
  const base = { slug: "extrude-basics", title_en: "Extrude", title_ar: "بثق", sort: 10 };
  it("accepts a minimal lesson", () => {
    const r = validateLessonInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.video_inventor_en).toBeNull();
      expect(r.value.objectives_en).toEqual([]);
      expect(r.value.is_published).toBe(false);
    }
  });
  it("rejects bad slug, bad video and bad duration", () => {
    const r = validateLessonInput({ ...base, slug: "Bad Slug", video_fusion_ar: "nope", duration_minutes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["duration_minutes", "slug", "video_fusion_ar"]);
  });
  it("normalises videos, objectives and glossary", () => {
    const r = validateLessonInput({
      ...base,
      video_neutral_en: GUID.toUpperCase(),
      video_solidworks_ar: "youtube:dQw4w9WgXcQ",
      objectives_en: "one\n\ntwo",
      glossary_terms: ["step-file", "nope", "step-file", "volume"],
      duration_minutes: "12",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.video_neutral_en).toBe(GUID);
      expect(r.value.video_solidworks_ar).toBe("youtube:dQw4w9WgXcQ");
      expect(r.value.objectives_en).toEqual(["one", "two"]);
      expect(r.value.glossary_terms).toEqual(["step-file", "volume"]);
      expect(r.value.duration_minutes).toBe(12);
    }
  });
  it("has all eight slots", () => {
    expect(isAllSlots()).toBe(true);
    expect(cleanGlossaryTerms("x")).toEqual([]);
  });
});

describe("computeReorder", () => {
  const items = [
    { id: "a", sort: 10 },
    { id: "b", sort: 20 },
    { id: "c", sort: 30 },
  ];
  it("swaps down and up", () => {
    expect(computeReorder(items, "a", "down")).toEqual([
      { id: "b", sort: 10 },
      { id: "a", sort: 20 },
    ]);
    expect(computeReorder(items, "c", "up")).toEqual([
      { id: "c", sort: 20 },
      { id: "b", sort: 30 },
    ]);
  });
  it("does nothing at the edges or for unknown ids", () => {
    expect(computeReorder(items, "a", "up")).toEqual([]);
    expect(computeReorder(items, "c", "down")).toEqual([]);
    expect(computeReorder(items, "zz", "up")).toEqual([]);
  });
  it("heals equal sort values", () => {
    const eq = [
      { id: "a", sort: 0 },
      { id: "b", sort: 0 },
      { id: "c", sort: 0 },
    ];
    const changed = computeReorder(eq, "c", "up");
    const byId = Object.fromEntries(changed.map((x) => [x.id, x.sort]));
    expect(byId).toEqual({ a: 10, c: 20, b: 30 });
  });
  it("nextSort", () => {
    expect(nextSort([])).toBe(10);
    expect(nextSort([10, 40, 20])).toBe(50);
  });
});

describe("audit actions", () => {
  it("only when changed", () => {
    expect(publishAuditAction("lesson", false, true)).toBe("lesson.publish");
    expect(publishAuditAction("level", true, false)).toBe("level.unpublish");
    expect(publishAuditAction("module", true, true)).toBeNull();
    expect(freePreviewAuditAction(false, true)).toBe("lesson.free_preview_on");
    expect(freePreviewAuditAction(true, false)).toBe("lesson.free_preview_off");
    expect(freePreviewAuditAction(true, true)).toBeNull();
  });
});
