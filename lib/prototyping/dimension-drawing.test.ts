import { describe, expect, it } from "vitest";

import {
  DIMS,
  hasDrawableView,
  renderDimensionDrawing,
  type Dim,
  type DimensionedPart,
  type DrawingLabels,
} from "./dimension-drawing";

const L: DrawingLabels = {
  dim: Object.fromEntries(DIMS.map((d) => [d, d])) as Record<Dim, string>,
  missing: (what) => `Missing ${what}`,
  noShape: "No shape",
  front: "Front",
  top: "Top",
  side: "Side",
  flat: "Flat pattern",
  thickness: (mm) => `Material thickness: ${mm}`,
  dxfNote: "Outline only — not a cut file.",
  title: { part: "Part", material: "Material", process: "Process", quantity: "Qty", scale: "Scale", units: "Units" },
  materialName: "Acrylic",
  processName: "Laser cutting",
};

const part = (over: Partial<DimensionedPart>): DimensionedPart => ({
  id: "p3",
  code: "P-03",
  name: "Front panel",
  material: "acrylic",
  process: null,
  quantity: 1,
  ...over,
});

/** The y of the (single) <text> tagged with this data-role. */
function yOf(svg: string, role: string): number {
  const tags = svg.match(new RegExp(`<text data-role="${role}"[^>]*>`, "g")) ?? [];
  expect(tags, `one ${role} line`).toHaveLength(1);
  return Number(/\sy="([\d.]+)"/.exec(tags[0] ?? "")?.[1]);
}

const count = (svg: string, needle: string) => svg.split(needle).length - 1;

describe("renderDimensionDrawing: laser-cut sheet (audit #37)", () => {
  // Long and thin: before the fix the right-aligned thickness line started
  // inside the "FLAT PATTERN" label on the same baseline.
  for (const [label, dims] of [
    ["narrow", { length_mm: 20, width_mm: 150, thickness_mm: 1 }],
    ["wide", { length_mm: 300, width_mm: 200, thickness_mm: 3 }],
  ] as const) {
    it(`puts title, view name and thickness on separate, increasing baselines (${label})`, () => {
      const svg = renderDimensionDrawing(part({ process: "laser_cutting", ...dims }), L);
      const title = yOf(svg, "title");
      const view = yOf(svg, "view");
      const thickness = yOf(svg, "thickness");
      expect(view - title).toBeGreaterThanOrEqual(14);
      expect(thickness - view).toBeGreaterThanOrEqual(14);
    });
  }

  it("keeps the thickness line clear of the outline below it", () => {
    const svg = renderDimensionDrawing(part({ process: "laser_cutting", length_mm: 20, width_mm: 150, thickness_mm: 1 }), L);
    const outlineTop = Number(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+" fill="#f8fafc"/.exec(svg)![1]);
    expect(outlineTop - yOf(svg, "thickness")).toBeGreaterThanOrEqual(8);
  });

  it("prints the not-a-cut-file warning exactly once", () => {
    const svg = renderDimensionDrawing(part({ process: "laser_cutting", length_mm: 100, width_mm: 80, thickness_mm: 3 }), L);
    expect(count(svg, L.dxfNote)).toBe(1);
  });

  it("does not print the warning for a part that is not a sheet", () => {
    const svg = renderDimensionDrawing(part({ shape: "block", length_mm: 100, width_mm: 80, height_mm: 30 }), L);
    expect(count(svg, L.dxfNote)).toBe(0);
  });
});

describe("hasDrawableView (audit #37: no empty frames)", () => {
  it("is false without a shape", () => {
    expect(hasDrawableView(part({ length_mm: 10, width_mm: 10 }))).toBe(false);
  });

  it("needs the main view's numbers for each shape", () => {
    expect(hasDrawableView(part({ process: "laser_cutting" }))).toBe(false);
    expect(hasDrawableView(part({ process: "laser_cutting", length_mm: 100 }))).toBe(false);
    expect(hasDrawableView(part({ process: "laser_cutting", length_mm: 100, width_mm: 80 }))).toBe(true);
    expect(hasDrawableView(part({ shape: "block", length_mm: 100, width_mm: 80 }))).toBe(true);
    expect(hasDrawableView(part({ shape: "disc", thickness_mm: 3 }))).toBe(false);
    expect(hasDrawableView(part({ shape: "disc", diameter_mm: 40 }))).toBe(true);
    expect(hasDrawableView(part({ shape: "shaft", diameter_mm: 8 }))).toBe(false);
    expect(hasDrawableView(part({ shape: "shaft", diameter_mm: 8, length_mm: 120 }))).toBe(true);
  });

  it("does not count zero, negative or non-numeric values", () => {
    expect(hasDrawableView(part({ shape: "block", length_mm: 0, width_mm: 80 }))).toBe(false);
    expect(hasDrawableView(part({ shape: "block", length_mm: -5, width_mm: 80 }))).toBe(false);
    expect(hasDrawableView(part({ shape: "block", length_mm: "abc", width_mm: 80 }))).toBe(false);
    expect(hasDrawableView(part({ shape: "block", length_mm: "100", width_mm: "80" }))).toBe(true);
  });
});
