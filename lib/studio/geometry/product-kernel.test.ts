// Heavy: builds real meshes with manifold-3d (WASM) in node. Generous timeouts —
// if this file times out under a loaded machine, rerun it alone:
//   npx vitest run lib/studio/geometry/product-kernel.test.ts

import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { CODE_LIBRARY } from "../library";
import { clampSpec } from "../schema";
import { GOLDEN_IDEAS, goldenParts } from "../product/__fixtures__/golden";
import { archetypeDefault, defaultProductFor } from "../product/archetypes";
import { ARCHETYPES } from "../product/schema";
import { MK4_BED, solveProduct, type SolvedProduct } from "../product/solve";
import { binarySTL, meshIsWatertight, pieceSTL, printReadyPositions } from "../product/stl";
import { loadManifold } from "./manifold-loader";
import { buildProductMeshes, measureOverlaps } from "./product-kernel";
import { buildProduct, getBuiltProduct, handleProductRequest, packProduct } from "./product-job";

const HEAVY = 180_000;
let mf: ManifoldToplevel;
beforeAll(async () => {
  mf = await loadManifold();
}, HEAVY);

function checkBuilt(name: string, s: SolvedProduct) {
  const built = buildProductMeshes(mf, s);
  const pieceCount = s.bodies.reduce((n, b) => n + b.pieces.length, 0);
  expect(built.pieces).toHaveLength(pieceCount);
  for (const p of built.pieces) {
    expect(p.watertight, `${name}/${p.id} manifold status`).toBe(true);
    const wt = meshIsWatertight(p);
    expect(wt.ok, `${name}/${p.id} open edges: ${wt.badEdges}`).toBe(true);
    expect(p.volumeMm3, `${name}/${p.id}`).toBeGreaterThan(1);
    expect(p.normals.length).toBe(p.positions.length);
    // On the bed: centred, lowest point at 0, inside the MK4 volume.
    const bed = printReadyPositions(p.positions, p.print.matrix);
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, minZ = Infinity;
    for (let i = 0; i < bed.length; i += 3) {
      maxX = Math.max(maxX, Math.abs(bed[i]));
      maxY = Math.max(maxY, Math.abs(bed[i + 1]));
      maxZ = Math.max(maxZ, bed[i + 2]);
      minZ = Math.min(minZ, bed[i + 2]);
    }
    expect(minZ).toBeCloseTo(0, 5);
    const [a, b] = [2 * Math.max(maxX, maxY), 2 * Math.min(maxX, maxY)];
    expect(a, `${name}/${p.id}`).toBeLessThanOrEqual(MK4_BED.x);
    expect(b, `${name}/${p.id}`).toBeLessThanOrEqual(MK4_BED.y);
    expect(maxZ, `${name}/${p.id}`).toBeLessThanOrEqual(MK4_BED.z);
  }
  for (const l of built.links) expect(meshIsWatertight(l).ok).toBe(true);
  // No two bodies share material (touching faces are fine).
  expect(measureOverlaps(mf, s, 0.5), name).toEqual([]);
  return built;
}

