// N20 micro gear motor lying along X: silver can with solder lugs at -x, brass
// gearbox, bearing boss and a 3 mm D-shaft toward +x. Flat on z = 0.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { box, cylX, rbox, finish } from "./shapes";

export const n20Motor: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const lug = 1.5;
  const canL = 15;
  const gearL = 9;
  const boss = 1;
  const shaftL = dx - lug - canL - gearL - boss;
  const x0 = -dx / 2;
  const zc = dz / 2;

  const can = mat("#bfc5cd", { roughness: 0.3, metalness: 0.85 });
  g.add(rbox("can", canL, dy, dz, 3.5, x0 + lug + canL / 2, 0, 0, can, 3));
  g.add(box("can_end_cap", 0.4, dy - 3, dz - 3, x0 + lug + 0.2, 0, 1.5, mat("#26282d", { roughness: 0.6 })));
  // Solder lugs on the end cap.
  for (const s of [-1, 1]) {
    g.add(box(`lug_${s < 0 ? "a" : "b"}`, lug, 1.2, 3.2, x0 + lug / 2, s * 2.5, zc - 1.6, mat("#c49a4a", { roughness: 0.35, metalness: 0.8 }), ));
  }
  g.add(rbox("gearbox", gearL, dy, dz, 0.8, x0 + lug + canL + gearL / 2, 0, 0, mat("#c9a35b", { roughness: 0.4, metalness: 0.7 }), 2));
  g.add(cylX("bearing_boss", 2.4, boss + 0.4, x0 + lug + canL + gearL + boss / 2 - 0.2, 0, zc, METAL(), 14));
  g.add(cylX("shaft", 1.5, shaftL + 0.2, dx / 2 - shaftL / 2 - 0.1, 0, zc, METAL(), 12));
  g.add(box("shaft_flat", shaftL - 1, 2.4, 0.5, dx / 2 - shaftL / 2, 0, zc + 0.9, mat("#aeb4bd", { roughness: 0.3, metalness: 0.85 })));
  return finish(g, part.id);
};
