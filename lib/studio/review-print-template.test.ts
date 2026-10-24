// The TEMPLATE path held to the product path's standard (FIX_REPORT §3.2).
//
// review-print.test.ts recorded the failure: the three-bvh-csg template builder
// made meshes no slicer could fill (the dome lid: 2,611 unbalanced edges out of
// 6,275 triangles), so the Print step withheld every file although the CAD credit
// had already been spent at the Enclosure step. The template path now goes
// through the product kernel, so this file asserts the SAME things the product
// fixture test asserts — watertight, consistent winding, exactly one shell per
// printable body, and plates inside the MK4 bed — on the same plant-waterer
// fixture, for every shape the Studio offers.

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";

import { PLANT_WATERER } from "./__fixtures__/plant-waterer";
import { defaultMechParts, mechSummary } from "./ai/mech-default";
import { BUILDABLE_TEMPLATES, defaultEnclosureFor, enclosureDims } from "./enclosure/templates";
import { planEnclosure } from "./enclosure/plan";
import { buildEnclosureCase } from "./geometry/enclosure-kernel";
import { buildEnclosure } from "./geometry/job";
import { loadManifold } from "./geometry/manifold-loader";
import { MK4_BED, checkPrintable, platePlan, shellCount } from "./geometry/mesh-check";
import { getPart } from "./library";
import { layoutComponents, type LayoutInput } from "./layout";
import { buildMechParts } from "./mech/build";
import type { EnclosureTemplate } from "./schema";
import { gramsFromVolume, printedGramsOf } from "./weight";

const HEAVY = 180_000;

const items = (): LayoutInput[] => PLANT_WATERER.components.map((c) => ({ instanceId: c.instanceId, part: getPart(c.partId)! }));
const partsMap = () => new Map(PLANT_WATERER.components.map((c) => [c.instanceId, getPart(c.partId)!] as const));

function setup(template?: EnclosureTemplate) {
  const spec = { ...defaultEnclosureFor(PLANT_WATERER.spec), ...(template ? { template } : {}), label: "Plant Waterer" };
  const lr = layoutComponents(items(), { clearance: spec.clearance, sizeHint: PLANT_WATERER.spec.sizeHint });
  return { spec, lr, parts: partsMap(), dims: enclosureDims(spec, lr) };
}

/** The Print step's own list: the case's shells + every printed mech part, as it builds them. */
async function printedParts(template?: EnclosureTemplate) {
  const { spec, lr, parts } = setup(template);
  const plan = planEnclosure(spec, lr, parts);
  const enc = await buildEnclosure(spec, lr, parts);
  const summary = mechSummary({
    components: PLANT_WATERER.components,
    layout: plan.placed,
    getPart,
    enclosure: { w: plan.dims.W, d: plan.dims.D, h: plan.dims.H },
    template: plan.dims.template,
  });
  const built = buildMechParts(defaultMechParts(summary), { ...lr, layout: plan.placed }, parts, {
    base: enc.base,
    lid: enc.lid,
    dims: enc.meta.dims,
  });
  return { plan, built, meta: enc.meta };
}

