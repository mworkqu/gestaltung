import { describe, expect, it } from "vitest";

import { shapeContinueProjects, studioHref } from "./continue-projects";

describe("continue where you left off (D4)", () => {
  it("links back into the Studio at the remembered step", () => {
    expect(studioHref("p1", "wiring")).toBe("/projects/p1/studio?step=wiring");
    expect(studioHref("p1", null)).toBe("/projects/p1/studio");
  });

  it("keeps at most three, in the given order, with a fallback name", () => {
    const rows = [
      { id: "a", name: "Plant buddy", updated_at: "2026-10-11T10:00:00Z", last_step: "enclosure" },
      { id: "b", name: "  ", updated_at: "2026-10-10T10:00:00Z", last_step: null },
      { id: "c", name: "Lamp", updated_at: "2026-10-09T10:00:00Z", last_step: "make" },
      { id: "d", name: "Old", updated_at: "2026-10-01T10:00:00Z", last_step: "idea" },
    ];
    const out = shapeContinueProjects(rows, "Untitled");
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({ name: "Plant buddy", step: "enclosure", href: "/projects/a/studio?step=enclosure" });
    expect(out[1]).toMatchObject({ name: "Untitled", step: null, href: "/projects/b/studio" });
  });

  it("ignores a step the Studio does not know", () => {
    const [p] = shapeContinueProjects([{ id: "x", name: "N", updated_at: null, last_step: "nonsense" }], "U");
    expect(p.step).toBeNull();
    expect(p.href).toBe("/projects/x/studio");
  });
});
