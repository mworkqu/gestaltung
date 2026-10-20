// Black DIP IC: body with a pin-1 notch and dot, two rows of legs (params.pins, default 14).
// Legs run 2.54 mm pitch, 7.62 mm row spacing. params.label is a hint only, no text is drawn.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish, num } from "./shapes";

export const dipChip: ModelBuilder = ({ part, params }) => {
  const { x: dx, z: dz } = part.dims;
  const g = new THREE.Group();
  const n = Math.max(4, Math.round(num(params.pins, 14) / 2) * 2);
  const perRow = n / 2;
  const legH = 3.2;
  const bodyD = 6.35;
  const bodyW = dx - 0.6;

  g.add(rbox("body", bodyW, bodyD, dz - legH, 0.3, 0, 0, legH, BLACK(), 2));
  g.add(box("notch", 0.1, 2.2, 0.3, -bodyW / 2 + 0.05, 0, dz - 0.3, mat("#050506")));
  g.add(cylZ("pin1_dot", 0.45, 0.1, dz - 0.05, -bodyW / 2 + 1.6, -bodyD / 2 + 1.4, 0, mat("#6b6f78"), 10));

  const rowY = 3.81; // 7.62 / 2
  for (let i = 0; i < perRow; i++) {
    const x = (i - (perRow - 1) / 2) * 2.54;
    for (const s of [-1, 1]) {
      const id = s < 0 ? i + 1 : n - i;
      g.add(box(`leg_${id}_shoulder`, 0.5, 1.2, 0.5, x, s * (bodyD / 2 + 0.2), legH - 0.5, METAL()));
      g.add(box(`leg_${id}`, 0.5, 0.5, legH, x, s * rowY, 0, METAL()));
    }
  }
  return finish(g, part.id);
};
