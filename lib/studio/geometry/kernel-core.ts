// The geometry kernel's primitives: manifold-3d solids built from pure outlines.
//
// Both model builders use EXACTLY these: the product kernel
// (product-kernel.ts, SolvedProduct → pieces) and the template enclosure
// (enclosure-kernel.ts, EnclosureDims → base / lid / spike). One set of
// primitives, so a shell is hollowed, split and exported the same way whichever
// path asked for it.
//
// Everything here is a pure function of (manifold module, numbers): no three.js,
// no DOM. Every WASM object is tracked in an Arena and freed by the caller.

import type { CrossSection, Manifold, ManifoldToplevel, Mat4, SimplePolygon } from "manifold-3d";
import { ellipseOutline, rrectOutline, v3, type Vec2, type Vec3 } from "../product/shapes";

/** Position / normal / index arrays of one exported mesh (WORLD coordinates). */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

// ---------------------------------------------------------------------------
// Memory: every WASM object is tracked and freed after the build
// ---------------------------------------------------------------------------

export class Arena {
  private items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  free() {
    for (const x of this.items) {
      try {
        x.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}

export type K = { mf: ManifoldToplevel; a: Arena };

const poly = (pts: Vec2[]): SimplePolygon => pts.map(([x, y]) => [x, y]);

export function cs(k: K, contours: Vec2[][]): CrossSection {
  return k.a.t(new k.mf.CrossSection(contours.map(poly), "NonZero"));
}

export function union(k: K, list: Manifold[]): Manifold {
  if (list.length === 0) return k.a.t(k.mf.Manifold.cube([0.001, 0.001, 0.001]));
  if (list.length === 1) return list[0];
  return k.a.t(k.mf.Manifold.union(list));
}

/** Column-major Mat4 taking +x → u, +y → v, +z → n, origin → t. */
export function frameMat(u: Vec3, v: Vec3, n: Vec3, t: Vec3): Mat4 {
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, t[0], t[1], t[2], 1];
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const LATHE_SEGMENTS = 96;
/** Widest flat ceiling left inside a lathed shell (mm); the rest of the roof is a 45° tent. */
export const ROOF_BRIDGE = 40;

export type Slab = {
  type: "slab";
  h: number;
  fillet: number;
  chamfer: number;
  /** Outline at height share t ∈ [0, 1], inset by `inset` mm. */
  outline: (inset: number, t: number) => Vec2[];
  /** soft_wedge: front height share (top slants down to the front). */
  wedge?: number;
};
export type Lathe = { type: "lathe"; outline: Vec2[]; segments: number };
export type Shape = Slab | Lathe | { type: "custom" };

export function rr(w: number, d: number, r: number): Vec2[] {
  return rrectOutline(Math.max(0.2, w), Math.max(0.2, d), Math.max(0, Math.min(r, w / 2 - 0.05, d / 2 - 0.05)));
}

/** Convex hull of rounded slices: 45° bottom chamfer, rounded top fillet. */
export function slabSolid(k: K, s: Slab, inset: number, z0: number, z1: number, fillet: number, chamfer: number): Manifold {
  const slices: [number, number][] = [];
  if (chamfer > 0.05) slices.push([z0, inset + chamfer], [z0 + chamfer, inset]);
  else slices.push([z0, inset]);
  if (fillet > 0.05) {
    slices.push([z1 - fillet, inset]);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const a = ((i / steps) * Math.PI) / 2;
      slices.push([z1 - fillet + fillet * Math.sin(a), inset + fillet * (1 - Math.cos(a))]);
    }
  } else slices.push([z1, inset]);
  const pts: Vec3[] = [];
  for (const [z, i] of slices) {
    const t = Math.min(1, Math.max(0, z / s.h));
    for (const [x, y] of s.outline(i, t)) {
      let zz = z;
      if (s.wedge !== undefined) {
        const d = Math.max(1e-6, maxY(s) * 2);
        const share = s.wedge + (1 - s.wedge) * Math.min(1, Math.max(0, (y + d / 2) / d));
        zz = z <= 0 ? z : z * share;
      }
      pts.push([x, y, zz]);
    }
  }
  return k.a.t(k.mf.Manifold.hull(pts));
}

function maxY(s: Slab): number {
  return Math.max(...s.outline(0, 0).map((p) => p[1]));
}

/** A lathed outline (half, (r, z)) as a full mirrored silhouette in (x, z). */
function silhouette(half: Vec2[]): Vec2[] {
  const right = half.filter(([r]) => r > 1e-6);
  return [...right, ...[...right].reverse().map(([r, z]) => [-r, z] as Vec2)];
}

export function latheSolid(k: K, s: Lathe): Manifold {
  return k.a.t(cs(k, [silhouette(s.outline)]).revolve(s.segments));
}

export type Mode = "closed" | "open_top" | "open_bottom";

/** The hollow inside a shell, `inset` mm in from the outside. */
export function cavity(k: K, s: Shape, inset: number, mode: Mode): Manifold | null {
  if (s.type === "lathe") {
    const outer = cs(k, [silhouette(s.outline)]);
    let inner = k.a.t(outer.offset(-inset, "Round", 2, 32));
    if (inner.isEmpty()) return null;
    const zTop = Math.max(...s.outline.map((p) => p[1]));
    const right = s.outline.filter(([r]) => r > 1e-6);
    const rTop = right[right.length - 1][0];
    const rBot = right[0][0];
    const B = 400;
    if (mode !== "open_top") {
      // 45° tent roof: the inside slopes at 45° at most, except a flat bridge of at most
      // ROOF_BRIDGE mm across the very top (a short bridge prints cleanly on an MK4).
      const zc = zTop - inset * Math.SQRT2 + ROOF_BRIDGE / 2;
      inner = k.a.t(inner.intersect(cs(k, [[[-B, -B], [B, -B], [B, zc - B], [0, zc], [-B, zc - B]]])));
    }
    if (mode === "open_top" && rTop - inset > 1) {
      const ro = rTop - inset;
      inner = k.a.t(inner.add(cs(k, [[[-ro, zTop - inset - 1], [ro, zTop - inset - 1], [ro, zTop + 5], [-ro, zTop + 5]]])));
    }
    if (mode === "open_bottom" && rBot - inset > 1) inner = k.a.t(inner.add(cs(k, [[[-(rBot - inset), -5], [rBot - inset, -5], [rBot - inset, inset + 1], [-(rBot - inset), inset + 1]]])));
    if (inner.isEmpty()) return null;
    return k.a.t(inner.revolve(s.segments));
  }
  if (s.type === "slab") {
    const w0 = Math.min(...s.outline(inset, 0).map((p) => p[0]));
    if (!Number.isFinite(w0) || -w0 < 1) return null;
    const z0 = mode === "open_bottom" ? -5 : inset;
    const z1 = mode === "open_top" ? s.h + 5 : s.h - inset;
    if (z1 - z0 < 1) return null;
    const fillet = mode === "open_top" ? 0 : Math.max(0, s.fillet - inset);
    return slabSolid(k, s, inset, z0, z1, fillet, 0);
  }
  return null;
}


/** A smooth tube along a polyline: hulls of consecutive spheres, unioned. */
export function sweep(k: K, path: Vec3[], radius: number, segs = 16): Manifold {
  const balls = path.map((p) => k.a.t(k.a.t(k.mf.Manifold.sphere(radius, segs)).translate(p)));
  const parts: Manifold[] = [];
  for (let i = 1; i < balls.length; i++) parts.push(k.a.t(k.mf.Manifold.hull([balls[i - 1], balls[i]])));
  return union(k, parts.length ? parts : balls);
}

// ---------------------------------------------------------------------------

export function basisFor(n: Vec3): { u: Vec3; v: Vec3 } {
  if (Math.abs(n[2]) > 0.7) return { u: [1, 0, 0], v: v3.norm(v3.cross(n, [1, 0, 0])) };
  const u = v3.norm([-n[1], n[0], 0]);
  return { u, v: v3.norm(v3.cross(n, u)) };
}

export function prism(k: K, c: { center: Vec3; normal: Vec3; w: number; h: number; depth: number; round: boolean }): Manifold {
  const n = v3.norm(c.normal);
  const { u, v } = basisFor(n);
  const section = c.round ? cs(k, [ellipseOutline(c.w, c.w, 32)]) : cs(k, [rr(c.w, c.h, Math.min(1, c.w / 2 - 0.1, c.h / 2 - 0.1))]);
  const m = k.a.t(section.extrude(c.depth, 0, 0, [1, 1], true));
  return k.a.t(m.transform(frameMat(u, v, n, c.center)));
}

export function meshArrays(k: K, m: Manifold): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const withN = k.a.t(m.calculateNormals(0, 40));
  const mesh = withN.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const n = vp.length / np;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = vp[i * np];
    positions[i * 3 + 1] = vp[i * np + 1];
    positions[i * 3 + 2] = vp[i * np + 2];
    if (np >= 6) {
      normals[i * 3] = vp[i * np + 3];
      normals[i * 3 + 1] = vp[i * np + 4];
      normals[i * 3 + 2] = vp[i * np + 5];
    }
  }
  const indices = new Uint32Array(mesh.triVerts);
  if (np < 6) faceNormals(positions, indices, normals);
  return { positions, normals, indices };
}

/** Fallback: area-weighted vertex normals. */
function faceNormals(p: Float32Array, idx: Uint32Array, out: Float32Array) {
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ab: Vec3 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
    const ac: Vec3 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const nn = v3.cross(ab, ac);
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) out[v * 3 + q] += nn[q];
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l;
    out[i + 1] /= l;
    out[i + 2] /= l;
  }
}

