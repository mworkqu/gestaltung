// Small round speaker (28 mm: black frame, dark cone, dust cap) beside a
// PAM8403-style amplifier board with a 4-pin header. Speaker faces +z.
// params: spkR (speaker radius, default 14), spkX (speaker centre x).

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, cylZ, dome, rbox, finish, num } from "./shapes";

export const speakerAmp: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const r = num(params.spkR, 14);
  const sx = num(params.spkX, dx / 2 - r);
  const spkH = 5;
  const t = 1.2;
  const bw = dx - 2 * r - 1; // amp board width, 1 mm gap to the speaker
  const bx = -dx / 2 + bw / 2;

  // Speaker: frame ring, surround, cone, dust cap, mounting ears.
  g.add(cylZ("spk_frame", r, r, spkH - 1.2, sx, 0, 0, BLACK(), 36));
  g.add(cylZ("spk_surround", r - 0.8, r - 0.8, 1.2, sx, 0, spkH - 1.2, mat("#26282d", { roughness: 0.6 }), 36));
  g.add(cylZ("spk_cone", r - 3.6, r - 3.6, 0.2, sx, 0, spkH - 0.2, mat("#3a3d44", { roughness: 0.55 }), 32));
  g.add(dome("spk_dust_cap", 4.2, 1.2, sx, 0, spkH - 1.2, mat("#16171a", { roughness: 0.5 }), 16, 6));
  for (const a of [45, 135, 225, 315]) {
    const rad = (a * Math.PI) / 180;
    g.add(cylZ(`spk_screw_${a}`, 0.9, 0.9, 0.15, sx + Math.cos(rad) * (r - 1.8), Math.sin(rad) * (r - 1.8), spkH - 1.2, METAL(), 8));
  }

  // Amplifier board.
  g.add(rbox("pcb", bw, dy - 10, t, 1, bx, 0, 0, mat(part.look.body), 2));
  g.add(box("amp_ic", 10, 4, 1.6, bx + 2, 1.5, t, BLACK()));
  g.add(box("pot_body", 6, 6, 4, bx + 3.5, -5, t, mat("#2f5fd0", { roughness: 0.45 })));
  g.add(cylZ("pot_screw", 1.6, 1.6, 0.5, bx + 3.5, -5, t + 4, GOLD(), 10));
  g.add(cylZ("capacitor", 2.5, 2.5, 5, bx - 3, 6, t, mat("#202226", { roughness: 0.4 }), 14));
  g.add(box("led", 1.6, 0.8, 0.5, bx + 6.5, 6, t, mat("#ff3b30", { emissive: "#ff3b30", emissiveIntensity: 0.6 })));
  // Header: VCC, GND, IN (+1 spare), pins up to dz.
  const hx = bx - bw / 2 + 2;
  g.add(box("header", 2.54, 4 * 2.54, 2.5, hx, 0, t, BLACK()));
  for (let i = 0; i < 4; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, dz - t - 2.5, hx, (i - 1.5) * 2.54, t + 2.5, GOLD()));
  }
  return finish(g, part.id);
};
