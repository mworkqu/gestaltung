// TP4056 charger board: small blue PCB, USB-C receptacle at -x, two ICs,
// status LEDs and six gold solder pads.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, rbox, finish } from "./shapes";

export const chargerBoard: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy } = part.dims;
  const g = new THREE.Group();
  const t = 1.2;
  g.add(rbox("pcb", dx, dy, t, 0.8, 0, 0, 0, mat(part.look.body), 2));

  // USB-C receptacle (8.9 wide x 7.3 deep x 3.2 high) flush with the -x edge.
  g.add(box("usb_c", 7.3, 8.9, 3.2, -dx / 2 + 3.65, 0, t, METAL()));
  g.add(box("usb_c_slot", 0.1, 7, 1.2, -dx / 2 + 0.06, 0, t + 1, mat("#0a0a0b")));
  g.add(box("usb_c_tongue", 0.1, 6, 0.5, -dx / 2 + 0.07, 0, t + 1.35, mat("#2b2b2e")));

  // Charger IC (SOP-8), protection IC and MOSFET.
  g.add(box("tp4056_ic", 5, 4, 1.5, 1, 3.5, t, BLACK()));
  g.add(box("dw01_ic", 3, 1.6, 1, 5.5, -3.5, t, BLACK()));
  g.add(box("mosfet_ic", 3, 2.4, 1, 0.5, -3.5, t, BLACK()));
  // Tiny passives.
  for (let i = 0; i < 4; i++) g.add(box(`smd_${i + 1}`, 1.6, 0.8, 0.5, -2 + i * 2.2, 6, t, mat("#2a2523")));
  // Status LEDs (red = charging, green = done).
  g.add(box("led_red", 1.6, 0.8, 0.5, dx / 2 - 6, 5.5, t, mat("#ff3b30", { emissive: "#ff3b30", emissiveIntensity: 0.7 })));
  g.add(box("led_green", 1.6, 0.8, 0.5, dx / 2 - 6, 3.5, t, mat("#35d07f", { emissive: "#35d07f", emissiveIntensity: 0.7 })));
  // Solder pads: IN+/IN- on the left corners, OUT+/B+ and OUT-/B- on the right.
  const padY = dy / 2 - 1.8;
  const padMat = GOLD();
  for (const [i, [px, py]] of ([
    [-dx / 2 + 1.8, padY], [-dx / 2 + 1.8, -padY],
    [dx / 2 - 1.8, padY], [dx / 2 - 1.8, -padY],
    [dx / 2 - 1.8, padY - 3.4], [dx / 2 - 1.8, -padY + 3.4],
  ] as const).entries()) {
    g.add(box(`pad_${i + 1}`, 2.2, 2.2, 0.12, px, py, t, padMat));
  }
  return finish(g, part.id);
};
