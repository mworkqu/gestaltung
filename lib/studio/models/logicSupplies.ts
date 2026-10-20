// Builders for the logic-build supplies: breadboard, 4-position DIP switch, jumper wire pack.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, METAL, BLACK } from "./materials";
import { box, rbox, finish, num } from "./shapes";

/** White solderless breadboard: centre groove, red / blue power-rail stripes, terminal-strip hint. */
export const breadboard: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const dark = mat("#2a2c31");
  g.add(rbox("body", dx, dy, dz, 0.8, 0, 0, 0, mat("#ece9e2", { roughness: 0.6 }), 2));
  g.add(box("groove", dx - 8, 2.4, 0.3, 0, 0, dz - 0.1, dark));
  const railLen = dx - 14;
  for (const s of [-1, 1]) {
    const k = s < 0 ? "a" : "b";
    g.add(box(`rail_red_${k}`, railLen, 0.5, 0.2, 0, s * (dy / 2 - 6.4), dz - 0.05, mat("#c0392b")));
    g.add(box(`rail_blue_${k}`, railLen, 0.5, 0.2, 0, s * (dy / 2 - 3.2), dz - 0.05, mat("#2f5fd0")));
    g.add(box(`holes_${k}`, railLen, 1.1, 0.2, 0, s * 8.5, dz - 0.05, dark));
  }
  return finish(g, part.id);
};

/** n-position DIP switch: red block, a row of white sliders, 2 x n legs. */
export const dipSwitch: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(num(params.n, 4)));
  const legH = 3;
  g.add(rbox("body", dx, 6.4, dz - legH, 0.3, 0, 0, legH, mat("#b8321f", { roughness: 0.5 }), 2));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 2.54;
    g.add(box(`slider_${i + 1}`, 1.5, 2.6, 0.6, x, 0.4, dz - 0.1, mat("#f1f1f1")));
    for (const s of [-1, 1]) g.add(box(`leg_${i + 1}_${s < 0 ? "a" : "b"}`, 0.5, 0.5, legH, x, s * (dy / 2 - 0.25), 0, METAL()));
  }
  return finish(g, part.id);
};

/** Bundle of male-to-male jumpers: a black tray with coloured wire runs on top. */
export const jumperKit: ModelBuilder = ({ part }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  g.add(rbox("tray", dx, dy, dz * 0.5, 1.5, 0, 0, 0, BLACK(), 2));
  const colours = ["#c0392b", "#e08a1e", "#d8c11e", "#2e9e4f", "#2f5fd0", "#7a3fb0"];
  colours.forEach((c, i) => {
    const y = (i - (colours.length - 1) / 2) * (dy / (colours.length + 1));
    g.add(rbox(`wire_${i + 1}`, dx - 6, 3, dz * 0.5, 1, 0, y, dz * 0.5, mat(c, { roughness: 0.5 }), 2));
  });
  return finish(g, part.id);
};
