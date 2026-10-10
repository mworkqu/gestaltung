// HC-SR04 ultrasonic sensor, standing upright: the board is a vertical plate in
// the XZ plane, the two silver transducers look toward +y, the 4-pin header
// points down (-z). params: spacing (centre-to-centre of the two cans, mm).

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, cylY, finish, num } from "./shapes";

export const ultrasonicSensor: ModelBuilder = ({ part, params }) => {
  const { x: dx, y: dy, z: dz } = part.dims;
  const g = new THREE.Group();
  const t = 1.6;
  const backH = 2; // chips on the back of the board
  const boardH = 20;
  const zBoard = dz - boardH;
  const yBack = -dy / 2;
  const yBoard = yBack + backH + t / 2; // board mid-plane
  const yFront = yBoard + t / 2;
  const spacing = num(params.spacing, 26);
  const canR = 8;
  const canLen = dy - backH - t;
  const zc = zBoard + boardH / 2;

  g.add(box("pcb", dx, t, boardH, 0, yBoard, zBoard, mat(part.look.body)));

  // The two transducers: silver can, black mesh face, recessed ring.
  for (const s of [-1, 1]) {
    const x = (s * spacing) / 2;
    const tag = s < 0 ? "tx" : "rx";
    g.add(cylY(`${tag}_can`, canR, canLen, x, yFront + canLen / 2, zc, mat("#c3c8d0", { roughness: 0.3, metalness: 0.85 }), 28));
    g.add(cylY(`${tag}_face`, canR - 1.2, 0.2, x, yFront + canLen - 0.1, zc, mat("#17181b", { roughness: 0.6 }), 24));
    g.add(cylY(`${tag}_dot`, 1.6, 0.25, x, yFront + canLen - 0.1, zc, METAL(), 12));
  }
  // Crystal can and driver ICs on the back.
  g.add(box("crystal", 4, 1.8, 10, 0, yBack + 0.9, zBoard + 5, METAL()));
  for (const [i, x] of [-9, 9].entries()) {
    g.add(box(`ic_${i + 1}`, 9, 1.4, 5, x, yBack + 0.7, zBoard + 13, BLACK()));
  }
  // Pin header along the bottom edge, pins pointing down.
  g.add(box("header", 4 * 2.54, 2.54, 2.5, 0, yBoard, zBoard - 2.5, BLACK()));
  for (let i = 0; i < 4; i++) {
    g.add(box(`pin_${i + 1}`, 0.64, 0.64, zBoard - 2.5, (i - 1.5) * 2.54, yBoard, 0, GOLD()));
  }
  return finish(g, part.id);
};
