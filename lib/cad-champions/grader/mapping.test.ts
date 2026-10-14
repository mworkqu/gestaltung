import { describe, expect, it } from "vitest";

import {
  aspectOutcomes,
  autoScoreFor,
  graderAspectsFor,
  graderChecksFor,
  isReferenceComplete,
  studentDetails,
  toStudentResult,
  type AspectLite,
  type GraderResultLike,
} from "./mapping";

const aspects: AspectLite[] = [
  { id: "a-vol", check_key: "volume", max_points: 10, method: "auto_step" },
  { id: "a-area", check_key: "area", max_points: 5, method: "auto_step" },
  { id: "a-inertia", check_key: "inertia", max_points: 7.5, method: "auto_step" },
  { id: "a-solids", check_key: "solids", max_points: 2.5, method: "auto_step" },
  { id: "a-rubric", check_key: "rubric:title_block", max_points: 3, method: "ai_drawing" },
];

const REF_VOLUME = 125000.123;
const REF_MOMENTS = [5.2e7, 5.2e7, 5.2e7];

const raw: GraderResultLike = {
  score: 20,
  max_points: 25,
  checks: [
    { name: "volume", measured: 124999.5, passed: true, partial: 1 },
    { name: "surface_area", measured: 15001.2, passed: true, partial: 1 },
    { name: "principal_moments", measured: [5.1e7, 5.3e7, 5.2e7], passed: false, partial: 0 },
    { name: "solid_count_validity", measured: { solids: 1, valid: true }, passed: true, partial: 1 },
  ],
  error_code: null,
  warnings: ["MATCHED_BY_VOLUME"],
  feedback_en: "The amount of material is right, but some features seem to be in the wrong place.",
  feedback_ar: "كمية المادة صحيحة",
  help_slug: null,
  passed: false,
  practice_score: null,
  details: { measured: { volume_mm3: 124999.5 }, rel_errors: { volume: -0.000005 }, reference: { volume_mm3: REF_VOLUME, principal_moments_mm5: REF_MOMENTS } },
};

describe("isReferenceComplete", () => {
  it("needs volume, area and three moments", () => {
    expect(isReferenceComplete({ volume_mm3: 1, area_mm2: 1, principal_moments_mm5: [1, 2, 3] })).toBe(true);
    expect(isReferenceComplete({})).toBe(false);
    expect(isReferenceComplete({ volume_mm3: 125000, solids: 1 })).toBe(false);
    expect(isReferenceComplete({ volume_mm3: 1, area_mm2: 1, principal_moments_mm5: [1, 2] })).toBe(false);
    expect(isReferenceComplete(null)).toBe(false);
  });
});

describe("aspect mapping", () => {
  it("maps check keys to grader checks per mode", () => {
    expect(graderChecksFor("area", "part")).toEqual(["surface_area"]);
    expect(graderChecksFor("inertia", "assembly")).toEqual(["assembly_position"]);
    expect(graderChecksFor("volume", "assembly")).toEqual(["part:*"]);
    expect(graderChecksFor("rubric:views", "part")).toEqual([]);
  });

  it("sends only one-to-one auto aspects to the grader", () => {
    expect(graderAspectsFor(aspects, "part").map((a) => a.check)).toEqual(["volume", "surface_area", "principal_moments", "solid_count_validity"]);
    expect(graderAspectsFor(aspects, "assembly").map((a) => a.check)).toEqual(["assembly_position", "parts_count"]);
  });

  it("measurement aspects are full marks or zero", () => {
    const out = aspectOutcomes(aspects, raw, "part");
    expect(out.map((o) => [o.aspectId, o.passed, o.points])).toEqual([
      ["a-vol", true, 10],
      ["a-area", true, 5],
      ["a-inertia", false, 0],
      ["a-solids", true, 2.5],
    ]);
    expect(autoScoreFor(out, raw)).toEqual({ score: 17.5, maxPoints: 25 });
  });

  it("an error code fails every aspect", () => {
    const err = { ...raw, checks: [], error_code: "E_WRONG_UNITS", score: 0 };
    expect(aspectOutcomes(aspects, err, "part").every((o) => !o.passed && o.points === 0)).toBe(true);
  });

  it("assembly volume needs every part to pass", () => {
    const asm: GraderResultLike = {
      ...raw,
      checks: [
        { name: "part:base", passed: true, partial: 1 },
        { name: "part:pin", passed: false, partial: 0 },
        { name: "parts_count", passed: true, partial: 1 },
        { name: "assembly_position", passed: true, partial: 1 },
      ],
    };
    const out = Object.fromEntries(aspectOutcomes(aspects, asm, "assembly").map((o) => [o.aspectId, o.passed]));
    expect(out).toEqual({ "a-vol": false, "a-area": false, "a-inertia": true, "a-solids": true });
  });

  it("practice scoring keeps partial credit", () => {
    const pr = { ...raw, checks: [{ name: "volume", passed: false, partial: 0.5 }] };
    const out = aspectOutcomes([aspects[0]], pr, "practice");
    expect(out[0]).toMatchObject({ passed: false, points: 5 });
  });
});

describe("toStudentResult", () => {
  it("never leaks details, measured values or reference numbers", () => {
    const safe = toStudentResult(raw, { score: 17.5, maxPoints: 25 });
    const text = JSON.stringify(safe);
    expect(safe).not.toHaveProperty("details");
    expect(text).not.toContain("measured");
    expect(text).not.toContain("124999");
    expect(text).not.toContain("15001");
    expect(text).not.toContain(String(REF_VOLUME));
    expect(text).not.toContain("rel_errors");
    expect(text).not.toContain("5100000");
    for (const c of safe.checks) expect(Object.keys(c).sort()).toEqual(["name", "partial", "passed"]);
    expect(safe).toMatchObject({ score: 17.5, maxPoints: 25, passed: false, errorCode: null, warnings: ["MATCHED_BY_VOLUME"] });
  });

  it("student details stay safe too", () => {
    const d = studentDetails(toStudentResult(raw), { fileName: "A12/DAY 01/Results/Parts and Assemblies/Part_03.step", matchedByVolume: true });
    const text = JSON.stringify(d);
    expect(text).not.toContain("measured");
    expect(text).not.toContain("124999");
    expect(d.file_name).toBe("Part_03.step");
    expect(studentDetails(null, { needsManualReview: true })).toEqual({ needs_manual_review: true });
  });
});
