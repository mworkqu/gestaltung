// 16x2 character LCD (1602): green PCB, metal bezel, blue lit glass with 2 x 16
// dark character cells, and the small I2C backpack soldered on the back.
// The PCB sits on top of the backpack (backpack height = params.backH).

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, cylZ, rbox, finish, num } from "./shapes";

export const lcdModule: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const backH = num(params.backH, 4.2);
  const t = 1.6;
  const zPcb = backH;
  const top = zPcb + t;

  // I2C backpack under the PCB (PCF8574 board, chip, trimmer, 4 pins down).
  g.add(box("backpack", 42, 17, 1.2, -10, 9.5, zPcb - 1.2, mat("pcb_blue")));
  g.add(box("backpack_ic", 10, 5, 2.4, -14, 9.5, zPcb - 3.6, BLACK()));
  g.add(box("backpack_trimmer", 8, 4, 2.4, -2, 12, zPcb - 3.6, mat("#2f5fd0", { roughness: 0.45 })));
  for (let i = 0; i < 4; i++) {
    g.add(box(`backpack_pin_${i + 1}`, 0.64, 0.64, zPcb - 1.2, -28 + i * 2.54, 15.5, 0, GOLD()));
  }

  g.add(rbox("pcb", dx, dy, t, 1, 0, 0, zPcb, mat(part.look.body), 2));
  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    g.add(cylZ(`mount_hole_${i + 1}`, h.d / 2 + 0.6, h.d / 2 + 0.6, 0.05, h.x, h.y, top, METAL(), 14));
    g.add(cylZ(`mount_hole_${i + 1}_bore`, h.d / 2, h.d / 2, 0.06, h.x, h.y, top, mat("#101114"), 14));
  }
  // 16-pin header row along the top edge.
  g.add(box("header", 16 * 2.54, 2.54, 2, -2, 15.5, top, BLACK()));

  // Bezel, glass and character cells.
  const bezelH = dz - top;
  g.add(box("bezel", 71.2, 26.4, bezelH, 0, -1, top, mat("#b7bcc4", { roughness: 0.35, metalness: 0.8 })));
  g.add(box("window_frame", 66, 17, 0.1, 0, -1, dz - 0.08, mat("#14161a", { roughness: 0.5 })));
  g.add(box("glass", 64.5, 14.4, 0.12, 0, -1, dz - 0.12, mat("#1f55d6", { roughness: 0.2, emissive: "#2a6bff", emissiveIntensity: 0.55 })));
  const cell = mat("#12327d", { roughness: 0.4 });
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 16; c++) {
      g.add(box(`cell_${r + 1}_${c + 1}`, 2.9, 5.4, 0.05, (c - 7.5) * 3.9, -1 + (r === 0 ? 3.7 : -3.7), dz - 0.05, cell));
    }
  }
  return finish(g, part.id);
};
