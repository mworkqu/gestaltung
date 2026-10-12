// 3D wiring (P5-17f): a round tube swept along a polyline (the routed wire's
// centre line, corners already rounded by lib/studio/wiring3d/wires.ts).
//
// Parallel-transport frames, one ring per point, indices in path order so a
// drawRange from 0 "draws the wire in" from its first end (build guide).

import * as THREE from "three";

import type { Vec3 } from "@/lib/studio/wiring3d/pins3d";

export function tubeAlong(points: Vec3[], radius: number, radial = 10): THREE.BufferGeometry {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const n = pts.length;
  const geo = new THREE.BufferGeometry();
  if (n < 2) return geo;
  // Tangent at each point: the mean of the neighbouring segment directions.
  const tan: THREE.Vector3[] = pts.map((p, i) => {
    const a = i > 0 ? p.clone().sub(pts[i - 1]).normalize() : null;
    const b = i < n - 1 ? pts[i + 1].clone().sub(p).normalize() : null;
    const t = (a && b ? a.add(b) : (a ?? b)!).normalize();
    return t.lengthSq() > 1e-12 ? t : (b ?? a ?? new THREE.Vector3(1, 0, 0)).clone();
  });
  // First normal: perpendicular to the first tangent, then carried along (parallel transport).
  const t0 = tan[0];
  let nrm = Math.abs(t0.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  nrm = nrm.sub(t0.clone().multiplyScalar(nrm.dot(t0))).normalize();
  const pos = new Float32Array(n * (radial + 1) * 3);
  const nor = new Float32Array(n * (radial + 1) * 3);
  const bin = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = tan[i];
    if (i > 0) {
      nrm.sub(t.clone().multiplyScalar(nrm.dot(t)));
      if (nrm.lengthSq() < 1e-10) nrm = Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      nrm.normalize();
    }
    bin.crossVectors(t, nrm).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      v.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      const k = (i * (radial + 1) + j) * 3;
      nor[k] = v.x;
      nor[k + 1] = v.y;
      nor[k + 2] = v.z;
      pos[k] = pts[i].x + v.x * radius;
      pos[k + 1] = pts[i].y + v.y * radius;
      pos[k + 2] = pts[i].z + v.z * radius;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Where a wire's end sleeve sits: from the end, along the riser, `len` mm (shorter on a short riser). */
export function sleeveAt(points: Vec3[], atStart: boolean, len: number): { from: Vec3; dir: Vec3; len: number } | null {
  if (points.length < 2) return null;
  const p0 = atStart ? points[0] : points[points.length - 1];
  // First point at least 0.5 mm away gives the riser direction.
  let q: Vec3 | null = null;
  let run = 0;
  for (let k = 1; k < points.length; k++) {
    const p = atStart ? points[k] : points[points.length - 1 - k];
    const d = Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]);
    if (d > 0.5) {
      q = p;
      run = d;
      break;
    }
  }
  if (!q) return null;
  const dir: Vec3 = [(q[0] - p0[0]) / run, (q[1] - p0[1]) / run, (q[2] - p0[2]) / run];
  // How far the wire runs straight on that way (the riser), corner arc included up to ~25°.
  let straight = run;
  for (let k = 1; k < points.length; k++) {
    const p = atStart ? points[k] : points[points.length - 1 - k];
    const d = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
    const along = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
    const off = Math.hypot(d[0] - dir[0] * along, d[1] - dir[1] * along, d[2] - dir[2] * along);
    if (off > Math.max(0.25, along * 0.45)) break;
    straight = Math.max(straight, along);
  }
  return { from: p0, dir, len: Math.max(1.2, Math.min(len, straight)) };
}
