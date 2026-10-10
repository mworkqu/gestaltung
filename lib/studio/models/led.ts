// 5 mm LED: translucent domed lens with a flange, two short legs. params.colour = lens hex.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL } from "./materials";
import { box, cylZ, dome, finish, str } from "./shapes";

export const led: ModelBuilder = ({ part, params }) => {
  const { x: dx, z: dz } = part.dims;
  const g = new THREE.Group();
  const colour = str(params.colour, str(part.look.accent, "#ff3b30"));
  const lens = mat(colour, { physical: true, roughness: 0.2, transmission: 0.35, emissive: colour, emissiveIntensity: 0.25, opacity: 0.92 });
  const legH = 6;
  const flangeH = 1;
  const r = 2.5;
  const domeH = r;
  const barrelH = dz - legH - flangeH - domeH;

  const metal = METAL();
  for (const s of [-1, 1]) {
    g.add(box(`leg_${s < 0 ? "cathode" : "anode"}`, 0.5, 0.5, legH + 0.2, s * 1.27, 0, 0, metal));
  }
  g.add(cylZ("flange", dx / 2, dx / 2, flangeH, 0, 0, legH, lens, 24));
  g.add(cylZ("barrel", r, r, barrelH, 0, 0, legH + flangeH, lens, 24));
  g.add(dome("lens_dome", r, domeH, 0, 0, legH + flangeH + barrelH, lens, 24, 8));
  // Inner anvil/post visible through the lens.
  g.add(box("anvil", 1.4, 0.3, 3, 0, 0, legH + flangeH, metal));
  return finish(g, part.id);
};
