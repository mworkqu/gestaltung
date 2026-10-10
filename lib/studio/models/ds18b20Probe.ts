// DS18B20 waterproof probe kit: small blue adapter board (3-pin header + screw
// terminal) at -x, a black cable, a heat-shrink joint and the stainless probe
// tube at +x. Lying along X, flat on z = 0.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, cylX, rbox, finish } from "./shapes";

export const ds18b20Probe: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = 1.2;
  const boardL = 18;
  const x0 = -dx / 2;
  const zc = 3.3; // cable / tube axis height (joint sleeve r 3.3 sits on z = 0)
  const probeL = 29;

  g.add(rbox("pcb", boardL, dy, t, 1, x0 + boardL / 2, 0, 0, mat(part.look.body), 2));
  // 3-pin header at the far end, pins up.
  g.add(box("header", 2.54, 3 * 2.54, 2.5, x0 + 2.4, 0, t, BLACK()));
  for (let i = 0; i < 3; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, dz - t - 2.5, x0 + 2.4, (i - 1) * 2.54, t + 2.5, GOLD()));
  }
  // 4.7k pull-up and a 3-way screw terminal where the cable lands.
  g.add(box("resistor", 3.4, 1.4, 1.2, x0 + 8.5, 3.2, t, mat("#d9c9a0", { roughness: 0.7 })));
  g.add(box("terminal", 8, 3 * 3.5, 6, x0 + boardL - 5, 0, t, mat("#2f5fd0", { roughness: 0.45 })));
  // Cable, joint and probe.
  g.add(cylX("cable", 2, dx - boardL - probeL + 2, x0 + boardL + (dx - boardL - probeL) / 2 - 1, 0, zc, mat("#17181b", { roughness: 0.7 }), 12));
  g.add(cylX("joint_heatshrink", 3.3, 8, dx / 2 - probeL - 1, 0, zc, mat("#101114", { roughness: 0.6 }), 14));
  g.add(cylX("probe_tube", 3, probeL, dx / 2 - probeL / 2, 0, zc, METAL(), 16));
  g.add(cylX("probe_tip", 2.6, 0.6, dx / 2 - 0.3, 0, zc, mat("#d6dbe2", { roughness: 0.25, metalness: 0.9 }), 12));
  return finish(g, part.id);
};
