import { describe, expect, it } from "vitest";

import { leadKind, leadProjectId } from "./lead-kind";
import { parseLeadMessage } from "./lead-parse";

describe("leadKind", () => {
  it("reads each endpoint's message", () => {
    expect(leadKind("Custom manufacturing quote request.\nMethod: CNC")).toBe("quote");
    expect(leadKind('Drawing request for project "Box" (x).')).toBe("drawing");
    expect(leadKind("Quote request for 3 unstocked items.")).toBe("bom");
    expect(leadKind("Store landing — requested a callback.")).toBe("callback");
    expect(leadKind("Hello, do you sell M3 screws?")).toBe("contact");
  });
});

describe("leadProjectId", () => {
  const id = "c3881430-94d3-4c79-9b61-7507a012d582";
  it("finds the project in a quote, drawing or BOM message", () => {
    expect(leadProjectId(`Custom manufacturing quote request.\nProject: ${id} (export: https://x/api/admin/projects/${id}/export)`)).toBe(id);
    expect(leadProjectId(`Drawing request for project "Box" (${id}).`)).toBe(id);
    expect(leadProjectId(`Quote request.\n\nProject: Box — https://x/en/projects/${id}`)).toBe(id);
  });
  it("is null when there is none", () => {
    expect(leadProjectId("Hello")).toBeNull();
  });
});

describe("print request (Design Studio, P5-14)", () => {
  const id = "c3881430-94d3-4c79-9b61-7507a012d582";
  const uid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const msg = [
    `Print request: Desk buddy — https://x/en/projects/${id}/studio?step=print — 3 parts, ≈ 41 g, materials PLA, TPU`,
    `Project: Desk buddy — https://x/en/projects/${id}/studio?step=print`,
    "- Lid — PLA · 20 g\n- Base — PLA · 19 g\n- Button extender — TPU · 2 g",
    `Files:\n- cad-files/${uid}/${id}/print/2026-10-10T20-00-00-000Z/lid.stl\n- cad-files/${uid}/${id}/print/2026-10-10T20-00-00-000Z/base.stl`,
  ].join("\n\n");
  it("counts as a quote and points at its project", () => {
    expect(leadKind(msg)).toBe("quote");
    expect(leadProjectId(msg)).toBe(id);
  });
  it("lists every stored STL and keeps paths out of the readable body", () => {
    const p = parseLeadMessage(msg);
    expect(p.files.map((f) => f.name)).toEqual(["lid.stl", "base.stl"]);
    expect(p.files[0]).toMatchObject({ bucket: "cad-files", path: `${uid}/${id}/print/2026-10-10T20-00-00-000Z/lid.stl` });
    expect(p.projectName).toBe("Desk buddy");
    expect(p.body).toContain("Print request: Desk buddy — 3 parts, ≈ 41 g, materials PLA, TPU");
    expect(p.body).not.toContain("cad-files");
    expect(p.body).toContain("- Button extender — TPU · 2 g");
  });
});
