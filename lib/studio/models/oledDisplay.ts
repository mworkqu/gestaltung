// 0.96" I2C OLED: blue board, black glass, cyan active area, 4-pin header at -y.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish } from "./shapes";

export const oledDisplay: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = 1.2;
  g.add(rbox("pcb", dx, dy, t, 1, 0, 0, 0, mat(part.look.body), 2));

  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    g.add(cylZ(`mount_hole_${i + 1}`, h.d / 2 + 0.45, h.d / 2 + 0.45, 0.05, h.x, h.y, t, METAL(), 14));
    g.add(cylZ(`mount_hole_${i + 1}_bore`, h.d / 2, h.d / 2, 0.06, h.x, h.y, t, mat("#101114"), 14));
  }

  // Glass panel and active pixel area.
  const yGlass = 3;
  g.add(box("glass", dx - 1.6, 19.6, 1.4, 0, yGlass, t, mat("#0a0b0d", { roughness: 0.12, metalness: 0.2 })));
  g.add(box("active_area", 21.7, 10.9, 0.06, 0, yGlass + 1.2, t + 1.4, mat("#0b2e3a", {
    roughness: 0.25, emissive: "#2ab4d6", emissiveIntensity: 0.55,
  })));
  // Flex-cable fold and driver chip sliver below the glass.
  g.add(box("flex_cable", dx - 6, 3, 0.35, 0, yGlass - 9.9 - 1.1, t, mat("#b8742a", { roughness: 0.6 })));

  // 4-pin header (GND VCC SCL SDA).
  const hy = -dy / 2 + 1.7;
  const plasticH = dz - t - 1.2;
  g.add(box("header", 4 * 2.54, 2.54, plasticH, 0, hy, t, BLACK()));
  for (let i = 0; i < 4; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, 1.2, (i - 1.5) * 2.54, hy, t + plasticH, GOLD()));
  }
  return finish(g, part.id);
};
