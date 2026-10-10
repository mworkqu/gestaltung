// Small geometry helpers shared by the procedural builders (units mm, Z up).
// Everything is positioned by its BOTTOM (z) so builders read like stacking parts.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type M = THREE.Material;

function mesh(name: string, g: THREE.BufferGeometry, m: M, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

/** Box with size (sx, sy, sz), centred in x/y, sitting on zBottom. */
export function box(name: string, sx: number, sy: number, sz: number, x: number, y: number, zBottom: number, m: M): THREE.Mesh {
  return mesh(name, new THREE.BoxGeometry(sx, sy, sz), m, x, y, zBottom + sz / 2);
}

/** Rounded box (radius r), centred in x/y, sitting on zBottom. */
export function rbox(
  name: string, sx: number, sy: number, sz: number, r: number,
  x: number, y: number, zBottom: number, m: M, segments = 2,
): THREE.Mesh {
  const rr = Math.min(r, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01);
  return mesh(name, new RoundedBoxGeometry(sx, sy, sz, segments, Math.max(0.05, rr)), m, x, y, zBottom + sz / 2);
}

/** Cylinder/cone with its axis along Z, base on zBottom. */
export function cylZ(
  name: string, rTop: number, rBottom: number, h: number,
  x: number, y: number, zBottom: number, m: M, seg = 20,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.rotateX(Math.PI / 2);
  return mesh(name, g, m, x, y, zBottom + h / 2);
}

/** Cylinder with its axis along X, centred on (xc, y, zc). */
export function cylX(name: string, r: number, len: number, xc: number, y: number, zc: number, m: M, seg = 16): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return mesh(name, g, m, xc, y, zc);
}

/** Cylinder with its axis along Y, centred on (x, yc, zc). */
export function cylY(name: string, r: number, len: number, x: number, yc: number, zc: number, m: M, seg = 16): THREE.Mesh {
  return mesh(name, new THREE.CylinderGeometry(r, r, len, seg), m, x, yc, zc);
}

/** Upper hemisphere (dome) of radius r, flattened to height h, base on zBottom. */
export function dome(
  name: string, r: number, h: number, x: number, y: number, zBottom: number, m: M, wSeg = 20, hSeg = 8,
): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, h / r);
  return mesh(name, g, m, x, y, zBottom);
}

/**
 * Re-centres the group so its bbox is x/y-centred and sits on z = 0. Pure
 * translation (never scales), so shape proportions stay as authored; the
 * authored coordinates are already close, this only absorbs rounding.
 */
export function finish(group: THREE.Group, name: string): THREE.Group {
  group.name = name;
  group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(group);
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  if (Math.abs(cx) > 1e-6 || Math.abs(cy) > 1e-6 || Math.abs(b.min.z) > 1e-6) {
    group.position.set(-cx, -cy, -b.min.z);
    group.updateMatrixWorld(true);
  }
  return group;
}

export function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
export function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
