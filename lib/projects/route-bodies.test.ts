import { describe, expect, it } from "vitest";

import { BomMatchBody, PROJECT_CAD_LIMITS, ProjectCadBody, projectCadRate } from "./route-bodies";

const PID = "0b9a3c1e-7f2d-4c55-9a1e-1234567890ab";

describe("ProjectCadBody", () => {
  it("trims and cuts like the route did by hand", () => {
    const r = ProjectCadBody.parse({
      project_id: ` ${PID} `,
      storage_path: ` u/${"p".repeat(600)} `,
      file_name: "f".repeat(300),
      file_size: "1234",
      locale: "ar",
    });
    expect(r.projectId).toBe(PID);
    expect(r.storagePath).toHaveLength(PROJECT_CAD_LIMITS.storagePath);
    expect(r.fileName).toHaveLength(PROJECT_CAD_LIMITS.fileName);
    expect(r.fileSize).toBe(1234);
    expect(r.locale).toBe("ar");
  });

  it("missing fields come out empty (the route answers 422 missing_fields)", () => {
    expect(ProjectCadBody.parse({})).toEqual({ projectId: "", storagePath: "", fileName: "", fileSize: 0, locale: "en" });
    expect(ProjectCadBody.parse({ file_size: "abc" }).fileSize).toBe(0);
    expect(ProjectCadBody.parse({ file_size: -5 }).fileSize).toBe(0);
  });

  it("rejects wrong types and oversized strings", () => {
    expect(ProjectCadBody.safeParse(null).success).toBe(false);
    expect(ProjectCadBody.safeParse({ project_id: { $ne: 1 } }).success).toBe(false);
    expect(ProjectCadBody.safeParse({ storage_path: ["a"] }).success).toBe(false);
    expect(ProjectCadBody.safeParse({ file_name: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("BomMatchBody", () => {
  it("needs a project id string of uuid shape", () => {
    expect(BomMatchBody.safeParse({ projectId: PID }).success).toBe(true);
    expect(BomMatchBody.safeParse({ projectId: "x" }).success).toBe(false);
    expect(BomMatchBody.safeParse({ projectId: 7 }).success).toBe(false);
    expect(BomMatchBody.safeParse({}).success).toBe(false);
    expect(BomMatchBody.safeParse(null).success).toBe(false);
  });
});

describe("projectCadRate", () => {
  it("5 per user per 10 minutes, then Retry-After", () => {
    const hits = Array.from({ length: 6 }, (_, i) => projectCadRate.hit("test-u1", i));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, true, true, false]);
    expect(hits[5].retryAfterSec).toBe(600);
    expect(projectCadRate.hit("test-u2", 6).allowed).toBe(true);
    expect(projectCadRate.hit("test-u1", 10 * 60 * 1000).allowed).toBe(true);
  });
});
