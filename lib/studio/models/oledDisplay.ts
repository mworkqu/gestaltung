// I2C OLED module (0.96" or 1.3"): blue board, black glass, cyan active area, 4-pin header at -y.
//
// params (all optional; defaults are the 0.96" module):
//   glassW / glassH   glass panel size          (dx - 1.6, 19.6)
//   glassY            glass centre y            (3)
//   activeW / activeH lit pixel area            (21.7, 10.9)
//   activeDY          active-area centre above the glass centre (1.2)

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish, num } from "./shapes";

export const oledDisplay: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = 1.2;
  g.add(rbox("pcb", dx, dy, t, 1, 0, 0, 0, mat(part.look.body), 2));

  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    g.add(cylZ(`mount_hole_${i + 1}`, h.d / 2 + 0.45, h.d / 2 + 0.45, 0.05, h.x, h.y, t, METAL(), 14));
    g.add(cylZ(`mount_hole_${i + 1}_bore`, h.d / 2, h.d / 2, 0.06, h.x, h.y, t, mat("#101114"), 14));
  }

  // Glass panel and active pixel area.
  const glassW = num(params.glassW, dx - 1.6);
  const glassH = num(params.glassH, 19.6);
  const yGlass = num(params.glassY, 3);
  g.add(box("glass", glassW, glassH, 1.4, 0, yGlass, t, mat("#0a0b0d", { roughness: 0.12, metalness: 0.2 })));
  g.add(box("active_area", num(params.activeW, 21.7), num(params.activeH, 10.9), 0.06, 0, yGlass + num(params.activeDY, 1.2), t + 1.4, mat("#0b2e3a", {
    roughness: 0.25, emissive: "#2ab4d6", emissiveIntensity: 0.55,
  })));
  // Flex-cable fold and driver chip sliver below the glass.
  g.add(box("flex_cable", dx - 6, 3, 0.35, 0, yGlass - glassH / 2 - 0.1 - 1.1, t, mat("#b8742a", { roughness: 0.6 })));

  // 4-pin header (GND VCC SCL SDA).
  const hy = -dy / 2 + 1.7;
  const plasticH = dz - t - 1.2;
  g.add(box("header", 4 * 2.54, 2.54, plasticH, 0, hy, t, BLACK()));
  for (let i = 0; i < 4; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, 1.2, (i - 1.5) * 2.54, hy, t + plasticH, GOLD()));
  }
  return finish(g, part.id);
};
