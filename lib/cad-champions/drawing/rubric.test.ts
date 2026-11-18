import { describe, expect, it } from "vitest";

import { countPdfPages, isPdf, pdfLimitProblem, AI_MAX_BYTES } from "./pdf";
import { DEFAULT_DRAWING_RUBRIC, aspectMethodFor, defaultRubric, parseRubric, rubricIdFromCheckKey, rubricTotal } from "./rubric";

describe("default drawing rubric", () => {
  it("part rubric sums to 25 with judgement under 20%", () => {
    const r = defaultRubric("part");
    expect(rubricTotal(r.items)).toBe(25);
    const judgement = rubricTotal(r.items.filter((i) => i.type === "judgement"));
    expect(judgement / 25).toBeLessThan(0.2);
    expect(r.items.map((i) => i.id)).not.toContain("parts_list");
  });

  it("assembly rubric has the parts list and exploded view, not part-only items", () => {
    const ids = defaultRubric("assembly").items.map((i) => i.id);
    expect(ids).toContain("parts_list");
    expect(ids).toContain("exploded_view");
    expect(ids).not.toContain("tolerance_note");
  });

  it("covers every section E item, both languages, unique ids", () => {
    const ids = DEFAULT_DRAWING_RUBRIC.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["title_block", "projection", "views", "no_extra_views", "sections", "dimensions", "no_over_dimensioning", "no_overlap", "symbols", "tolerance_note", "limits_fits", "surface_texture", "gdt", "parts_list", "exploded_view", "key_dimensions", "presentation", "readability"]) {
      expect(ids).toContain(id);
    }
    for (const i of DEFAULT_DRAWING_RUBRIC) {
      expect(i.text_ar && i.student_hint_en && i.student_hint_ar).toBeTruthy();
      expect(i.text_ar).not.toMatch(/[٠-٩]/);
    }
    expect(DEFAULT_DRAWING_RUBRIC.find((i) => i.id === "key_dimensions")!.check_type).toBe("manual");
  });

  it("maps items to aspect methods", () => {
    expect(aspectMethodFor({ type: "measurement", check_type: "ai" })).toBe("ai_drawing");
    expect(aspectMethodFor({ type: "measurement", check_type: "manual" })).toBe("trainer");
    expect(aspectMethodFor({ type: "judgement", check_type: "ai" })).toBe("trainer");
  });

  it("parses stored rubrics defensively", () => {
    expect(parseRubric(null)).toBeNull();
    const r = parseRubric({ kind: "assembly", items: [{ id: "a", points: 2, text_en: "A" }, { id: "a", points: 1 }, { id: "Bad!", points: 1 }, { id: "c", points: -1 }, { id: "d", points: 1, type: "judgement", check_type: "ai", required: true }] });
    expect(r?.kind).toBe("assembly");
    expect(r?.items.map((i) => i.id)).toEqual(["a", "d"]);
    expect(r?.items[1].check_type).toBe("manual");
    expect(r?.items[1].required).toBe(true);
    expect(parseRubric(defaultRubric("part"))).toEqual(defaultRubric("part"));
    expect(rubricIdFromCheckKey("rubric:title_block")).toBe("title_block");
    expect(rubricIdFromCheckKey("volume")).toBeNull();
  });
});

describe("pdf limits", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const pdf = (pages: number) => enc(`%PDF-1.7\n1 0 obj << /Type /Pages /Count ${pages} >> endobj\n${Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj`).join("\n")}\n%%EOF`);

  it("counts pages and applies the limits", () => {
    expect(isPdf(pdf(1))).toBe(true);
    expect(countPdfPages(pdf(3))).toBe(3);
    expect(pdfLimitProblem(pdf(5))).toBeNull();
    expect(pdfLimitProblem(pdf(6))).toBe("too_many_pages");
    expect(pdfLimitProblem(enc("hello"))).toBe("not_pdf");
    expect(pdfLimitProblem(new Uint8Array(AI_MAX_BYTES + 1))).toBe("too_large");
    expect(countPdfPages(enc("%PDF-1.7\n<< /Type /Pages /Kids [] /Count 4 >>"))).toBe(4);
    expect(countPdfPages(enc("%PDF-1.7\n(compressed)"))).toBeNull();
  });
});
