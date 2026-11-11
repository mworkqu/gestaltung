import { describe, expect, it } from "vitest";

import { activeNavId, canOpenAdminPath, navForRole } from "./nav";

describe("admin nav", () => {
  it("instructors see only Today, Review, Questions and Students", () => {
    const ids = navForRole(false).flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(["today", "review", "questions", "students"]);
  });

  it("admins see every section, content grouped", () => {
    const groups = navForRole(true);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain("payments");
    expect(ids).toContain("operations");
    expect(groups.find((g) => g.id === "content")?.items.map((i) => i.id)).toEqual([
      "tests",
      "exercises",
      "lessons",
      "get-ready",
      "help",
      "glossary",
      "landing",
      "plans",
      "emails",
      "health",
    ]);
  });

  it("finds the active item by longest prefix", () => {
    expect(activeNavId("/admin")).toBe("today");
    expect(activeNavId("/admin/")).toBe("today");
    expect(activeNavId("/admin/tests/diagnostic-v1/preview")).toBe("tests");
    expect(activeNavId("/admin/review/abc")).toBe("review");
    expect(activeNavId("/admin/testsx")).toBeNull();
    expect(activeNavId("/dashboard")).toBeNull();
  });

  it("instructors may open staff paths only", () => {
    expect(canOpenAdminPath("/admin/students/123", false)).toBe(true);
    expect(canOpenAdminPath("/admin/payments", false)).toBe(false);
    expect(canOpenAdminPath("/admin/unknown", false)).toBe(false);
    expect(canOpenAdminPath("/admin/payments", true)).toBe(true);
  });
});
