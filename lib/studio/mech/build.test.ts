import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { layoutComponents, rotateXY } from "../layout";
import { getPart } from "../library";
import { MECH_TEMPLATES, clampMechParts, type LibraryPart, type MechPart, type StudioComponent } from "../schema";
import { buildEnclosure } from "../enclosure/build";
import { pointInCavity } from "../enclosure/templates";
import { spec } from "../enclosure/test-fixtures";
import { defaultMechParts, mechSummary } from "../ai/mech-default";
import { explodeOffset } from "../explode";
import { exportSTL } from "../export";
import { getCadBackend } from "../cad-adapter";
import { buildMechParts, defaultMaterial } from "./build";
import { dimsFromLayout, placeMechParts } from "./place";

const lib = (id: string) => {
  const p = getPart(id);
  if (!p) throw new Error(`missing library part ${id}`);
  return p;
};

function scene(ids: [string, string][] = [["u1", "arduino_uno"], ["m1", "pir_hcsr501"], ["b1", "cell_18650"], ["k1", "button_6mm"], ["l1", "led_5mm"]]) {
  const list = ids.map(([instanceId, partId]) => ({ instanceId, part: lib(partId) }));
  const lr = layoutComponents(list, { clearance: 2 });
  const parts = new Map<string, LibraryPart>(list.map((i) => [i.instanceId, i.part]));
  const enc = buildEnclosure(spec(), lr, parts);
  const components: StudioComponent[] = ids.map(([instanceId, partId]) => ({ instanceId, partId }) as StudioComponent);
  const summary = mechSummary({
    components,
    layout: lr.layout,
    getPart: (id) => getPart(id),
    enclosure: { w: enc.meta.W, d: enc.meta.D, h: enc.meta.H },
  });
  const mech = defaultMechParts(summary);
  return { lr, parts, enc, mech };
}

const all = (): MechPart[] =>
  clampMechParts(
    MECH_TEMPLATES.map((template, i) => ({
      id: `${template}_${i}`,
      template,
      params: {},
      forInstance: { standoff: "u1", pcb_cradle: "u1", battery_clip: "b1", sensor_mount: "m1", button_extender: "k1", light_pipe: "l1" }[template as string],
      printable: { material: "PLA", estGrams: 1 },
    })),
  );

describe("placeMechParts", () => {
  it("puts a standoff exactly under every real mount hole, inside the cavity", () => {
    const { lr, parts, enc, mech } = scene();
    const d = enc.meta.dims;
    const placed = placeMechParts(mech, lr, parts, d);
    for (const instanceId of ["u1", "m1"]) {
      const item = lr.layout.find((l) => l.instanceId === instanceId)!;
      const part = parts.get(instanceId)!;
      const holes = part.mount!.holes;
      const mine = mech.map((m, i) => ({ m, p: placed[i] })).filter((x) => x.m.template === "standoff" && x.m.forInstance === instanceId);
      expect(mine.length).toBe(holes.length);
      holes.forEach((h, i) => {
        const [rx, ry] = rotateXY(h.x, h.y, item.rotZ);
        const want = [item.pos[0] + rx + d.contentOffset[0], item.pos[1] + ry + d.contentOffset[1]];
        const got = mine[i].p.position;
        expect(got[0]).toBeCloseTo(want[0], 2);
        expect(got[1]).toBeCloseTo(want[1], 2);
        expect(got[2]).toBeCloseTo(d.floorZ, 6);
        expect(pointInCavity(d, got, 0)).toBe(true);
        // Top of the standoff never above the board underside when there is room.
        const under = item.pos[2] + d.contentOffset[2];
        if (under - d.floorZ >= 2) expect(got[2] + mine[i].p.params.height).toBeCloseTo(under, 3);
      });
    }
  });

  it("gives every part a non-zero, reversible explode vector", () => {
    const { lr, parts, enc } = scene();
    const placed = placeMechParts(all(), lr, parts, enc.meta.dims);
    for (const p of placed) {
      expect(Math.hypot(...p.explode)).toBeGreaterThan(1);
      const full = explodeOffset("extra", p.position, [0, 0, 0], enc.meta.H, 0, 1, p.explode);
      full.forEach((v, i) => expect(v).toBeCloseTo(p.explode[i], 6));
      expect(explodeOffset("extra", p.position, [0, 0, 0], enc.meta.H, 0, 0, p.explode)).toEqual([0, 0, 0]);
      const half = explodeOffset("extra", p.position, [0, 0, 0], enc.meta.H, 0, 0.5, p.explode);
      expect(Math.hypot(...half)).toBeLessThan(Math.hypot(...p.explode));
    }
    const by = (t: string) => placed[all().findIndex((m) => m.template === t)];
    expect(by("lid").explode[2]).toBeGreaterThan(0);
    expect(by("base").explode[2]).toBeLessThan(0);
    expect(by("button_extender").explode[2]).toBeGreaterThan(by("lid").explode[2]);
    expect(by("standoff").explode[2]).toBeLessThan(0);
    expect(by("wall_bracket").explode[1]).toBeLessThan(0);
    expect(by("wall_bracket").position[1]).toBeLessThan(-enc.meta.D / 2);
  });

  it("puts button extender / light pipe on top of their part and the cable clip in the cavity", () => {
    const { lr, parts, enc } = scene();
    const d = enc.meta.dims;
    const mech = all();
    const placed = placeMechParts(mech, lr, parts, d);
    for (const [t, inst] of [["button_extender", "k1"], ["light_pipe", "l1"]] as const) {
      const p = placed[mech.findIndex((m) => m.template === t)];
      const item = lr.layout.find((l) => l.instanceId === inst)!;
      expect(p.position[2]).toBeCloseTo(item.pos[2] + parts.get(inst)!.dims.z + d.contentOffset[2], 3);
    }
    const clip = placed[mech.findIndex((m) => m.template === "cable_clip")];
    expect(pointInCavity(d, clip.position)).toBe(true);
  });

  it("is deterministic and works without an enclosure", () => {
    const { lr, parts, mech } = scene();
    const d = dimsFromLayout(lr);
    expect(placeMechParts(mech, lr, parts, d)).toEqual(placeMechParts(mech, lr, parts, d));
    expect(placeMechParts(all(), lr, new Map(), d).every((p) => p.position.every(Number.isFinite))).toBe(true);
  });
});

