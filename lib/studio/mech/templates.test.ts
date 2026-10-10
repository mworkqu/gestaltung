import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MECH_PARAMS, MECH_TEMPLATES, type MechTemplate } from "../schema";
import { exportSTL } from "../export";
import { MECH_BUILDERS, buildMechGeometry, buildMechGeometryLoose, clampParams, signedVolume, triangleCount } from "./templates";

const pick = (t: MechTemplate, which: 0 | 1 | 2) =>
  Object.fromEntries(Object.entries(MECH_PARAMS[t]).map(([k, r]) => [k, r[which]]));

const finite = (g: THREE.BufferGeometry) => {
  const a = g.getAttribute("position").array as Float32Array;
  const n = g.getAttribute("normal")?.array as Float32Array | undefined;
  return a.every(Number.isFinite) && (!n || n.every(Number.isFinite));
};

/** Edges used an odd number of times (0 for a closed, watertight mesh). */
function openEdges(g: THREE.BufferGeometry): number {
  const p = g.getAttribute("position");
  const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(3)).join(",");
  const edges = new Map<string, number>();
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(i + k);
      const c = key(i + ((k + 1) % 3));
      if (a === c) continue;
      const e = a < c ? `${a}|${c}` : `${c}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const v of edges.values()) if (v % 2) open++;
  return open;
}

describe("mech templates", () => {
  for (const t of MECH_TEMPLATES) {
    for (const [label, which] of [["min", 0], ["max", 1], ["default", 2]] as const) {
      it(`${t} builds a closed finite solid (${label})`, () => {
        const g = MECH_BUILDERS[t](pick(t, which));
        const tris = triangleCount(g);
        expect(tris).toBeGreaterThan(10);
        expect(tris).toBeLessThan(8000);
        expect(finite(g)).toBe(true);
        expect(signedVolume(g)).toBeGreaterThan(0);
        expect(openEdges(g)).toBe(0);
        g.computeBoundingBox();
        const b = g.boundingBox!;
        expect(b.min.z).toBeGreaterThanOrEqual(-1e-3);
        expect(b.max.z).toBeGreaterThan(0.5);
      });
    }

    it(`${t} is deterministic`, () => {
      const a = buildMechGeometry({ template: t, params: pick(t, 2) });
      const b = buildMechGeometry({ template: t, params: pick(t, 2) });
      expect(Array.from(a.getAttribute("position").array)).toEqual(Array.from(b.getAttribute("position").array));
    });

    it(`${t} never produces NaN from junk params`, () => {
      for (const junk of [{}, { x: 1 }, Object.fromEntries(Object.keys(MECH_PARAMS[t]).map((k) => [k, NaN])),
        Object.fromEntries(Object.keys(MECH_PARAMS[t]).map((k) => [k, -1e9])),
        Object.fromEntries(Object.keys(MECH_PARAMS[t]).map((k) => [k, 1e9]))]) {
        const g = buildMechGeometryLoose({ template: t, params: junk });
        expect(g).not.toBeNull();
        expect(finite(g!)).toBe(true);
        expect(signedVolume(g!)).toBeGreaterThan(0);
      }
    });

    it(`${t} exports a non-empty STL`, () => {
      const mesh = new THREE.Mesh(buildMechGeometry({ template: t, params: {} }));
      const stl = exportSTL(mesh) as ArrayBuffer;
      expect(stl.byteLength).toBeGreaterThan(84 + 50 * 10);
    });
  }

  it("standoff keeps its size and bore", () => {
    const g = buildMechGeometry({ template: "standoff", params: { height: 6, outerD: 6, holeD: 2.5 } });
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.z - b.min.z).toBeCloseTo(6, 3);
    expect(b.max.x - b.min.x).toBeCloseTo(6, 1);
    const tube = Math.PI * (9 - 1.5625) * 6;
    expect(signedVolume(g)).toBeGreaterThan(tube * 0.85);
    expect(signedVolume(g)).toBeLessThan(tube * 1.01);
  });

  it("clampParams fills defaults and clamps", () => {
    expect(clampParams("standoff", { height: 999, holeD: "x" })).toEqual({ height: 25, outerD: 6, holeD: 2.5 });
  });

  it("unknown template → null", () => {
    expect(buildMechGeometryLoose({ template: "rocket" })).toBeNull();
  });
});
