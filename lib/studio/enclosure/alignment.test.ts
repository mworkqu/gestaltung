// Every opening must sit over the part it was cut for, in the frame the viewer
// draws the part in. For each port: (a) the cut-out centre from cutoutsFor,
// (b) the same port carried through the viewer's transform (lib/studio/placement.ts
// on a three.js group, exactly like ComponentMesh), and (c) for a display, the
// screen mesh of the real built model — all agree within 1.5 mm, for every rotZ
// and every template. A screen must also sit right under its window (not deep
// inside the case, where it shows through a neighbour's opening instead).

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getPart } from "../library";
import { layoutComponents, worldBox, type RotZ, type Vec3 } from "../layout";
import { buildPartModel } from "../models";
import { contentOffsetOf, placePart } from "../placement";
import type { EnclosureTemplate, LayoutItem, LibraryPart } from "../schema";
import { planEnclosure } from "./build";
import { portLocal, type Cutout } from "./cutouts";
import { topAt } from "./templates";
import { items, spec } from "./test-fixtures";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper"];
const ROTS: RotZ[] = [0, 90, 180, 270];
const TOL = 1.5;
/** A screen's glass may sit at most this far under the lid's inner surface. */
const SCREEN_DEPTH_MAX = 2.5;
const SCREEN_MESH = /active_area|screen|lcd_window/;

function product() {
  return items(
    ["esp", getPart("esp32_devkit")!],
    ["pir", getPart("pir_hcsr501")!],
    ["oled", getPart("oled_096_i2c")!],
    ["btn", getPart("button_6mm")!],
    ["led", getPart("led_5mm")!],
    ["res", getPart("resistor_220")!],
  );
}

/** The viewer's outer group for a placed part (ComponentMesh: position + rotation.z). */
function viewerGroup(item: LayoutItem, offset: Vec3): THREE.Group {
  const p = placePart(item, offset);
  const g = new THREE.Group();
  g.position.set(...p.position);
  g.rotation.set(0, 0, p.rotationZ);
  g.updateMatrixWorld(true);
  return g;
}

/** Centre + top of the screen mesh of the real model, carried through the viewer group. */
function screenInContent(part: LibraryPart, group: THREE.Group): { centre: THREE.Vector3; top: number } | null {
  const model = buildPartModel(part);
  group.add(model);
  group.updateMatrixWorld(true);
  let found: THREE.Object3D | null = null;
  model.traverse((o) => {
    if (!found && SCREEN_MESH.test(o.name)) found = o;
  });
  if (!found) return null;
  const box = new THREE.Box3().setFromObject(found);
  return { centre: box.getCenter(new THREE.Vector3()), top: box.max.z };
}

function check(template: EnclosureTemplate, rot: RotZ | null) {
  const list = product();
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));
  const lr = layoutComponents(list, { clearance: 2, sizeHint: "palm" });
  if (rot !== null) lr.layout = lr.layout.map((l) => ({ ...l, rotZ: rot }));
  const plan = planEnclosure(spec({ template }), lr, parts);
  const offset = contentOffsetOf(plan.dims);
  const byId = new Map<string, Cutout>(plan.cutouts.map((c) => [c.id, c]));
  let checked = 0;
  for (const item of plan.placed) {
    const part = parts.get(item.instanceId)!;
    const group = viewerGroup(item, offset);
    part.ports.forEach((port, idx) => {
      const cut = byId.get(`${item.instanceId}:${idx}`);
      expect(cut, `${item.instanceId}:${idx} has a cut-out`).toBeTruthy();
      const p = new THREE.Vector3(...portLocal(part, port.face, port.at.u, port.at.v)).applyMatrix4(group.matrixWorld);
      const d = p.clone().sub(new THREE.Vector3(...cut!.center));
      // Ignore the offset along the prism axis (the cut runs through the wall); compare in-plane.
      const n = new THREE.Vector3(...cut!.normal);
      const inPlane = d.clone().sub(n.clone().multiplyScalar(d.dot(n)));
      const label = `${template} rot=${rot} ${item.instanceId}:${idx} ${port.kind}`;
      expect(inPlane.length(), `${label}: port vs cut-out`).toBeLessThan(TOL);
      checked++;

      if (port.kind === "display_window") {
        const screen = screenInContent(part, viewerGroup(item, offset));
        expect(screen, `${label}: model has a screen mesh`).toBeTruthy();
        const s = screen!;
        expect(Math.hypot(s.centre.x - cut!.center[0], s.centre.y - cut!.center[1]), `${label}: screen vs cut-out`).toBeLessThan(TOL);
        expect(Math.hypot(s.centre.x - p.x, s.centre.y - p.y), `${label}: screen vs port`).toBeLessThan(TOL);
        // Right under the window: below the lid's inner surface (its lowest point over the
        // board — a sloped lid), but not deep inside the case.
        const box = worldBox(item, part);
        const oy = offset[1];
        const lidInner = Math.min(topAt(plan.dims, box.min[1] + oy), topAt(plan.dims, box.max[1] + oy)) - plan.dims.wall;
        expect(s.top, `${label}: screen under the lid`).toBeLessThanOrEqual(lidInner + 1e-6);
        // A part stacked over it (only when a test forces a rotation onto a packed layout) caps it instead.
        const above = plan.placed
          .filter((o) => o !== item)
          .map((o) => worldBox(o, parts.get(o.instanceId)!))
          .filter((b) => b.min[0] < box.max[0] && box.min[0] < b.max[0] && b.min[1] < box.max[1] && box.min[1] < b.max[1] && b.min[2] >= box.max[2] - 1e-6)
          .map((b) => b.min[2] + offset[2]);
        if (rot === null) expect(above, `${label}: nothing stacked over a screen`).toEqual([]);
        const ceiling = Math.min(lidInner, ...above);
        expect(ceiling - s.top, `${label}: screen right under its window`).toBeLessThanOrEqual(SCREEN_DEPTH_MAX);
      }
    });
  }
  expect(checked).toBeGreaterThanOrEqual(5);
}

describe("cut-outs, viewer placement and part models agree", () => {
  for (const template of TEMPLATES) {
    it(`${template}: layout as packed`, () => check(template, null));
    for (const rot of ROTS) it(`${template}: every part at rotZ ${rot}`, () => check(template, rot));
  }

  it("the viewer stands parts on the case floor (contentOffset), not wall mm into it", () => {
    const list = product();
    const parts = new Map(list.map((i) => [i.instanceId, i.part]));
    const lr = layoutComponents(list, { clearance: 2 });
    const plan = planEnclosure(spec(), lr, parts);
    const esp = plan.placed.find((l) => l.instanceId === "esp")!;
    expect(esp.pos[2]).toBe(0);
    expect(placePart(esp, contentOffsetOf(plan.dims)).position[2]).toBe(plan.dims.floorZ);
  });
});