describe("buildMechParts", () => {
  it("builds every template with real grams, names and STL", () => {
    const { lr, parts, enc } = scene();
    const built = buildMechParts(all(), lr, parts, { base: enc.base, lid: enc.lid, dims: enc.meta.dims });
    expect(built.length).toBe(MECH_TEMPLATES.length);
    for (const b of built) {
      expect(b.object.name).toBe(b.id);
      expect(b.name.en.length).toBeGreaterThan(2);
      expect(b.name.ar.length).toBeGreaterThan(2);
      expect(b.volumeMm3).toBeGreaterThan(0);
      expect(b.printable.estGrams).toBeGreaterThan(0);
      const stl = exportSTL(b.object) as ArrayBuffer;
      expect(stl.byteLength).toBeGreaterThan(84 + 50 * 10);
    }
    const g = (t: string) => built.find((b) => b.template === t)!;
    expect(g("standoff").printable.estGrams).toBeGreaterThanOrEqual(0.3);
    expect(g("standoff").printable.estGrams).toBeLessThanOrEqual(3);
    expect(g("lid").printable.estGrams).toBeGreaterThanOrEqual(5);
    expect(g("lid").printable.estGrams).toBeLessThanOrEqual(80);
    // lid/base are the enclosure's own meshes, without the rubber feet.
    expect((g("lid").object as THREE.Mesh).geometry).toBe(enc.lid.geometry);
    expect((g("base").object as THREE.Mesh).geometry).toBe(enc.base.geometry);
    expect(g("base").object.children.length).toBe(0);
  });

  it("falls back to template lid/base without an enclosure", () => {
    const { lr, parts } = scene();
    const built = buildMechParts(all(), lr, parts);
    const lid = built.find((b) => b.template === "lid")!;
    expect(lid.volumeMm3).toBeGreaterThan(0);
    expect(lid.object.position.z).toBeGreaterThan(0);
  });

  it("picks materials", () => {
    expect(defaultMaterial("light_pipe", "PLA")).toBe("PETG");
    expect(defaultMaterial("button_extender", "PLA")).toBe("TPU");
    expect(defaultMaterial("cable_clip", undefined)).toBe("TPU");
    expect(defaultMaterial("standoff", "PLA", "outdoor")).toBe("PETG");
    expect(defaultMaterial("standoff", "PLA", "indoor")).toBe("PLA");
    expect(defaultMaterial("standoff", "TPU", "outdoor")).toBe("TPU");
    const { lr, parts } = scene();
    const built = buildMechParts(all(), lr, parts, undefined, { environment: "outdoor" });
    expect(built.find((b) => b.template === "base")!.printable.material).toBe("PETG");
  });

  it("default mech list for real parts builds end to end", () => {
    const { lr, parts, enc, mech } = scene();
    expect(mech.some((m) => m.template === "battery_clip")).toBe(true);
    const built = buildMechParts(mech, lr, parts, { base: enc.base, lid: enc.lid, dims: enc.meta.dims });
    expect(built.length).toBe(mech.length);
    expect(built.every((b) => b.object.position.toArray().every(Number.isFinite))).toBe(true);
  });

  it("BrowserCadBackend.buildMechPart builds via templates", async () => {
    const obj = await getCadBackend().buildMechPart(all()[1]);
    expect(obj.name).toBe(all()[1].id);
    expect((obj as THREE.Mesh).geometry.getAttribute("position").count).toBeGreaterThan(30);
  });
});
