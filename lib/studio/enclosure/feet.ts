// The case's rubber feet: bought pads, not printed, so they are plain three.js
// children of the base mesh and never go through the print check or an STL.
// (A wall plate and a stake pod never get feet.)

import * as THREE from "three";
import type { EnclosureSpec } from "../schema";
import { exitDistance, type EnclosureDims } from "./templates";

const FOOT_COLOUR = 0x1f2125;

export function feetMeshes(d: EnclosureDims, kind: EnclosureSpec["feet"]): THREE.Mesh[] {
  if (kind === "none" || d.template === "wall_plate" || d.template === "stake_pod") return [];
  const mat = new THREE.MeshStandardMaterial({ color: FOOT_COLOUR, roughness: 0.9, metalness: 0 });
  if (kind === "ring") {
    const R = Math.max(4, Math.min(d.W, d.D) / 2 - Math.max(6, d.cornerRadius * 0.4));
    const g = new THREE.TorusGeometry(R, 1.2, 8, 64);
    g.scale(1, 1, 0.6);
    g.translate(0, 0, -0.35);
    const m = new THREE.Mesh(g, mat);
    m.name = "enclosure_feet";
    return [m];
  }
  const r = Math.max(3, Math.min(6, Math.min(d.W, d.D) * 0.06));
  const out: THREE.Mesh[] = [];
  const dirs: [number, number][] = [[d.W, d.D], [-d.W, d.D], [-d.W, -d.D], [d.W, -d.D]];
  dirs.forEach(([dx, dy], i) => {
    const l = Math.hypot(dx, dy);
    const t = exitDistance(d, 0, 0, dx / l, dy / l) - (r + 3 + d.edgeFillet);
    const g = new THREE.CylinderGeometry(r, r, 1.6, 24);
    g.rotateX(Math.PI / 2);
    g.translate((dx / l) * t, (dy / l) * t, -0.6);
    const m = new THREE.Mesh(g, mat);
    m.name = `enclosure_foot_${i + 1}`;
    out.push(m);
  });
  return out;
}
