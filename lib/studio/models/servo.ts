// SG90-style micro servo: blue body, two mounting ears, geared top with a
// splined shaft and a single white horn, three wires leaving the -x end.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { box, cylX, cylZ, rbox, finish } from "./shapes";

export const servo: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const bodyL = 22.8;
  const bodyH = 22.7;
  const blue = mat("#2c78d6", { roughness: 0.45 });
  const shaftX = 6;

  g.add(rbox("body", bodyL, dy, bodyH, 1.2, 0, 0, 0, blue, 2));
  // Mounting ears (a flat plate through the body at ~70 % height).
  g.add(rbox("mounting_ears", dx, dy, 2.5, 0.6, 0, 0, 15.4, blue, 2));
  for (const s of [-1, 1]) {
    g.add(cylZ(`ear_hole_${s < 0 ? "a" : "b"}`, 1.1, 1.1, 0.05, s * (dx / 2 - 2.4), 0, 17.9, mat("#101114"), 10));
  }
  g.add(box("label", bodyL - 8, 0.1, 9, -2, dy / 2, 6, mat("#e6ecf5", { roughness: 0.6 })));
  // Gear housing, shaft and horn.
  g.add(cylZ("gear_housing", dy / 2 - 0.2, dy / 2 - 0.2, 4, shaftX, 0, bodyH, blue, 24));
  g.add(cylZ("shaft", 2.4, 2.4, 3.1, shaftX, 0, bodyH + 4, METAL(), 14));
  g.add(cylZ("horn_hub", 4, 4, 2.7, shaftX, 0, dz - 2.7, mat("plastic_white", { roughness: 0.45 }), 18));
  g.add(box("horn_arm", 17, 4.4, 1.6, shaftX - 4, 0, dz - 1.6, mat("plastic_white", { roughness: 0.45 })));
  g.add(cylZ("horn_screw", 1, 1, 0.1, shaftX, 0, dz - 0.05, METAL(), 8));
  // Wires (brown, red, orange) out of the -x end.
  const wires = ["#6e3b1c", "#c0392b", "#e8832a"];
  wires.forEach((c, i) => {
    g.add(cylX(`wire_${i + 1}`, 0.6, 5.2, -bodyL / 2 - 1.8, (i - 1) * 1.6, 5, mat(c, { roughness: 0.6 }), 8));
  });
  return finish(g, part.id);
};
