// LiPo pouch cell (silver foil, label, protection board) with a short red/black
// lead and a white JST plug at the -x end. Pouch lies flat.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { box, cylX, rbox, finish } from "./shapes";

export const lipoPouch: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const plugL = 8;
  const wireL = 4;
  const pouchL = dx - plugL - wireL;
  const xp = dx / 2 - pouchL / 2; // pouch centre

  g.add(rbox("pouch", pouchL, dy, dz, 1.2, xp, 0, 0, mat("#c9ced6", { roughness: 0.35, metalness: 0.75 }), 2));
  // Printed label and the heat-sealed edge at the +x end.
  g.add(box("label", pouchL - 14, dy - 8, 0.06, xp - 2, 0, dz, mat("#2457a6", { roughness: 0.6 })));
  g.add(box("label_stripe", pouchL - 14, 5, 0.07, xp - 2, 0, dz, mat("#e8eefb", { roughness: 0.6 })));
  g.add(box("seal_edge", 2.4, dy - 2, dz * 0.45, dx / 2 - 1.2, 0, 0, mat("#aeb4bd", { roughness: 0.5, metalness: 0.5 })));
  // Protection board where the leads leave the pouch.
  g.add(box("protection_board", 3.6, 12, 1.6, xp - pouchL / 2 + 2, 0, dz / 2 - 0.8, mat("#d6a21d", { roughness: 0.5 })));

  const zl = dz / 2;
  const x0 = -dx / 2 + plugL + wireL / 2;
  for (const s of [-1, 1]) {
    g.add(cylX(`wire_${s < 0 ? "black" : "red"}`, 0.7, wireL + 1, x0, s * 1.0, zl, mat(s < 0 ? "#1a1b1e" : "#c0392b", { roughness: 0.6 }), 8));
  }
  // JST-PH plug.
  g.add(box("plug", plugL, 6, 4.8, -dx / 2 + plugL / 2, 0, zl - 2.4, mat("#ece9e0", { roughness: 0.5 })));
  g.add(box("plug_pins", 0.1, 3.2, 1.6, -dx / 2 + 0.06, 0, zl - 0.8, METAL()));
  return finish(g, part.id);
};
