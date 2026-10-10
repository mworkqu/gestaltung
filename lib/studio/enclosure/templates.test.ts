import { describe, expect, it } from "vitest";
import { layoutComponents, worldBox } from "../layout";
import { DEFAULT_SPEC, LIMITS, type EnclosureTemplate, type LibraryPart } from "../schema";
import { enclosureDims, heightRuleOk, insideSection, templateFor, topAt, defaultEnclosureFor, type EnclosureDims } from "./templates";
import { P, items, spec, typical } from "./test-fixtures";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper", "lantern"];

function checkFits(d: EnclosureDims, list: { instanceId: string; part: LibraryPart }[]) {
  const r = layoutComponents(list, { clearance: d.clearance });
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  const c = d.clearance;
  for (const it of r.layout) {
    const b = worldBox(it, parts.get(it.instanceId)!);
    for (const x of [b.min[0] - c, b.max[0] + c]) {
      for (const y of [b.min[1] - c, b.max[1] + c]) {
        expect(insideSection(d, x, y, d.wall), `${d.template} ${it.instanceId} xy`).toBe(true);
        expect(b.max[2] + d.floorZ + c, `${d.template} ${it.instanceId} z`).toBeLessThanOrEqual(topAt(d, y) - d.wall + 1e-6);
      }
    }
  }
}

function checkRules(d: EnclosureDims) {
  expect(Math.min(d.W, d.D)).toBeGreaterThanOrEqual(LIMITS.minFootprint);
  expect(heightRuleOk(d)).toBe(true);
  expect(d.cornerRadius).toBeGreaterThanOrEqual(3);
  if (d.shape === "rrect") expect(d.cornerRadius).toBeLessThanOrEqual(0.33 * Math.min(d.W, d.D) + 1e-6);
  expect(d.edgeFillet).toBeGreaterThanOrEqual(1);
  expect(d.splitZ).toBeGreaterThan(d.floorZ);
  expect(d.splitZ).toBeLessThan(d.frontH ?? d.H);
}

describe("enclosureDims", () => {
  for (const template of TEMPLATES) {
    it(`fits the layout and obeys the rules: ${template}`, () => {
      const list = typical();
      const d = enclosureDims(spec({ template }), layoutComponents(list, { clearance: 2 }));
      checkRules(d);
      checkFits(d, list);
      if (template === "lantern") expect(d.template).toBe("rounded_box");
      if (template === "puck") expect(d.W).toBe(d.D);
      if (template === "pill") expect(d.cornerRadius).toBeCloseTo(Math.min(d.W, d.D) / 2, 1);
      if (template === "soft_wedge") {
        expect(d.wedgeDeg).toBeGreaterThanOrEqual(10);
        expect(d.wedgeDeg).toBeLessThanOrEqual(20);
        expect(topAt(d, -d.D / 2)).toBeLessThan(topAt(d, d.D / 2));
      }
      if (template === "handheld_taper") expect(d.taper?.amount).toBeGreaterThanOrEqual(0.15);
    });
  }

  const extremes: [string, ReturnType<typeof spec>, ReturnType<typeof typical>][] = [
    ["widthToDepth 0.5", spec({ proportions: { widthToDepth: 0.5 } }), typical()],
    ["widthToDepth 2.5", spec({ proportions: { widthToDepth: 2.5 } }), typical()],
    ["heightBias tall", spec({ proportions: { heightBias: "tall" } }), typical()],
    ["tiny single part", spec(), items(["t1", P.tiny])],
    ["very tall part", spec(), items(["t1", P.tall])],
    ["very tall part, wedge", spec({ template: "soft_wedge" }), items(["t1", P.tall])],
    ["max wall/clearance/radius", spec({ wall: 4, clearance: 4, cornerRadius: 20, edgeFillet: 6 }), typical()],
  ];
  for (const [name, s, list] of extremes) {
    for (const template of TEMPLATES) {
      it(`design rules hold: ${name} / ${template}`, () => {
        const d = enclosureDims({ ...s, template }, layoutComponents(list, { clearance: s.clearance }));
        checkRules(d);
        checkFits(d, list);
      });
    }
  }

  it("only grows sides for widthToDepth", () => {
    const lr = layoutComponents(typical(), { clearance: 2 });
    for (const r of [0.5, 1, 2.5]) {
      const d = enclosureDims(spec({ proportions: { widthToDepth: r } }), lr);
      expect(d.innerW).toBeGreaterThanOrEqual(lr.footprint.w + 2 * d.clearance);
      expect(d.innerD).toBeGreaterThanOrEqual(lr.footprint.d + 2 * d.clearance);
      expect(d.W / d.D).toBeCloseTo(r, 1);
    }
  });
});

describe("templateFor", () => {
  it("suggests a template per product", () => {
    expect(templateFor({ ...DEFAULT_SPEC, use: "desk", outputs: ["screen"] })).toBe("soft_wedge");
    expect(templateFor({ ...DEFAULT_SPEC, use: "handheld", sizeHint: "palm" })).toBe("handheld_taper");
    expect(templateFor({ ...DEFAULT_SPEC, use: "wearable" })).toBe("pill");
    expect(templateFor({ ...DEFAULT_SPEC, use: "wall" })).toBe("rounded_box");
    expect(templateFor({ ...DEFAULT_SPEC, name: "Round timer", sizeHint: "palm" })).toBe("puck");
    expect(defaultEnclosureFor({ ...DEFAULT_SPEC, use: "wall" }).proportions.heightBias).toBe("low");
  });
});
