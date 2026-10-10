import * as THREE from "three";
import { computeMeshVolume } from "three-bvh-csg";
import { describe, expect, it } from "vitest";
import { layoutComponents } from "../layout";
import type { EnclosureTemplate } from "../schema";
import { buildEnclosure } from "./build";
import { cutoutsFor } from "./cutouts";
import { enclosureDims } from "./templates";
import { exportObjectsSTL, exportSTL, exportSVG } from "../export";
import { getCadBackend } from "../cad-adapter";
import { P, items, spec, typical } from "./test-fixtures";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper", "wall_plate"];

function setup(list = typical()) {
  const lr = layoutComponents(list, { clearance: 2 });
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  return { lr, parts, list };
}

const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;

describe("buildEnclosure", () => {
  for (const template of TEMPLATES) {
    it(`builds base + lid matching dims: ${template}`, () => {
      const { lr, parts } = setup();
      const s = spec({ template, vents: { pattern: "slots", face: "+x", count: 8 }, feet: "rubber_4" });
      const { base, lid, meta } = buildEnclosure(s, lr, parts);
      expect(base.name).toBe("enclosure_base");
      expect(lid.name).toBe("enclosure_lid");
      expect(base).not.toBe(lid);
      expect(tris(base)).toBeGreaterThan(50);
      expect(tris(lid)).toBeGreaterThan(50);
      const box = new THREE.Box3()
        .union(base.geometry.boundingBox!)
        .union(lid.geometry.boundingBox!);
      expect(box.max.x - box.min.x).toBeCloseTo(meta.W, 0);
      expect(Math.abs(box.max.y - box.min.y - meta.D)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.max.z - meta.H)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.min.z)).toBeLessThanOrEqual(1);
      expect(base.geometry.boundingBox!.max.z).toBeLessThanOrEqual(meta.splitZ + 1e-3);
      expect(computeMeshVolume(base)).toBeGreaterThan(0);
      expect(computeMeshVolume(lid)).toBeGreaterThan(0);
      expect(base.children.length).toBe(4);
      expect(meta.triangles).toBeLessThan(60000);
      const nor = base.geometry.getAttribute("normal");
      expect(nor).toBeTruthy();
      expect(Math.hypot(nor.getX(0), nor.getY(0), nor.getZ(0))).toBeCloseTo(1, 3);
    });
  }

  it("is fast enough for a typical box", () => {
    const { lr, parts } = setup();
    buildEnclosure(spec(), lr, parts); // warm-up
    const t0 = performance.now();
    const { meta } = buildEnclosure(spec({ vents: { pattern: "holes", face: "-z", count: 12 }, feet: "ring" }), lr, parts);
    const ms = performance.now() - t0;
    console.info(`[enclosure] rounded_box: ${ms.toFixed(0)} ms, ${meta.triangles} triangles, ${meta.cutouts.length} cutouts, ${meta.vents.length} vents`);
    expect(ms).toBeLessThan(1500);
  });

  it("makes one cut-out per port of every placed part", () => {
    const { lr, parts, list } = setup();
    const placed = new Set(lr.layout.map((i) => i.instanceId));
    const expected = list.filter((i) => placed.has(i.instanceId)).reduce((n, i) => n + i.part.ports.length, 0);
    const d = enclosureDims(spec(), lr);
    const cuts = cutoutsFor(lr.layout, parts, d);
    expect(cuts.length).toBe(expected);
    const grille = cuts.find((c) => c.kind === "speaker_grille")!;
    expect(grille.holes!.length).toBeGreaterThan(4);
    const usb = cuts.find((c) => c.kind === "usb_c")!;
    expect(usb.face).toBe("-x");
    expect(usb.w).toBeCloseTo(9.6, 6);
    // Side-wall cut reaches past the outer wall; top cuts go through the lid.
    expect(usb.center[0] - usb.depth / 2).toBeLessThan(-d.W / 2);
    for (const c of cuts.filter((x) => x.face === "+z")) expect(c.center[2] + c.depth / 2).toBeGreaterThan(d.H);
  });

  it("handles a tiny part and a very tall part", () => {
    for (const list of [items(["t1", P.tiny]), items(["t1", P.tall])]) {
      const { lr, parts } = setup(list);
      const { base, lid } = buildEnclosure(spec({ template: "pill" }), lr, parts);
      expect(tris(base)).toBeGreaterThan(0);
      expect(tris(lid)).toBeGreaterThan(0);
    }
  });

  it("goes through the browser CAD backend", async () => {
    const { lr, parts } = setup();
    const be = getCadBackend("anything");
    expect(be.id).toBe("browser");
    const { base } = await be.buildEnclosure(spec(), lr, parts);
    expect(base.name).toBe("enclosure_base");
    await expect(be.buildMechPart({ id: "s", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1 } })).rejects.toThrow(/phase 2/);
  });
});

describe("export", () => {
  it("writes binary and ASCII STL and SVG blobs", () => {
    const { lr, parts } = setup();
    const { base, lid } = buildEnclosure(spec({ feet: "rubber_4" }), lr, parts);
    const bin = exportSTL(base) as ArrayBuffer;
    expect(bin.byteLength).toBeGreaterThan(84);
    const own = exportSTL(base, true, { children: false }) as ArrayBuffer;
    expect(own.byteLength).toBeLessThan(bin.byteLength);
    expect((exportSTL(lid, false) as string).startsWith("solid")).toBe(true);
    const files = exportObjectsSTL([base, lid]);
    expect(files.map((f) => f.name)).toEqual(["enclosure_base.stl", "enclosure_lid.stl"]);
    expect((files[0].data as ArrayBuffer).byteLength).toBe(own.byteLength);
    expect(exportSVG("<svg/>").type).toBe("image/svg+xml");
  });
});
