// 6 mm tactile switch: black square body, steel top plate, round cap, 4 legs.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish, str } from "./shapes";

export const pushButton: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const legH = 3;
  const capH = 1.5;
  const plate = 0.2;
  const bodyH = dz - legH - capH - plate;

  g.add(rbox("body", dx, dy, bodyH, 0.4, 0, 0, legH, BLACK(), 2));
  g.add(box("top_plate", dx - 0.6, dy - 0.6, plate, 0, 0, legH + bodyH, METAL()));
  g.add(cylZ("cap", 1.75, 1.75, capH, 0, 0, legH + bodyH + plate, mat(str(params.cap, "#3a3d44"), { roughness: 0.5 }), 20));

  const metal = METAL();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.add(box(`leg_${sx < 0 ? "l" : "r"}${sy < 0 ? "f" : "b"}`, 0.6, 1, legH, sx * (dx / 2 - 0.5), sy * (dy / 2 - 1.3), 0, metal));
    }
  }
  return finish(g, part.id);
};
