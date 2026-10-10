// Active piezo buzzer: black 12 mm can with a sound hole and a + mark, two legs.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, cylZ, finish } from "./shapes";

export const buzzer: ModelBuilder = ({ part }) => {
  const { x: dx, z: dz } = part.dims;
  const g = new THREE.Group();
  const r = dx / 2;
  const legH = 5.2;
  const bodyH = dz - legH;

  for (const s of [-1, 1]) {
    g.add(box(`leg_${s < 0 ? "negative" : "positive"}`, 0.5, 0.5, legH + 0.4, s * 3.8, 0, 0, METAL()));
  }
  g.add(cylZ("body", r, r, bodyH, 0, 0, legH, BLACK(), 28));
  g.add(cylZ("top_lip", r - 0.5, r - 0.5, 0.01, 0, 0, dz - 0.01, mat("#202226", { roughness: 0.35 }), 28));
  g.add(cylZ("sound_hole", 1.5, 1.5, 0.05, 0, 0, dz - 0.04, mat("#050506"), 14));
  // "+" mark beside the positive leg.
  g.add(box("plus_bar_h", 1.8, 0.4, 0.04, 3.4, 0, dz - 0.04, mat("#d8d8d8")));
  g.add(box("plus_bar_v", 0.4, 1.8, 0.04, 3.4, 0, dz - 0.04, mat("#d8d8d8")));
  return finish(g, part.id);
};