describe("product kernel (manifold-3d)", () => {
  for (const g of GOLDEN_IDEAS) {
    it(
      `${g.key}: every piece watertight, on the MK4 bed, no intersecting bodies`,
      () => {
        const parts = goldenParts(g);
        const s = solveProduct(defaultProductFor(g.spec, parts), parts, { spec: g.spec });
        const t0 = Date.now();
        const built = checkBuilt(g.key, s);
        expect(Date.now() - t0).toBeLessThan(20_000);
        expect(built.hash).toBe(s.hash);
        expect(built.electronics).toEqual(s.electronics);
      },
      HEAVY,
    );
  }

  it(
    "all 12 archetype defaults build clean",
    () => {
      const spec = clampSpec({ name: "Test product", use: "desk", power: "usb", environment: "indoor", features: [], inputs: ["button"], outputs: ["led"], sizeHint: "palm", style: "rounded", quantity: 1 });
      const parts = ["esp32_c3_mini", "led_5mm", "button_6mm"].map((id, i) => ({ instanceId: `${id}_${i + 1}`, part: CODE_LIBRARY.getPart(id)! }));
      for (const a of ARCHETYPES) checkBuilt(a, solveProduct(archetypeDefault(a, spec, parts), parts, { spec }));
    },
    HEAVY,
  );

  it(
    "junk models (seeded fuzz) still build closed meshes",
    () => {
      const spec = clampSpec({ name: "Fuzz", use: "desk", power: "usb", environment: "indoor", features: [], inputs: [], outputs: [], sizeHint: "palm", style: "rounded", quantity: 1 });
      const parts = ["esp32_c3_mini", "pump_5v", "led_5mm", "button_6mm", "soil_moisture_cap"].map((id, i) => ({ instanceId: `${id}_${i + 1}`, part: CODE_LIBRARY.getPart(id)! }));
      let seed = 7;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const kinds = ["lathe_profile", "rounded_extrude", "loft_rounded", "stake", "prongs", "tube_sweep", "nozzle", "ring", "tank", "button_cap", "knob", "grille_disc", "foot", "clip_arm", "hook", "hinge_lid", "enclosure"];
      for (let i = 0; i < 12; i++) {
        const ids = Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, j) => `b${j}`);
        const raw = {
          archetype: "desk_object",
          electronicsHost: "b0",
          bodies: ids.map((id, j) => ({
            id,
            role: pick(["housing", "lid", "base", "stake", "cover", "light_ring", "nozzle"]),
            form: { kind: pick(kinds), w: rnd() * 160, d: rnd() * 160, h: rnd() * 120, t: rnd() * 10, length: rnd() * 160, template: pick(["puck", "dome_base", "soft_wedge", "pill", "lantern", "stake_pod"]) },
            attach: { to: j === 0 ? "ground" : pick(ids.slice(0, j)), anchor: pick(["top", "front", "back", "left", "right", "bottom"]) },
            shell: pick(["auto", "solid", "open_top", "open_bottom", "split"]),
          })),
        };
        const built = buildProductMeshes(mf, solveProduct(raw, i % 2 ? parts : [], { spec }));
        for (const p of built.pieces) {
          expect(p.watertight, `fuzz ${i} ${p.id}`).toBe(true);
          expect(meshIsWatertight(p).ok, `fuzz ${i} ${p.id}`).toBe(true);
        }
      }
    },
    HEAVY,
  );

  it("writes binary STL (84 + 50 bytes per triangle)", () => {
    const g = GOLDEN_IDEAS[0];
    const parts = goldenParts(g);
    const built = buildProductMeshes(mf, solveProduct(defaultProductFor(g.spec, parts), parts, { spec: g.spec }));
    const p = built.pieces[0];
    expect(pieceSTL(p).byteLength).toBe(84 + 50 * p.triangles);
    const tri = binarySTL({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) });
    expect(new DataView(tri).getUint32(80, true)).toBe(1);
    expect(new DataView(tri).getFloat32(84 + 8, true)).toBeCloseTo(1); // facet normal +z
  }, HEAVY);

  it("the watertight check catches an open mesh", () => {
    const open = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2]) };
    expect(meshIsWatertight(open).ok).toBe(false);
    const closed = { ...open, indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) };
    expect(meshIsWatertight(closed).ok).toBe(true);
  });
});

describe("worker job (cache by solvedHash, metadata-only replies)", () => {
  it(
    "builds once per hash and can reply without any geometry",
    async () => {
      const g = GOLDEN_IDEAS[1];
      const parts = goldenParts(g);
      const s = solveProduct(defaultProductFor(g.spec, parts), parts, { spec: g.spec });
      const a = buildProduct(s);
      expect(buildProduct(s)).toBe(a);
      expect(getBuiltProduct(s.hash)).toBe(a);
      const meta = packProduct(await a, false);
      expect(meta.geometry).toBe(false);
      for (const p of meta.pieces) expect("positions" in p).toBe(false);
      const { reply, transfer } = await handleProductRequest({ id: 7, kind: "product", key: "k", input: { solved: s, geometry: true } });
      expect(reply.ok).toBe(true);
      if (!reply.ok || reply.kind !== "product") return;
      expect(reply.result.pieces[0].positions).toBeInstanceOf(Float32Array);
      expect(transfer.length).toBeGreaterThan(0);
      // The cached build keeps its own arrays (the reply sent copies).
      expect((await a).pieces[0].positions).not.toBe(reply.result.pieces[0].positions);
    },
    HEAVY,
  );
});
