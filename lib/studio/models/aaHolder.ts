// 2 x AA battery holder: black tray with a centre divider, two cells lying side
// by side (series: one plus end each way), springs at one end, flat contacts at the other. Cell axis = X.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, cylX, rbox, finish } from "./shapes";

export const aaHolder: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy } = part.dims;
  const g = new THREE.Group();
  const holder = BLACK();
  const base = 1;
  const wall = 1.2;
  const endW = 2.2;
  const r = 7.25; // AA is 14.5 mm across
  const zc = base + r;
  const cellLen = dx - 2 * endW - 5;
  const yc = r + 0.35;

  g.add(rbox("holder_base", dx, dy, base, 1, 0, 0, 0, holder, 2));
  for (const s of [-1, 1]) {
    g.add(box(`holder_side_${s < 0 ? "a" : "b"}`, dx, wall, zc - base, 0, s * (dy / 2 - wall / 2), base, holder));
    g.add(box(`holder_end_${s < 0 ? "spring" : "contact"}`, endW, dy, zc + 2 - base, s * (dx / 2 - endW / 2), 0, base, holder));
  }
  g.add(box("holder_divider", dx - 2 * endW, 1, zc - 1 - base, 0, 0, base, holder));

  const wrap = mat("#262b33", { roughness: 0.4, metalness: 0.15 });
  const copper = mat("#b87333", { roughness: 0.35, metalness: 0.7 });
  for (const [i, s] of [-1, 1].entries()) {
    const flip = s; // second cell turned round
    g.add(cylX(`cell_${i + 1}_wrap`, r, cellLen - 1.2, 0, s * yc, zc, wrap, 24));
    g.add(cylX(`cell_${i + 1}_band`, r + 0.05, 7, -flip * 6, s * yc, zc, copper, 24));
    g.add(cylX(`cell_${i + 1}_nub_positive`, 2.6, cellLen, flip * 0.5, s * yc, zc, METAL(), 14));
    g.add(cylX(`cell_${i + 1}_cap_negative`, r - 0.6, cellLen - 0.2, -flip * 0.5, s * yc, zc, METAL(), 20));
    g.add(cylX(`cell_${i + 1}_wrap_cover`, r + 0.03, cellLen - 3.4, 0, s * yc, zc, wrap, 24));
  }
  // Springs (-x) and flat contacts (+x) at the two ends.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      g.add(cylX(`spring_${s < 0 ? "a" : "b"}_${k + 1}`, 3, 0.45, -dx / 2 + endW + 0.5 + k * 0.7, s * yc, zc, METAL(), 10));
    }
    g.add(box(`contact_plate_${s < 0 ? "a" : "b"}`, 0.5, 7, 7, dx / 2 - endW - 0.3, s * yc, zc - 3.5, METAL()));
  }
  g.add(box("lead_tag_negative", 4, 3, 0.4, -dx / 2 + 3.2, 0, base, METAL()));
  g.add(box("lead_tag_positive", 4, 3, 0.4, dx / 2 - 3.2, 0, base, METAL()));
  return finish(g, part.id);
};
