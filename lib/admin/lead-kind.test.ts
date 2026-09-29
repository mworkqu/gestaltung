import { describe, expect, it } from "vitest";

import { leadKind, leadProjectId } from "./lead-kind";

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
