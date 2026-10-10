// Axial resistor standing with its leads bent down: beige body, colour bands.
// params.bands = 4 hex colours (default 220 ohm: red, red, brown, gold).

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { cylX, cylZ, finish } from "./shapes";

const DEFAULT_BANDS = ["#c0392b", "#c0392b", "#6e3b1c", "#c9a227"];

export const resistor: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const bands = Array.isArray(params.bands) && params.bands.length === 4 ? (params.bands as string[]) : DEFAULT_BANDS;
  const r = dy / 2;
  const zc = dz - r;
  const wireR = 0.3;
  const pitch = dx - 2 * wireR;
  const bodyLen = 6.3;

  g.add(cylX("body", r, bodyLen, 0, 0, zc, mat("#d9c9a0", { roughness: 0.7 }), 18));
  // Slightly fatter ends, like a real carbon-film resistor.
  for (const s of [-1, 1]) {
    g.add(cylX(`end_${s < 0 ? "a" : "b"}`, r, 1, s * (bodyLen / 2 - 0.5), 0, zc, mat("#cdbb8c", { roughness: 0.7 }), 18));
  }
  const xs = [-1.9, -0.7, 0.5, 2.3];
  bands.forEach((c, i) => {
    g.add(cylX(`band_${i + 1}`, r + 0.04, 0.5, xs[i], 0, zc, mat(c, { roughness: 0.5 }), 18));
  });

  const metal = METAL();
  for (const s of [-1, 1]) {
    const x = s * pitch / 2;
    const lead = s < 0 ? "a" : "b";
    g.add(cylX(`lead_${lead}_horizontal`, wireR, pitch / 2 - bodyLen / 2 + wireR, s * (bodyLen / 2 + (pitch / 2 - bodyLen / 2) / 2), 0, zc, metal, 8));
    g.add(cylZ(`lead_${lead}_vertical`, wireR, wireR, zc, x, 0, 0, metal, 8));
  }
  return finish(g, part.id);
};
