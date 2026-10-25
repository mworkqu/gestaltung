import * as THREE from "three";
import { computeMeshVolume } from "three-bvh-csg";
import { describe, expect, it } from "vitest";
import { layoutComponents } from "../layout";
import { buildEnclosure } from "../geometry/job";
import { cutoutsFor } from "./cutouts";
import { enclosureDims } from "./templates";
import { exportObjectsSTL, exportSTL, exportSVG } from "../export";
import { getCadBackend } from "../cad-adapter";
import { ALL_TEMPLATES, P, items, spec, typical } from "./test-fixtures";

const TEMPLATES = ALL_TEMPLATES;

function setup(list = typical()) {
  const lr = layoutComponents(list, { clearance: 2 });
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  return { lr, parts, list };
}

const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;

describe("the template case (built by the kernel)", () => {
  for (const template of TEMPLATES) {
    it(`builds base + lid matching dims: ${template}`, async () => {
      const { lr, parts } = setup();
      const s = spec({ template, vents: { pattern: "slots", face: "+x", count: 8 }, feet: "rubber_4" });
      const { base, lid, meta } = await buildEnclosure(s, lr, parts);
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
      // Rubber feet as child meshes — a wall plate hangs on the wall, so none; a stake pod has only its spike.
      expect(base.children.length).toBe(template === "wall_plate" ? 0 : template === "stake_pod" ? 1 : 4);
      expect(meta.triangles).toBeLessThan(60000);
      const nor = base.geometry.getAttribute("normal");
      expect(nor).toBeTruthy();
      expect(Math.hypot(nor.getX(0), nor.getY(0), nor.getZ(0))).toBeCloseTo(1, 3);
    });
  }

  it("is fast enough for a typical box", async () => {
    const { lr, parts } = setup();
    await buildEnclosure(spec(), lr, parts); // warm-up
    // This process's CPU time (each test file runs in its own process), so parallel suites don't skew it.
    const c0 = process.cpuUsage();
    const { meta } = await buildEnclosure(spec({ vents: { pattern: "holes", face: "-z", count: 12 }, feet: "ring" }), lr, parts);
    const c = process.cpuUsage(c0);
    const ms = (c.user + c.system) / 1000;
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

  it("stake_pod: a socket in the floor and a printable spike", async () => {
    const { lr, parts } = setup();
    const { base, meta } = await buildEnclosure(spec({ template: "stake_pod", feet: "rubber_4" }), lr, parts);
    const d = meta.dims;
    expect(d.stake).toBeTruthy();
    const k = d.stake!;
    expect(d.floorZ).toBeCloseTo(d.wall + k.socket.depth, 6);
    expect(d.contentOffset[2]).toBe(d.floorZ);
    // The socket is wider than the spike by the fit clearance on every side.
    expect(k.socket.arm - k.arm).toBeCloseTo(0.3, 6);
    expect(k.socket.thick - k.thick).toBeCloseTo(0.6, 6);
    expect(k.peg).toBeLessThan(k.socket.depth);
    // A ray going up the middle meets the socket roof, not the pod's bottom face.
    base.material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
    base.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObject(base, false)[0];
    expect(hit.point.z).toBeCloseTo(k.socket.depth, 3);
    // The spike: its own child mesh (no rubber feet), peg up to `peg`, tip `length` below the pod.
    const spike = base.children.find((c) => c.name === "enclosure_spike") as THREE.Mesh;
    expect(spike).toBeTruthy();
    expect(base.children.some((c) => c.name.startsWith("enclosure_foot"))).toBe(false);
    spike.geometry.computeBoundingBox();
    const sb = spike.geometry.boundingBox!;
    expect(sb.max.z).toBeCloseTo(k.peg, 3);
    expect(sb.min.z).toBeCloseTo(-k.length, 3);
    expect(sb.max.x).toBeCloseTo(k.arm, 3);
    expect(computeMeshVolume(spike)).toBeGreaterThan(0);
    // Printed peg end down it only ever narrows upwards: every face either points sideways
    // with an upward-facing (or vertical) slope, or is a flat cap — no downward overhang.
    const nor = spike.geometry.getAttribute("normal");
    for (let i = 0; i < nor.count; i++) {
      // Flipped for printing, a face normal n becomes -n; an overhang would have -n.z < -0.75 (steeper than ~41°).
      const nz = -nor.getZ(i);
      const isCap = Math.abs(nz) > 0.999;
      if (!isCap) expect(nz).toBeGreaterThan(-0.75);
    }
    // The spike reaches well into the soil and the pod obeys the height rule.
    expect(k.length).toBeGreaterThanOrEqual(60);
    expect(d.W).toBe(d.D);
    expect(d.shape).toBe("circle");
  });

  it("handheld_taper: grip-friendly fillets that keep the wall", () => {
    const { lr } = setup();
    const d = enclosureDims(spec({ template: "handheld_taper", edgeFillet: 1 }), lr);
    // Rounder than any other template's edge (others stop at 0.9 × wall) …
    expect(d.edgeFillet).toBeGreaterThan(0.9 * d.wall);
    // … but the plastic left where the fillet meets the cavity edge stays ≥ 1.2 mm.
    const left = d.edgeFillet - Math.SQRT2 * Math.max(0, d.edgeFillet - d.wall);
    expect(left).toBeGreaterThanOrEqual(1.2 - 1e-6);
    // Round corners in plan too.
    expect(d.cornerRadius).toBeGreaterThanOrEqual(0.3 * Math.min(d.W, d.D) - 0.01);
    const box = enclosureDims(spec({ template: "rounded_box", edgeFillet: 1 }), lr);
    expect(d.edgeFillet).toBeGreaterThan(box.edgeFillet);
  });

  it("handles a tiny part and a very tall part", async () => {
    for (const list of [items(["t1", P.tiny]), items(["t1", P.tall])]) {
      const { lr, parts } = setup(list);
      const { base, lid } = await buildEnclosure(spec({ template: "pill" }), lr, parts);
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
    const mech = await be.buildMechPart({ id: "s", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1 } });
    expect(mech.name).toBe("s");
  });
});

describe("export", () => {
  it("writes binary and ASCII STL and SVG blobs", async () => {
    const { lr, parts } = setup();
    const { base, lid } = await buildEnclosure(spec({ feet: "rubber_4" }), lr, parts);
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
