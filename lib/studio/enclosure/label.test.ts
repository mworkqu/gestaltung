// Raised label: the built-in segment font, where the label goes, and that it becomes part of the lid.

import { computeMeshVolume } from "three-bvh-csg";
import { describe, expect, it } from "vitest";
import { layoutComponents } from "../layout";
import { LIMITS } from "../schema";
import { buildEnclosure, planEnclosure } from "./build";
import { boxesOverlap, cutoutBox } from "./cutouts";
import { LABEL_MARGIN, planLabel } from "./label";
import { LABEL_CHARS, STROKE_GAP, labelSupport, layoutLabel, segmentDistance } from "./label-font";
import { ALL_TEMPLATES, P, items, spec, typical } from "./test-fixtures";

function setup(list = typical()) {
  const lr = layoutComponents(list, { clearance: 2 });
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  return { lr, parts };
}

describe("labelSupport", () => {
  it("accepts Latin letters, digits, space - . & (any case) and says why not otherwise", () => {
    expect(labelSupport("Desk Buddy 2")).toEqual({ ok: true, text: "DESK BUDDY 2" });
    expect(labelSupport("  R&D - v1.0 ")).toEqual({ ok: true, text: "R&D - V1.0" });
    expect(labelSupport("مرحبا").reason).toBe("script");
    expect(labelSupport("Lamp مصباح").reason).toBe("script");
    expect(labelSupport("Hi!").reason).toBe("chars");
    expect(labelSupport("Café").reason).toBe("chars");
    expect(labelSupport("A".repeat(LIMITS.label.max + 1)).reason).toBe("length");
    expect(labelSupport("A".repeat(LIMITS.label.max)).ok).toBe(true);
    expect(labelSupport("").reason).toBe("empty");
    expect(labelSupport(undefined).reason).toBe("empty");
  });
});

describe("segment font", () => {
  it("has every promised character", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.&") expect(LABEL_CHARS).toContain(ch);
  });

  for (const cap of [4, 6, 8]) {
    it(`no two strokes touch (cap ${cap} mm) — the lid union stays one clean CSG step`, () => {
      const text = LABEL_CHARS.join("").replace(/ /g, "");
      for (let i = 0; i < text.length; i += 8) {
        const lay = layoutLabel(text.slice(i, i + 8), cap);
        expect(lay.strokes.length).toBeGreaterThan(0);
        for (let a = 0; a < lay.strokes.length; a++) {
          for (let b = a + 1; b < lay.strokes.length; b++) {
            const s = lay.strokes[a];
            const t = lay.strokes[b];
            expect(segmentDistance(s.a, s.b, t.a, t.b)).toBeGreaterThanOrEqual(2 * lay.r + STROKE_GAP - 1e-6);
          }
        }
        // Everything inside the reported box.
        for (const s of lay.strokes) {
          for (const p of [s.a, s.b]) {
            expect(Math.abs(p[0]) + lay.r).toBeLessThanOrEqual(lay.width / 2 + 1e-6);
            expect(Math.abs(p[1]) + lay.r).toBeLessThanOrEqual(lay.height / 2 + 1e-6);
          }
        }
      }
    });
  }

  it("is deterministic", () => {
    expect(layoutLabel("DESK 7", 6)).toEqual(layoutLabel("DESK 7", 6));
  });
});

