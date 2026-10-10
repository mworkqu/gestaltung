// Vent patterns (slots / holes / hex / grille / louvres), keyholes, and the per-template budget.

import { computeMeshVolume } from "three-bvh-csg";
import { describe, expect, it } from "vitest";
import { layoutComponents } from "../layout";
import { VENT_FACES, VENT_PATTERNS, clampEnclosure, type EnclosureSpec } from "../schema";
import { buildEnclosure, planEnclosure } from "./build";
import { GRILLE, VENT_MARGIN, boxesOverlap, cutoutBox, grilleArcs, ventCutouts } from "./cutouts";
import { insideSection } from "./templates";
import { ALL_TEMPLATES, P, items, spec, typical } from "./test-fixtures";

function setup(list = typical()) {
  const lr = layoutComponents(list, { clearance: 2 });
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  return { lr, parts };
}

const vents = (pattern: EnclosureSpec["vents"]["pattern"], face: EnclosureSpec["vents"]["face"], count = 12) => ({ pattern, face, count });

describe("vent patterns", () => {
  it("never cut within 3 mm of a port opening (every pattern × face × template)", () => {
    const { lr, parts } = setup();
    for (const template of ALL_TEMPLATES) {
      for (const pattern of VENT_PATTERNS) {
        for (const face of VENT_FACES) {
          const plan = planEnclosure(spec({ template, vents: vents(pattern, face, 24) }), lr, parts);
          for (const v of plan.vents) {
            for (const c of [...plan.cutouts, ...plan.keyholes]) {
              expect(boxesOverlap(cutoutBox(v), cutoutBox(c), VENT_MARGIN - 1e-6), `${template} ${pattern} ${face} ${v.id}↔${c.id}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it("grille = concentric arcs with bridges, centred on the face", () => {
    const arcs = grilleArcs(9, 40, 40);
    expect(arcs.length).toBe(9);
    const radii = [...new Set(arcs.map((a) => a.arc!.r))];
    expect(radii.length).toBe(3);
    for (let i = 1; i < radii.length; i++) expect(radii[i] - radii[i - 1]).toBeGreaterThanOrEqual(GRILLE.width + 1);
    for (const a of arcs) {
      // Each arc is shorter than a third of its ring (a bridge on both sides keeps the centre attached).
      expect(a.arc!.a1 - a.arc!.a0).toBeLessThan((2 * Math.PI) / 3);
      expect(a.shape).toBe("arc");
    }
    expect(grilleArcs(9, 6, 6)).toEqual([]);

    const { lr, parts } = setup(items(["u1", P.board]));
    const plain = buildEnclosure(spec({ template: "dome_base" }), lr, parts);
    const grilled = buildEnclosure(spec({ template: "dome_base", vents: vents("grille", "+z", 9) }), lr, parts);
    expect(grilled.meta.vents.length).toBeGreaterThan(3);
    expect(grilled.meta.vents.every((v) => v.shape === "arc" && v.face === "+z")).toBe(true);
    expect(computeMeshVolume(grilled.lid)).toBeLessThan(computeMeshVolume(plain.lid) - 1);
  }, 30_000);

  it("louvres = slanted, chamfered slats on a side face", () => {
    const { lr, parts } = setup(items(["u1", P.board]));
    const s = spec({ proportions: { heightBias: "tall" }, vents: vents("louvres", "+x", 4) });
    const plan = planEnclosure(s, lr, parts);
    expect(plan.vents.length).toBeGreaterThan(0);
    for (const v of plan.vents) {
      expect(v.face).toBe("+x");
      expect(v.axis![0]).toBeGreaterThan(0.5); // outwards …
      expect(v.axis![2]).toBeLessThan(-0.3); // … and down (rain sheds)
      expect(v.bevel).toBeGreaterThan(0);
      expect(v.w).toBeGreaterThan(v.h * 3);
    }
    const plain = buildEnclosure(spec({ proportions: { heightBias: "tall" } }), lr, parts);
    const built = buildEnclosure(s, lr, parts);
    expect(computeMeshVolume(built.base)).toBeLessThan(computeMeshVolume(plain.base) - 1);
    // On a top / bottom face louvres make no sense: clamp moves them to a side, the planner falls back to slots.
    expect(clampEnclosure({ ...s, vents: vents("louvres", "-z") }).vents.face).toBe("+x");
    const d = plan.dims;
    expect(ventCutouts(spec({ vents: vents("louvres", "+z") }), d).every((v) => !v.axis && v.shape === "rrect")).toBe(true);
  }, 30_000);

  it("lantern: light slots around the upper band (lid), on all four sides", () => {
    const { lr, parts } = setup(items(["u1", P.board]));
    const plan = planEnclosure(spec({ template: "lantern", vents: vents("slots", "+x", 6) }), lr, parts);
    expect(new Set(plan.vents.map((v) => v.face))).toEqual(new Set(["+x", "-x", "+y", "-y"]));
    for (const v of plan.vents) expect(cutoutBox(v).min[2]).toBeGreaterThan(plan.dims.splitZ + 1.5);
  });
});

describe("wall plate keyholes", () => {
  it("two keyholes in the back, inside the floor, no feet", () => {
    const { lr, parts } = setup();
    const plan = planEnclosure(spec({ template: "wall_plate", feet: "rubber_4" }), lr, parts);
    expect(plan.keyholes.length).toBe(2);
    const d = plan.dims;
    for (const k of plan.keyholes) {
      expect(k.face).toBe("-z");
      const b = cutoutBox(k);
      for (const [x, y] of [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.min[0], b.max[1]], [b.max[0], b.max[1]]]) {
        expect(insideSection(d, x, y, d.wall)).toBe(true);
      }
    }
    expect(plan.keyholes[0].center[0]).toBeCloseTo(-plan.keyholes[1].center[0], 6);
    expect(planEnclosure(spec(), lr, parts).keyholes).toEqual([]);
    const built = buildEnclosure(spec({ template: "wall_plate", feet: "rubber_4" }), lr, parts);
    expect(built.base.children.length).toBe(0);
    const solid = buildEnclosure(spec({ template: "rounded_box", proportions: { widthToDepth: built.meta.W / built.meta.D } }), lr, parts);
    expect(computeMeshVolume(built.base)).toBeGreaterThan(0);
    expect(solid.meta.keyholes).toEqual([]);
  }, 30_000);
});

describe("budget per template (label + vents + feet)", () => {
  for (const template of ALL_TEMPLATES) {
    it(`< 60k triangles and < 1500 ms: ${template}`, () => {
      const { lr, parts } = setup();
      const pattern: EnclosureSpec["vents"]["pattern"] = template === "dome_base" ? "grille" : template === "rounded_box" ? "louvres" : "slots";
      const face: EnclosureSpec["vents"]["face"] = template === "dome_base" ? "+z" : "+x";
      const s = spec({ template, label: "Gestaltung 360", vents: vents(pattern, face, 12), feet: "rubber_4" });
      buildEnclosure(s, lr, parts); // warm-up
      // The budget is the build's own CPU time (vitest runs each file in its own process), best
      // of 5 — wall time on a busy machine (other suites in parallel) says nothing about the code.
      let ms = Infinity;
      let wall = Infinity;
      let meta = buildEnclosure(s, lr, parts).meta;
      for (let i = 0; i < 5 && ms >= 1500; i++) {
        const c0 = process.cpuUsage();
        const t0 = performance.now();
        meta = buildEnclosure(s, lr, parts).meta;
        wall = Math.min(wall, performance.now() - t0);
        const c = process.cpuUsage(c0);
        ms = Math.min(ms, (c.user + c.system) / 1000);
      }
      console.info(`[enclosure] ${template}: ${ms.toFixed(0)} ms CPU (${wall.toFixed(0)} ms wall), ${meta.triangles} tris, ${meta.vents.length} vents, label ${meta.label ? `${meta.label.cap} mm` : meta.labelSkipped}`);
      expect(meta.triangles).toBeLessThan(60000);
      expect(ms).toBeLessThan(1500);
    }, 30_000);
  }
});
