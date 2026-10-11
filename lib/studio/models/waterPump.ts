// Mini submersible water pump (JT-180 style) lying along X: black round body with
// a slotted intake cap at -x, a white outlet nozzle rising at +x and two leads.
// Flat on z = 0.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat } from "./materials";
import { box, cylX, cylZ, finish } from "./shapes";

export const waterPump: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const r = dy / 2;
  const bodyL = dx - 8;
  const x0 = -dx / 2;
  const zc = r;
  const black = mat("#1d1f24", { roughness: 0.55 });

  g.add(cylX("body", r, bodyL, x0 + bodyL / 2, 0, zc, black, 24));
  // Intake cap with slots.
  g.add(cylX("intake_cap", r * 0.92, 2, x0 + 1, 0, zc, mat("#2b2e35", { roughness: 0.7 }), 24));
  for (let i = -2; i <= 2; i++) {
    g.add(box(`intake_slot_${i + 2}`, 0.6, 1.4, r * 1.1, x0 - 0.1, i * 3.2, zc - r * 0.55, mat("#0c0d10", { roughness: 0.9 })));
  }
  // Outlet nozzle (white), rising from the top at the +x end.
  const nozzleH = Math.max(4, dz - dy);
  g.add(cylZ("outlet_base", 4.2, 4.2, 2.5, x0 + bodyL - 6, 0, dy - 1.5, mat("#f2f2f0", { roughness: 0.45 }), 18));
  g.add(cylZ("outlet", 3.2, 3.4, nozzleH, x0 + bodyL - 6, 0, dy, mat("#f2f2f0", { roughness: 0.45 }), 18));
  // Leads out of the back.
  g.add(cylX("lead_red", 0.8, 8, dx / 2 - 4, -1.6, zc, mat("#d63a30", { roughness: 0.5 }), 10));
  g.add(cylX("lead_black", 0.8, 8, dx / 2 - 4, 1.6, zc, mat("#15161a", { roughness: 0.5 }), 10));
  return finish(g, part.id);
};