describe("planLabel", () => {
  for (const template of ALL_TEMPLATES) {
    it(`fits on ${template}, ≥ ${LABEL_MARGIN} mm from every opening on its surface`, () => {
      const { lr, parts } = setup();
      const plan = planEnclosure(spec({ template, label: "Gestaltung" }), lr, parts);
      const label = plan.label.plan;
      expect(label, `${template}: ${plan.label.skipped}`).toBeTruthy();
      expect(label!.cap).toBeGreaterThanOrEqual(4);
      expect(label!.cap).toBeLessThanOrEqual(8);
      expect(label!.surface).toBe(template === "lantern" ? "front" : "top");
      const sameFace = [...plan.cutouts, ...plan.keyholes].filter((c) => c.face === (label!.surface === "front" ? "-y" : "+z"));
      for (const c of sameFace) {
        const b = cutoutBox(c);
        const [u0, u1] = [b.min[0], b.max[0]];
        const [v0, v1] = label!.surface === "front" ? [b.min[2], b.max[2]] : [b.min[1], b.max[1]];
        const lu0 = label!.center[0] - label!.width / 2;
        const lu1 = label!.center[0] + label!.width / 2;
        const lv0 = label!.center[1] - label!.height / 2;
        const lv1 = label!.center[1] + label!.height / 2;
        const gap = Math.max(u0 - lu1, lu0 - u1, v0 - lv1, lv0 - v1);
        expect(gap, `${template} label vs ${c.id}`).toBeGreaterThanOrEqual(LABEL_MARGIN - 1e-6);
      }
      if (template === "lantern") expect(label!.center[1] - label!.height / 2).toBeGreaterThanOrEqual(plan.dims.splitZ);
    });
  }

  it("shrinks the cap height before giving up, and is skipped with 'space' when nothing fits", () => {
    const small = setup(items(["t1", P.tiny]));
    const plan = planEnclosure(spec({ label: "ABCDEFGHIJKLMNOP" }), small.lr, small.parts);
    expect(plan.label.plan).toBeNull();
    expect(plan.label.skipped).toBe("space");
    const short = planEnclosure(spec({ label: "AB" }), small.lr, small.parts);
    expect(short.label.plan).toBeTruthy();
    const big = setup();
    const roomy = planEnclosure(spec({ label: "AB" }), big.lr, big.parts);
    expect(roomy.label.plan!.cap).toBe(8);
  });

  it("skips Arabic and unsupported text with a reason, and ignores an empty label", () => {
    const { lr, parts } = setup();
    expect(planEnclosure(spec({ label: "مصباح" }), lr, parts).label).toEqual({ plan: null, skipped: "script" });
    expect(planEnclosure(spec({ label: "Hi!" }), lr, parts).label).toEqual({ plan: null, skipped: "chars" });
    expect(planEnclosure(spec(), lr, parts).label).toEqual({ plan: null });
    const d = planEnclosure(spec(), lr, parts).dims;
    expect(planLabel("   ", d, [])).toEqual({ plan: null });
  });

  it("vents keep ≥ 3 mm away from the label", () => {
    const { lr, parts } = setup(items(["u1", P.board]));
    const plan = planEnclosure(spec({ label: "VENTED", vents: { pattern: "holes", face: "+z", count: 24 } }), lr, parts);
    expect(plan.label.plan).toBeTruthy();
    for (const v of plan.vents) expect(boxesOverlap(cutoutBox(v), plan.label.plan!.box, 3 - 1e-6)).toBe(false);
  });
});

describe("label geometry", () => {
  for (const template of ["rounded_box", "dome_base", "lantern", "wall_plate", "soft_wedge"] as const) {
    it(`is part of the lid mesh and adds volume: ${template}`, () => {
      const { lr, parts } = setup();
      const plain = buildEnclosure(spec({ template }), lr, parts);
      const named = buildEnclosure(spec({ template, label: "Desk Buddy" }), lr, parts);
      expect(named.meta.label).toBeTruthy();
      expect(named.meta.labelSkipped).toBeUndefined();
      const v0 = computeMeshVolume(plain.lid);
      const v1 = computeMeshVolume(named.lid);
      expect(v1).toBeGreaterThan(v0 + 1);
      // Base untouched.
      expect(computeMeshVolume(named.base)).toBeCloseTo(computeMeshVolume(plain.base), 0);
      // Raised ~0.6 mm: on a flat lid the top grows by about that much.
      if (template === "rounded_box" || template === "wall_plate") {
        expect(named.lid.geometry.boundingBox!.max.z - plain.lid.geometry.boundingBox!.max.z).toBeCloseTo(0.6, 1);
      }
      expect(named.meta.triangles).toBeLessThan(60000);
    }, 30_000);
  }

  it("Arabic: lid unchanged, flagged", () => {
    const { lr, parts } = setup();
    const plain = buildEnclosure(spec(), lr, parts);
    const ar = buildEnclosure(spec({ label: "مصباح" }), lr, parts);
    expect(ar.meta.labelSkipped).toBe("script");
    expect(ar.meta.label).toBeNull();
    expect(computeMeshVolume(ar.lid)).toBeCloseTo(computeMeshVolume(plain.lid), 3);
  });
});
