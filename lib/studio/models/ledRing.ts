// 12-LED WS2812 ring: flat circular PCB with 12 white 5050 LEDs (bright centres)
// on a circle and three solder pads. Flat on z = 0, light toward +z.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD } from "./materials";
import { box, cylZ, finish, num } from "./shapes";

export const ledRing: ModelBuilder = ({ part, params }) => {
  const { x: dx, z: dz } = part.dims;
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(num(params.leds, 12)));
  const t = 1.6;
  const ro = dx / 2;
  const ri = num(params.innerR, 11.6);
  const rLed = (ro + ri) / 2;
  const ledH = dz - t;

  const shape = new THREE.Shape();
  shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const pcb = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 28 }), mat(part.look.body));
  pcb.name = "pcb_ring";
  g.add(pcb);

  const white = mat("#ecebe6", { roughness: 0.5 });
  const cup = mat("#e9d77c", { roughness: 0.4 });
  const glow = mat("#fff6c9", { emissive: "#fff2b0", emissiveIntensity: 1 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * rLed;
    const y = Math.sin(a) * rLed;
    const body = box(`led_${i + 1}`, 5, 5, ledH, x, y, t, white);
    body.rotation.z = a;
    g.add(body);
    g.add(cylZ(`led_${i + 1}_cup`, 1.9, 1.9, 0.04, x, y, dz - 0.04, cup, 10));
    g.add(cylZ(`led_${i + 1}_glow`, 1.1, 1.1, 0.05, x, y, dz - 0.05, glow, 10));
  }
  // Solder pads (5V, DIN, GND) on the outer rim.
  for (const [i, a] of [210, 270, 330].entries()) {
    const r = (a * Math.PI) / 180;
    g.add(box(`pad_${i + 1}`, 2.4, 2.4, 0.12, Math.cos(r) * (ro - 1.6), Math.sin(r) * (ro - 1.6), t, GOLD()));
  }
  return finish(g, part.id);
};
