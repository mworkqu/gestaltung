// DHT22 / AM2302: white plastic body standing on its edge, vented slot grid on
// the +x face (the sensing face), four metal pins toward -y.
// Body: thickness x, length y (pins stubbed to 5 mm), width z.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { box, rbox, finish } from "./shapes";

export const dht22: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const pinLen = 5;
  const bodyLen = dy - pinLen;
  const yBody = -dy / 2 + pinLen + bodyLen / 2;
  const slot = 0.1; // slots stand 0.1 mm proud of the face

  g.add(rbox("body", dx - slot, bodyLen, dz, 0.9, -slot / 2, yBody, 0, mat("plastic_white", { roughness: 0.55 }), 2));

  // Grid of dark vent slots on the +x face.
  const dark = mat("#1a1b1e", { roughness: 0.7 });
  const cols = 5;
  const rowsN = 8;
  const cell = 1.9;
  const gridZ = cols * cell;
  const gridY = rowsN * cell;
  const zc = dz / 2;
  const yTop = yBody + bodyLen / 2 - 3.2; // grid sits toward the top of the body
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      g.add(box(
        `vent_${r + 1}_${c + 1}`, slot * 2, cell * 0.62, cell * 0.62,
        dx / 2 - slot, yTop - gridY + cell * (r + 0.5), zc - gridZ / 2 + cell * (c + 0.5) - cell * 0.31, dark,
      ));
    }
  }

  // Four pins, 2.54 mm pitch, across the 15 mm width.
  const metal = METAL();
  for (let i = 0; i < 4; i++) {
    g.add(box(`pin_${i + 1}`, 0.6, pinLen + 0.2, 0.5, -slot / 2, -dy / 2 + (pinLen + 0.2) / 2, zc + (i - 1.5) * 2.54 - 0.25, metal));
  }
  return finish(g, part.id);
};
