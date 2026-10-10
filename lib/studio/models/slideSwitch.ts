// SS12D-style slide switch lying on its side: metal-clad body, three legs
// down (-z), and the black slider handle sticking out of the +y face.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, rbox, finish } from "./shapes";

export const slideSwitch: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const legH = 3;
  const handleOut = 3.2;
  const bodyD = dy - handleOut;
  const bodyH = dz - legH;
  const yb = -dy / 2 + bodyD / 2; // body centre (handle sticks out beyond +y)

  g.add(rbox("body", dx, bodyD, bodyH, 0.5, 0, yb, legH, BLACK(), 2));
  g.add(box("metal_cover", dx - 0.4, bodyD - 0.4, 0.3, 0, yb, dz - 0.3, METAL()));
  g.add(box("slot", 5.4, 0.1, 1.2, 0, yb + bodyD / 2 + 0.04, legH + bodyH / 2 - 0.6, mat("#050506")));
  g.add(box("handle_stem", 2.6, handleOut + 0.6, 2.2, -1.2, dy / 2 - handleOut / 2 - 0.3, legH + bodyH / 2 - 1.1, mat("#d9d9d9", { roughness: 0.45 })));
  g.add(box("handle_grip", 3.2, 1.4, 3.2, -1.2, dy / 2 - 0.7, legH + bodyH / 2 - 1.6, BLACK()));
  for (let i = 0; i < 3; i++) {
    g.add(box(`leg_${i + 1}`, 0.5, 1.6, legH + 0.2, (i - 1) * 2.5, yb, 0, METAL()));
  }
  return finish(g, part.id);
};
