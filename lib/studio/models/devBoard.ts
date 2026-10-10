// Generic development board (ESP32 DevKit, Arduino Uno…): PCB + MCU + USB + headers.
//
// params:
//   chip:   "esp32" (shielded WiFi module + antenna) | "atmega" (DIP chip, crystal, reset)
//   usb:    "micro" | "typeB"          (typeB also adds the DC jack when jack = true)
//   jack:   boolean
//   boardT: PCB thickness (mm)
//   rows:   [{ y, x0, n, kind: "pins" | "socket", h? }]  header rows (centre y, centre x0, n pins)

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish, num, str } from "./shapes";

type Row = { y: number; x0: number; n: number; kind: "pins" | "socket"; h?: number };

const PITCH = 2.54;

export const devBoard: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = num(params.boardT, 1.6);
  const chip = str(params.chip, "esp32");
  const usb = str(params.usb, "micro");
  const rows = Array.isArray(params.rows) ? (params.rows as Row[]) : [];

  g.add(rbox("pcb", dx, dy, t, 1.5, 0, 0, 0, mat(part.look.body), 2));

  // Mounting holes (dark discs on the board surface).
  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    const d = cylZ(`mount_hole_${i + 1}`, h.d / 2 + 0.5, h.d / 2 + 0.5, 0.05, h.x, h.y, t, METAL(), 16);
    g.add(d);
    g.add(cylZ(`mount_hole_${i + 1}_bore`, h.d / 2, h.d / 2, 0.06, h.x, h.y, t, mat("#101114"), 16));
  }

  if (usb === "micro") {
    g.add(box("usb_micro", 5.6, 7.5, 2.7, -dx / 2 + 2.8, 0, t, METAL()));
    g.add(box("usb_micro_port", 0.1, 5.8, 1.4, -dx / 2 + 0.06, 0, t + 0.7, mat("#101114")));
  } else {
    g.add(box("usb_b", 16.4, 12, 10.9, -dx / 2 + 8.2, 11.5, t, METAL()));
    g.add(box("usb_b_port", 0.1, 8, 5, -dx / 2 + 0.06, 11.5, t + 2.9, mat("#101114")));
    if (params.jack !== false) {
      g.add(box("dc_jack", 14, 9, 10.7, -dx / 2 + 7, -18, t, BLACK()));
      g.add(box("dc_jack_port", 0.1, 6.4, 6.4, -dx / 2 + 0.06, -18, t + 2.2, mat("#050506")));
    }
  }

  if (chip === "esp32") {
    // Shielded module with the PCB antenna sticking out toward +x.
    const mx = dx / 2 - 12.75 - 1;
    g.add(box("esp32_module_pcb", 25.5, 18, 0.8, mx, 0, t, mat("#15171b", { roughness: 0.5 })));
    g.add(box("esp32_shield", 19, 18, 2.4, mx - 3.25, 0, t + 0.8, METAL()));
    g.add(box("esp32_antenna_trace", 5, 12, 0.05, mx + 9.5, 0, t + 0.8, GOLD()));
    g.add(box("usb_uart_chip", 5, 5, 0.9, -dx / 2 + 13, -4, t, BLACK()));
    for (const s of [-1, 1]) {
      g.add(box(`button_${s < 0 ? "boot" : "en"}`, 3.6, 6, 1.6, -dx / 2 + 8.5, s * 9.5, t, mat("#d8d8d8", { roughness: 0.4, metalness: 0.5 })));
    }
    g.add(box("led_blue", 1.6, 0.8, 0.5, -dx / 2 + 22, 9, t, mat("#2d7bff", { emissive: "#2d7bff", emissiveIntensity: 0.6 })));
  } else {
    // ATmega328P in a DIP socket, 16U2 USB chip, crystal and reset button.
    g.add(box("dip_socket", 36.5, 8.6, 2.5, 6, -7, t, BLACK()));
    g.add(box("atmega_chip", 35, 7.6, 3.4, 6, -7, t + 2.5, mat("#111214", { roughness: 0.35 })));
    g.add(cylZ("atmega_pin1_dot", 0.6, 0.6, 0.05, -9.5, -9, t + 5.9, METAL(), 12));
    g.add(box("usb_chip_16u2", 7, 7, 1, -dx / 2 + 25, 5, t, BLACK()));
    g.add(box("crystal", 11, 4.5, 3.5, -dx / 2 + 17, -9, t, METAL()));
    g.add(box("reset_button_body", 6, 6, 3.5, -dx / 2 + 12, 20, t, mat("#bdbdbd", { roughness: 0.4, metalness: 0.6 })));
    g.add(cylZ("reset_button_cap", 1.8, 1.8, 1.4, -dx / 2 + 12, 20, t + 3.5, mat("#c0392b"), 14));
    g.add(box("led_power", 1.6, 0.8, 0.5, dx / 2 - 18, 8, t, mat("#35d07f", { emissive: "#35d07f", emissiveIntensity: 0.6 })));
  }

  // Header rows run along X (the long edge).
  for (const [ri, r] of rows.entries()) {
    const len = r.n * PITCH;
    if (r.kind === "socket") {
      const h = r.h ?? 8.5;
      g.add(box(`header_${ri + 1}`, len, PITCH, h, r.x0, r.y, t, BLACK()));
    } else {
      const plasticH = 2.5;
      g.add(box(`header_${ri + 1}`, len, PITCH, plasticH, r.x0, r.y, t, BLACK()));
      const pinH = dz - t - plasticH;
      const pinMat = GOLD();
      for (let i = 0; i < r.n; i++) {
        const px = r.x0 - len / 2 + PITCH * (i + 0.5);
        g.add(box(`pin_${ri + 1}_${i + 1}`, 0.64, 0.64, pinH, px, r.y, t + plasticH, pinMat));
      }
    }
  }
  return finish(g, part.id);
};
