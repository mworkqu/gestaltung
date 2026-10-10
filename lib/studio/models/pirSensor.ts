// HC-SR501 PIR: green board, white faceted fresnel dome, two trimmers, 3-pin header.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, BLACK } from "./materials";
import { box, rbox, cylZ, dome, finish } from "./shapes";

export const pirSensor: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = 1.2;
  g.add(rbox("pcb", dx, dy, t, 1, 0, 0, 0, mat(part.look.body), 2));

  // Dome sits on a short base ring; fewer segments on purpose so it reads faceted.
  const r = Math.min(11.5, dy / 2 - 0.4);
  const baseH = 4;
  const white = mat("plastic_white", { roughness: 0.35 });
  g.add(cylZ("dome_base", r, r, baseH, 0, 0, t, white, 24));
  g.add(dome("fresnel_dome", r - 0.2, dz - t - baseH, 0, 0, t + baseH, white, 16, 6));

  // Trimmers (blue box + brass screw) at the +x end.
  for (const s of [-1, 1]) {
    g.add(box(`trimmer_body_${s < 0 ? "delay" : "sensitivity"}`, 6, 6, 5, dx / 2 - 4, s * 5.4, t, mat("#2f5fd0", { roughness: 0.45 })));
    g.add(cylZ(`trimmer_screw_${s < 0 ? "delay" : "sensitivity"}`, 1.7, 1.7, 0.6, dx / 2 - 4, s * 5.4, t + 5, GOLD(), 12));
  }
  // 3-pin header at the -x end (VCC / OUT / GND).
  g.add(box("header", 2.54, 7.62, 2.5, -dx / 2 + 1.6, 0, t, BLACK()));
  for (let i = 0; i < 3; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, 5, -dx / 2 + 1.6, (i - 1) * 2.54, t + 2.5, GOLD()));
  }
  return finish(g, part.id);
};