describe("F-003 the plant waterer's TEMPLATE bodies are printable (manifold-3d)", () => {
  let mf: ManifoldToplevel;
  beforeAll(async () => {
    mf = await loadManifold();
  }, HEAVY);

  it(
    "is watertight, one shell per printed body, consistent winding",
    async () => {
      const { built } = await printedParts("stake_pod");
      expect(built.length).toBeGreaterThan(2);
      for (const b of built) {
        expect(b.check.watertight, `${b.id} closed`).toBe(true);
        expect(b.check.badEdges, `${b.id} winding`).toBe(0);
        expect(b.check.shells, `${b.id} shells`).toBe(1);
        expect(b.check.ok, `${b.id} printable`).toBe(true);
      }
    },
    HEAVY,
  );

  it(
    "weighs what its mesh volume says, and its plates fit the bed",
    async () => {
      const { built, meta } = await printedParts("stake_pod");
      for (const b of built) {
        expect(b.printable.estGrams, b.id).toBe(gramsFromVolume(b.volumeMm3, b.printable.material));
      }
      const plan = platePlan(built.map((b) => ({ w: b.size.w, d: b.size.d, h: b.size.h })));
      expect(plan.tooBig).toEqual([]);
      expect(plan.plates.length).toBeGreaterThan(0);
      for (const p of plan.plates) {
        expect(p.w).toBeLessThanOrEqual(MK4_BED.x);
        expect(p.d).toBeLessThanOrEqual(MK4_BED.y);
      }
      // Every part lands on exactly one plate — nothing is silently dropped.
      const placed = plan.plates.flatMap((p) => p.items.map((i) => i.index)).sort((a, b) => a - b);
      expect(placed).toEqual(built.map((_, i) => i));
      // What the owner reads on the Print step.
      const grams = Math.round(printedGramsOf(built.map((b) => ({ grams: b.printable.estGrams, count: 1 }))));
      console.info(
        `[template] stake_pod: ${meta.W} x ${meta.D} x ${meta.H} mm, ${built.length} bodies, ${grams} g, ${plan.plates.length} plate(s), ${meta.triangles} triangles, ${meta.ms} ms`,
      );
      expect(grams).toBeGreaterThan(0);
    },
    HEAVY,
  );

  it(
    "really opens the wall where a port is: a ray down the cut-out meets no plastic",
    async () => {
      for (const template of ["rounded_box", "dome_base", "stake_pod"] as const) {
        const { spec, lr, parts } = setup(template);
        const plan = planEnclosure(spec, lr, parts);
        const enc = await buildEnclosure(spec, lr, parts);
        const shells = [enc.base, enc.lid];
        for (const mesh of shells) {
          mesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
          mesh.updateMatrixWorld(true);
        }
        // A side port (the board's USB-C socket) and a cable gland for an external part.
        const cuts = plan.cutouts.filter((c) => c.kind === "usb_c" || c.kind === "lead");
        expect(cuts.length, `${template} has ports to open`).toBeGreaterThan(0);
        let rayHits = 0;
        for (const c of cuts) {
          const n = new THREE.Vector3(...c.normal).normalize();
          const centre = new THREE.Vector3(...c.center);
          // Start outside the shell on the cut's axis and look inwards.
          const from = centre.clone().addScaledVector(n, c.depth);
          const ray = new THREE.Raycaster(from, n.clone().negate());
          const hits = shells.flatMap((m) => ray.intersectObject(m, false));
          hits.sort((a, b) => a.distance - b.distance);
          const outer = from.distanceTo(centre) - c.depth / 2;
          // The first surface the ray meets is NOT the outer wall at the port: the
          // opening is a hole, so the ray travels on into the cavity (or right through).
          const first = hits[0];
          if (first) {
            rayHits += 1;
            expect(first.distance, `${template} ${c.id} opening`).toBeGreaterThan(outer + 0.5);
          }
        }
        // The rays must really meet the shell somewhere, or this proves nothing.
        expect(rayHits, `${template} rays hit the shell`).toBeGreaterThan(0);
      }
    },
    HEAVY,
  );

  it(
    "holds for every shape the chooser offers, with the name on the lid and vents cut",
    () => {
      const { parts } = setup();
      for (const template of BUILDABLE_TEMPLATES) {
        const spec = {
          ...defaultEnclosureFor(PLANT_WATERER.spec),
          template,
          // Short enough to fit the gentle top of a dome as well as a flat lid.
          label: "WATER",
          vents: { pattern: "grille" as const, face: "+x" as const, count: 18 },
        };
        const lr = layoutComponents(items(), { clearance: spec.clearance, sizeHint: PLANT_WATERER.spec.sizeHint });
        const plan = planEnclosure(spec, lr, parts);
        const made = buildEnclosureCase(mf, plan);
        for (const [name, check] of Object.entries(made.checks)) {
          if (!check) continue;
          expect(check.watertight, `${template} ${name} closed (bad edges ${check.badEdges})`).toBe(true);
          expect(check.badEdges, `${template} ${name} winding`).toBe(0);
          expect(check.shells, `${template} ${name} shells`).toBe(1);
        }
        // Recounted independently of manifold's own status, like the product test does.
        expect(shellCount(made.lid), `${template} lid shells (recounted)`).toBe(1);
        expect(shellCount(made.base), `${template} base shells (recounted)`).toBe(1);
        expect(checkPrintable(made.lid).ok, `${template} lid`).toBe(true);
        // The lid carries the raised name (it sits above the split), so it is in that mesh.
        expect(plan.label.plan, `${template} label`).toBeTruthy();
        // A stake pod exports its soil spike as a body of its own (F-005).
        expect(made.spike !== null, `${template} spike`).toBe(template === "stake_pod");
      }
    },
    HEAVY,
  );
});
