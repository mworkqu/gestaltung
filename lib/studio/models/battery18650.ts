// 18650 cell (blue wrap, silver ends) sitting in a black single-cell holder
// with a spring at one end and a flat contact at the other. Cell axis = X.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, cylX, rbox } from "./shapes";
import { finish } from "./shapes";

export const battery18650: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const holder = BLACK();
  const base = 1.6;
  const wall = 1.6;

  // Cell: radius so its top touches dz, a little off the holder floor.
  const r = Math.min(9.3, (dy - 2 * wall) / 2);
  const zc = dz - r;
  const cellLen = Math.min(65, dx - 9);

  g.add(rbox("holder_base", dx, dy, base, 1.2, 0, 0, 0, holder, 2));
  // Side walls up to the cell's centre line, end walls slightly lower.
  for (const s of [-1, 1]) {
    g.add(box(`holder_side_${s < 0 ? "a" : "b"}`, dx, wall, zc, 0, s * (dy / 2 - wall / 2), 0, holder));
  }
  for (const s of [-1, 1]) {
    g.add(box(`holder_end_${s < 0 ? "spring" : "contact"}`, wall + 1.2, dy, zc + 2, s * (dx / 2 - (wall + 1.2) / 2), 0, 0, holder));
  }

  // The cell.
  const xCell = 0.5;
  g.add(cylX("cell_wrap", r, cellLen - 1.6, xCell, 0, zc, mat("battery_wrap"), 28));
  g.add(cylX("cell_cap_positive", r * 0.55, cellLen, xCell + 0.4, 0, zc, METAL(), 20));
  g.add(cylX("cell_cap_negative", r - 0.1, cellLen, xCell - 0.4, 0, zc, METAL(), 24));
  // Re-cover the middle with the wrap so only the ends read as metal.
  g.add(cylX("cell_wrap_band", r + 0.05, cellLen - 3.2, xCell, 0, zc, mat("battery_wrap"), 28));
  g.add(cylX("cell_stripe", r + 0.07, 6, xCell, 0, zc, mat("#e8eefb", { roughness: 0.5 }), 28));

  // Spring (at -x) as a few thin rings, flat contact plate (at +x).
  const xSpring = -dx / 2 + wall + 1.2;
  for (let i = 0; i < 5; i++) {
    g.add(cylX(`spring_coil_${i + 1}`, 3.4, 0.5, xSpring + 0.4 + i * 0.9, 0, zc, METAL(), 12));
  }
  g.add(box("contact_plate", 0.6, 9, 9, dx / 2 - wall - 1.2 - 0.3, 0, zc - 4.5, METAL()));
  // Solder tags poking out of the base at both ends (stay inside the bbox).
  g.add(box("lead_tag_negative", 4, 3, 0.4, -dx / 2 + 3, 0, base, METAL()));
  g.add(box("lead_tag_positive", 4, 3, 0.4, dx / 2 - 3, 0, base, METAL()));
  return finish(g, part.id);
};
