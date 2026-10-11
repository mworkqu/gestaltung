// Product geometry kernel (P5-16): SolvedProduct → watertight meshes, one per
// printable piece, built with manifold-3d (WASM) booleans. Runs inside the
// Studio geometry worker (product-job.ts loads manifold-3d lazily there, so it is
// never in first-load JS); vitest runs it in node the same way.
//
//  * every form is built from profiles with real arcs: lathed parts revolve a
//    filleted (r, z) outline with ≥ 64 segments; extruded / lofted parts are the
//    convex hull of rounded slices (soft top fillet, 45° bottom chamfer); tubes are
//    Catmull-Rom sweeps; the nozzle is a swept tube with a bore and a flat flange;
//  * shells: the outline offset inwards by the wall (lathed: a true 2D offset with a
//    45° cone roof so the inside never overhangs; extruded: the same shape inset),
//    open at the top / bottom where a neighbour stacks, or split with a snap lip /
//    screw bosses; cut-outs, pockets and features are subtracted before splitting;
//  * each piece is moved to its world place; the solver's print plan says how it
//    lies on the MK4 bed (lib/studio/product/stl.ts applies it for the STL).
//
// Pure function of (manifold module, solved product): no three.js, no DOM.

import type { CrossSection, Manifold, ManifoldToplevel, Mat4, SimplePolygon } from "manifold-3d";
import { COLOUR_HEX } from "../palette";
import { estGrams, type Colour } from "../schema";
import { grilleHoles } from "../enclosure/cutouts";
import {
  NOZZLE_FLANGE,
  anchorPoint,
  formFrame,
  latheOutlineOf,
  lathedOutline,
  templateProfile,
  WEDGE_FRONT,
  type FormPart,
} from "../product/forms";
import {
  catmullRom,
  ellipseOutline,
  latheOutline,
  nozzlePath,
  r3,
  rrectOutline,
  superellipseOutline,
  tubeBodyPath,
  v3,
  type Vec2,
  type Vec3,
} from "../product/shapes";
import type { PlacedElectronic, PrintPlan, SolvedBody, SolvedCutout, SolvedPiece, SolvedProduct } from "../product/solve";
import type { ProductMaterial } from "../product/schema";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type BuiltPiece = {
  /** Piece id (body id, or `${body}__top` / `${body}__bottom`). */
  id: string;
  bodyId: string;
  piece: SolvedPiece["piece"];
  role: SolvedBody["role"];
  material: ProductMaterial;
  colour: Colour;
  colourHex: string;
  finish: SolvedBody["finish"];
  /** WORLD positions / smooth normals (split at sharp edges) / triangle indices. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangles: number;
  volumeMm3: number;
  grams: number;
  printable: boolean;
  print: PrintPlan;
  /** Full explode offset (body + piece). */
  explode: Vec3;
  /** manifold-3d says the mesh is a closed, oriented 2-manifold. */
  watertight: boolean;
};

export type BuiltLink = {
  id: string;
  kind: "tube" | "cable";
  colour: Colour;
  colourHex: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

export type BuiltProduct = {
  hash: string;
  pieces: BuiltPiece[];
  links: BuiltLink[];
  electronics: PlacedElectronic[];
  bbox: SolvedProduct["bbox"];
  ms: number;
};

// ---------------------------------------------------------------------------
// Memory: every WASM object is tracked and freed after the build
// ---------------------------------------------------------------------------

class Arena {
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

type K = { mf: ManifoldToplevel; a: Arena };

const poly = (pts: Vec2[]): SimplePolygon => pts.map(([x, y]) => [x, y]);

function cs(k: K, contours: Vec2[][]): CrossSection {
  return k.a.t(new k.mf.CrossSection(contours.map(poly), "NonZero"));
}

function union(k: K, list: Manifold[]): Manifold {
  if (list.length === 0) return k.a.t(k.mf.Manifold.cube([0.001, 0.001, 0.001]));
  if (list.length === 1) return list[0];
  return k.a.t(k.mf.Manifold.union(list));
}

/** Column-major Mat4 taking +x → u, +y → v, +z → n, origin → t. */
function frameMat(u: Vec3, v: Vec3, n: Vec3, t: Vec3): Mat4 {
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, t[0], t[1], t[2], 1];
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const LATHE_SEGMENTS = 96;
/** Widest flat ceiling left inside a lathed shell (mm); the rest of the roof is a 45° tent. */
export const ROOF_BRIDGE = 40;

type Slab = {
  type: "slab";
  h: number;
  fillet: number;
  chamfer: number;
  /** Outline at height share t ∈ [0, 1], inset by `inset` mm. */
  outline: (inset: number, t: number) => Vec2[];
  /** soft_wedge: front height share (top slants down to the front). */
  wedge?: number;
};
type Lathe = { type: "lathe"; outline: Vec2[]; segments: number };
type Shape = Slab | Lathe | { type: "custom" };

function rr(w: number, d: number, r: number): Vec2[] {
  return rrectOutline(Math.max(0.2, w), Math.max(0.2, d), Math.max(0, Math.min(r, w / 2 - 0.05, d / 2 - 0.05)));
}

function shapeOf(f: FormPart, joints: { top: boolean; bottom: boolean }): Shape {
  const top = (x: number) => (joints.top ? 0 : x);
  const bottom = (x: number) => (joints.bottom ? 0 : x);
  switch (f.kind) {
    case "lathe_profile":
      return { type: "lathe", outline: latheOutlineOf(f), segments: Math.max(64, f.segments) };
    case "rounded_extrude":
      return {
        type: "slab",
        h: f.h,
        fillet: top(Math.min(f.fillet, f.h / 2)),
        chamfer: bottom(Math.min(1.5, f.fillet, f.h / 3)),
        outline: (i) => (f.shape === "superellipse" ? superellipseOutline(f.w - 2 * i, f.d - 2 * i, f.n, 72) : rr(f.w - 2 * i, f.d - 2 * i, f.r - i)),
      };
    case "loft_rounded":
      return {
        type: "slab",
        h: f.h,
        fillet: top(Math.min(f.fillet, f.h / 2)),
        chamfer: bottom(Math.min(1.5, f.fillet, f.h / 3)),
        outline: (i, t) => {
          const w = f.w0 + (f.w1 - f.w0) * t - 2 * i;
          const d = f.d0 + (f.d1 - f.d0) * t - 2 * i;
          const off = f.shiftY * t + formFrame(f).offset[1];
          const o = f.shape === "ellipse" ? ellipseOutline(w, d, 72) : rr(w, d, f.r - i);
          return o.map(([x, y]) => [x, y + off]);
        },
      };
    case "tank":
      return {
        type: "slab",
        h: f.h,
        fillet: top(Math.min(3, f.h / 4)),
        chamfer: bottom(1),
        outline: (i) => (f.shape === "round" ? ellipseOutline(f.w - 2 * i, f.w - 2 * i, 96) : rr(f.w - 2 * i, f.d - 2 * i, f.r - i)),
      };
    case "enclosure": {
      const prof = templateProfile(f);
      if (prof) return { type: "lathe", outline: lathedOutline(f)!, segments: LATHE_SEGMENTS };
      const fil = top(Math.min(f.fillet, f.h / 3));
      const ch = bottom(Math.min(1.5, f.fillet));
      switch (f.template) {
        case "pill":
          return { type: "slab", h: f.h, fillet: fil, chamfer: ch, outline: (i) => rr(f.w - 2 * i, f.d - 2 * i, Math.min(f.w, f.d) / 2 - i) };
        case "soft_wedge":
          return { type: "slab", h: f.h, fillet: 0, chamfer: ch, outline: (i) => rr(f.w - 2 * i, f.d - 2 * i, f.r - i), wedge: WEDGE_FRONT };
        case "handheld_taper":
          return { type: "slab", h: f.h, fillet: fil, chamfer: ch, outline: (i, t) => rr((f.w - 2 * i) * (1 - 0.12 * t), (f.d - 2 * i) * (1 - 0.06 * t), f.r - i) };
        default:
          return { type: "slab", h: f.h, fillet: fil, chamfer: ch, outline: (i) => rr(f.w - 2 * i, f.d - 2 * i, f.r - i) };
      }
    }
    default:
      return { type: "custom" };
  }
}

/** Convex hull of rounded slices: 45° bottom chamfer, rounded top fillet. */
function slabSolid(k: K, s: Slab, inset: number, z0: number, z1: number, fillet: number, chamfer: number): Manifold {
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

function latheSolid(k: K, s: Lathe): Manifold {
  return k.a.t(cs(k, [silhouette(s.outline)]).revolve(s.segments));
}

type Mode = "closed" | "open_top" | "open_bottom";

/** The hollow inside a shell, `inset` mm in from the outside. */
function cavity(k: K, s: Shape, inset: number, mode: Mode): Manifold | null {
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

// ---------------------------------------------------------------------------
// Custom forms
// ---------------------------------------------------------------------------

/** A smooth tube along a polyline: hulls of consecutive spheres, unioned. */
function sweep(k: K, path: Vec3[], radius: number, segs = 16): Manifold {
  const balls = path.map((p) => k.a.t(k.a.t(k.mf.Manifold.sphere(radius, segs)).translate(p)));
  const parts: Manifold[] = [];
  for (let i = 1; i < balls.length; i++) parts.push(k.a.t(k.mf.Manifold.hull([balls[i - 1], balls[i]])));
  return union(k, parts.length ? parts : balls);
}

function customSolid(k: K, f: FormPart): Manifold {
  const { Manifold: M } = k.mf;
  switch (f.kind) {
    case "stake": {
      const sec =
        f.section === "round"
          ? cs(k, [ellipseOutline(f.width, f.width, 48)])
          : f.section === "blade"
            ? cs(k, [rr(f.width, f.thick, f.thick / 2 - 0.05)])
            : k.a.t(k.mf.CrossSection.union([cs(k, [rr(f.width, f.thick, 0.6)]), cs(k, [rr(f.thick, f.width, 0.6)])]));
      // Extruded narrowing towards its far end, then turned so the narrow tip is at z = 0.
      const m = k.a.t(sec.extrude(f.length, 8, 0, [f.taper, f.taper]));
      return k.a.t(k.a.t(m.rotate([180, 0, 0])).translate([0, 0, f.length]));
    }
    case "prongs": {
      const r = f.d / 2;
      const pin = (x: number) => {
        const body = k.a.t(k.a.t(M.cylinder(f.length - 2 * r, r, r, 24)).translate([x, 0, 2 * r]));
        const tip = k.a.t(M.hull([k.a.t(k.a.t(M.sphere(0.4, 8)).translate([x, 0, 0.4])), k.a.t(k.a.t(M.cylinder(0.01, r, r, 24)).translate([x, 0, 2 * r]))]));
        return union(k, [body, tip]);
      };
      return union(k, [pin(-f.spacing / 2), pin(f.spacing / 2)]);
    }
    case "tube_sweep":
      return sweep(k, tubeBodyPath(f.length, f.bend), f.d / 2, 20);
    case "nozzle": {
      const path = nozzlePath(f.length, f.angle, f.drop);
      const r = f.d / 2;
      // The first ball sits just in front of the flange so nothing pokes out behind it.
      const outer = sweep(k, [[0, Math.min(0, NOZZLE_FLANGE - r), 0], ...path.slice(1)], r, 24);
      const flange = k.a.t(k.a.t(k.a.t(M.cylinder(NOZZLE_FLANGE, 1.4 * r, 1.4 * r, 32)).rotate([-90, 0, 0])).translate([0, 0, 0]));
      const body = union(k, [outer, flange]);
      // Bore: through the flange and out past the tip.
      const tip = path[path.length - 1];
      const prev = path[path.length - 2];
      const out = v3.add(tip, v3.scale(v3.norm(v3.sub(tip, prev)), r + 2));
      const bore = sweep(k, [[0, NOZZLE_FLANGE + 1, 0], ...path.slice(0, -1), out], f.bore / 2, 16);
      return k.a.t(body.subtract(bore));
    }
    case "ring": {
      const outerW = f.w + 2 * f.t;
      const outerD = f.shape === "round" ? outerW : f.d + 2 * f.t;
      const outline = (i: number) => (f.shape === "round" ? ellipseOutline(outerW - 2 * i, outerW - 2 * i, 96) : rr(outerW - 2 * i, outerD - 2 * i, f.r + f.t - i));
      const soft = Math.min(0.8, f.h / 4, f.t / 3);
      const band = slabSolid(k, { type: "slab", h: f.h, fillet: soft, chamfer: soft, outline }, 0, 0, f.h, soft, soft);
      const hole = k.a.t(cs(k, [f.shape === "round" ? ellipseOutline(f.w, f.w, 96) : rr(f.w, f.d, f.r)]).extrude(f.h + 4));
      return k.a.t(band.subtract(k.a.t(hole.translate([0, 0, -2]))));
    }
    case "button_cap": {
      // A soft-edged cap sitting on the surface, plus a plain stem down to the switch
      // (no fillet where they meet: that web would dig into the surface around the hole).
      const R = f.d / 2;
      const head = latheSolid(k, { type: "lathe", outline: latheOutline([[R, 0], [R, f.h * (1 - 0.7 * f.dome)], [R * 0.55, f.h], [0, f.h]], Math.min(1.2, f.h / 3)), segments: 64 });
      const below = f.stem + f.seat;
      if (below <= 0.2) return head;
      const rs = Math.min(2.5, R - 1);
      const stem = k.a.t(M.cylinder(below + 0.5, rs, rs, 32));
      return union(k, [k.a.t(head.translate([0, 0, below])), stem]);
    }
    case "knob": {
      const R = f.d / 2;
      const body = latheSolid(k, { type: "lathe", outline: latheOutline([[R, 0], [R, f.h], [0, f.h]], Math.min(2, f.h / 4)), segments: 72 });
      if (f.flutes < 3) return body;
      const cuts: Manifold[] = [];
      for (let i = 0; i < f.flutes; i++) {
        const a = (2 * Math.PI * i) / f.flutes;
        cuts.push(k.a.t(k.a.t(M.cylinder(f.h, 1.2, 1.2, 12)).translate([(R + 0.4) * Math.cos(a), (R + 0.4) * Math.sin(a), 2])));
      }
      return k.a.t(body.subtract(union(k, cuts)));
    }
    case "grille_disc": {
      const R = f.d / 2;
      const disc = k.a.t(cs(k, [ellipseOutline(f.d, f.d, 72)]).extrude(f.t));
      const holes: Manifold[] = [];
      for (let y = -R; y <= R; y += f.pitch) {
        for (let x = -R; x <= R; x += f.pitch) {
          if (Math.hypot(x, y) + f.hole / 2 > R - 1.2) continue;
          holes.push(k.a.t(k.a.t(M.cylinder(f.t + 2, f.hole / 2, f.hole / 2, 12)).translate([x, y, -1])));
        }
      }
      return holes.length ? k.a.t(disc.subtract(union(k, holes))) : disc;
    }
    case "foot": {
      const R = f.d / 2;
      return latheSolid(k, { type: "lathe", outline: latheOutline([[R, 0], [R, f.h * 0.4], [R * 0.6, f.h], [0, f.h]], Math.min(1.5, f.h / 3)), segments: 48 });
    }
    case "clip_arm": {
      const L = f.length;
      const T = 2 * f.t + f.gap;
      const shape = cs(k, [[[0, 0], [L, 0], [L, T], [0, T], [0, f.t + f.gap], [L - f.t, f.t + f.gap], [L - f.t, f.t], [0, f.t]]]);
      const m = k.a.t(shape.extrude(f.w));
      // (u, v, extrude) → (x = extrude, y = u, z = v), centred.
      return k.a.t(k.a.t(m.transform(frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]))).translate([-f.w / 2, -L / 2, 0]));
    }
    case "hook": {
      const R = f.reach + f.t;
      const lip = Math.min(f.h, f.t + 6);
      const shape = k.a.t(
        k.mf.CrossSection.union([
          cs(k, [[[f.reach, 0], [R, 0], [R, f.h], [f.reach, f.h]]]),
          cs(k, [[[0, 0], [R, 0], [R, f.t], [0, f.t]]]),
          cs(k, [[[0, 0], [f.t, 0], [f.t, lip], [0, lip]]]),
        ]),
      );
      const m = k.a.t(shape.extrude(f.w));
      return k.a.t(k.a.t(m.transform(frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]))).translate([-f.w / 2, -R / 2, 0]));
    }
    case "hinge_lid": {
      const plate = k.a.t(cs(k, [rr(f.w, f.d, f.r)]).extrude(f.t));
      const knuckle = (x0: number) =>
        k.a.t(k.a.t(k.a.t(M.cylinder(f.w / 4, f.t, f.t, 32)).rotate([0, 90, 0])).translate([x0, f.d / 2 - f.t, f.t]));
      return union(k, [plate, knuckle(-f.w / 2 + 4), knuckle(f.w / 4 - 4)]);
    }
    default:
      return k.a.t(M.cube([1, 1, 1], true));
  }
}

function solidOf(k: K, f: FormPart, shape: Shape): Manifold {
  if (shape.type === "lathe") return latheSolid(k, shape);
  if (shape.type === "slab") return slabSolid(k, shape, 0, 0, shape.h, shape.fillet, shape.chamfer);
  const raw = customSolid(k, f);
  const off = formFrame(f).offset;
  return off[0] || off[1] || off[2] ? k.a.t(raw.translate(off)) : raw;
}

// ---------------------------------------------------------------------------
// Cut-outs, pockets, features
// ---------------------------------------------------------------------------

function basisFor(n: Vec3): { u: Vec3; v: Vec3 } {
  if (Math.abs(n[2]) > 0.7) return { u: [1, 0, 0], v: v3.norm(v3.cross(n, [1, 0, 0])) };
  const u = v3.norm([-n[1], n[0], 0]);
  return { u, v: v3.norm(v3.cross(n, u)) };
}

function prism(k: K, c: { center: Vec3; normal: Vec3; w: number; h: number; depth: number; round: boolean }): Manifold {
  const n = v3.norm(c.normal);
  const { u, v } = basisFor(n);
  const section = c.round ? cs(k, [ellipseOutline(c.w, c.w, 32)]) : cs(k, [rr(c.w, c.h, Math.min(1, c.w / 2 - 0.1, c.h / 2 - 0.1))]);
  const m = k.a.t(section.extrude(c.depth, 0, 0, [1, 1], true));
  return k.a.t(m.transform(frameMat(u, v, n, c.center)));
}

function cutoutSolid(k: K, c: SolvedCutout): Manifold {
  if (c.grille) {
    const n = v3.norm(c.normal);
    const { u, v } = basisFor(n);
    const holes = grilleHoles(c.w, c.h, c.grille.hole, c.grille.pitch).map((hole) =>
      prism(k, { center: v3.add(c.center, v3.add(v3.scale(u, hole.u), v3.scale(v, hole.v))), normal: n, w: hole.d, h: hole.d, depth: c.depth, round: true }),
    );
    return union(k, holes);
  }
  return prism(k, c);
}

function featureSolids(k: K, b: SolvedBody): Manifold[] {
  const out: Manifold[] = [];
  const [w, d, h] = formFrame(b.form).size;
  for (const f of b.features) {
    const face = f.face ?? (f.kind === "drain_holes" ? "bottom" : "front");
    const ap = anchorPoint(b.form, face);
    const n = ap.n;
    const depth = 2 * b.wall + 2;
    const at = v3.sub(ap.p, v3.scale(n, b.wall / 2));
    const { u, v } = basisFor(n);
    const span = face === "top" || face === "bottom" ? Math.min(w, d) : face === "front" || face === "back" ? Math.min(w, h) : Math.min(d, h);
    switch (f.kind) {
      case "grille": {
        const count = f.count ?? 16;
        const side = Math.max(1, Math.round(Math.sqrt(count)));
        const pitch = Math.min(4, (0.5 * span) / side);
        if (pitch < 2.4) break;
        const holes = grilleHoles(side * pitch, side * pitch, Math.min(1.8, pitch - 1.2), pitch);
        for (const q of holes) out.push(prism(k, { center: v3.add(at, v3.add(v3.scale(u, q.u), v3.scale(v, q.v))), normal: n, w: q.d, h: q.d, depth, round: true }));
        break;
      }
      case "light_slot": {
        const count = Math.min(6, f.count ?? 3);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 4;
          out.push(prism(k, { center: v3.add(at, v3.scale(v, off)), normal: n, w: Math.min(14, 0.4 * span), h: 1.6, depth, round: false }));
        }
        break;
      }
      case "drain_holes": {
        const count = Math.min(6, f.count ?? 2);
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 10;
          out.push(prism(k, { center: v3.add(at, v3.scale(u, off)), normal: n, w: 3, h: 3, depth, round: true }));
        }
        break;
      }
      case "texture_grip": {
        // Shallow vertical grooves on this face and the opposite one.
        const count = Math.min(16, f.count ?? 8);
        for (const sgn of [1, -1]) {
          const nn = v3.scale(n, sgn);
          const base = sgn === 1 ? ap.p : anchorPoint(b.form, oppositeFace(face)).p;
          const { u: uu } = basisFor(nn);
          for (let i = 0; i < count; i++) {
            const off = (i - (count - 1) / 2) * 3;
            out.push(prism(k, { center: v3.add(base, v3.scale(uu, off)), normal: nn, w: 1.6, h: Math.max(4, 0.5 * h), depth: 1.6, round: false }));
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function oppositeFace(f: string): "top" | "bottom" | "front" | "back" | "left" | "right" {
  return ({ top: "bottom", bottom: "top", front: "back", back: "front", left: "right", right: "left" } as const)[f as "top"];
}

// ---------------------------------------------------------------------------
// Bodies → pieces
// ---------------------------------------------------------------------------

function gramsFor(volume: number, material: ProductMaterial): number {
  if (material === "aluminium") return 0;
  return estGrams(volume, material === "resin_clear" ? "PETG" : material);
}

type RawPiece = { piece: SolvedPiece; m: Manifold };

function buildBody(k: K, b: SolvedBody): RawPiece[] {
  const shape = shapeOf(b.form, b.joints);
  let m = solidOf(k, b.form, shape);
  const hollow = b.shell !== "solid" && shape.type !== "custom";
  if (hollow) {
    const mode: Mode = b.shell === "split" ? "closed" : (b.shell as Mode);
    const cav = cavity(k, shape, b.wall, mode);
    if (cav) m = k.a.t(m.subtract(cav));
  }
  if (b.form.kind === "tank" && b.form.window) {
    // Water-level window: a shallow vertical groove on the front (printed thin = see-through in PETG).
    const [, d, h] = formFrame(b.form).size;
    const groove = k.a.t(k.a.t(k.mf.Manifold.cube([8, 1.6, 0.55 * h], true)).translate([0, -d / 2, 0.45 * h]));
    m = k.a.t(m.subtract(groove));
  }
  const cuts: Manifold[] = [
    ...b.cutouts.map((c) => cutoutSolid(k, c)),
    ...b.pockets.map((p) => k.a.t(k.a.t(k.mf.Manifold.cube(p.size, true)).translate(p.center))),
    ...featureSolids(k, b),
  ];
  if (cuts.length) m = k.a.t(m.subtract(union(k, cuts)));

  // Snap lip into the layer stacked on an open top (head → light ring → cap).
  if (hollow && b.lip && b.shell === "open_top") {
    const h = formFrame(b.form).size[2];
    const slab = (z0: number, z1: number) => k.a.t(k.a.t(k.mf.Manifold.cube([1000, 1000, z1 - z0])).translate([-500, -500, z0]));
    const fuseOuter = cavity(k, shape, Math.max(0.6, b.wall - 0.3), "open_top");
    const lipOuter = cavity(k, shape, b.lip.inset, "open_top");
    const lipInner = cavity(k, shape, b.lip.inset + 1.2, "open_top");
    if (fuseOuter && lipOuter && lipInner) {
      const fuse = k.a.t(k.a.t(fuseOuter.intersect(slab(h - 2, h))).subtract(lipInner));
      const lip = k.a.t(k.a.t(lipOuter.intersect(slab(h, h + b.lip.height))).subtract(lipInner));
      m = union(k, [m, fuse, lip]);
    }
  }

  if (!b.split) return [{ piece: b.pieces[0], m }];
  const z = b.split.z;
  const [above, below] = m.splitByPlane([0, 0, 1], z);
  k.a.t(above);
  k.a.t(below);
  let bottom = below;
  let top = above;
  if (hollow) {
    if (b.split.joint === "snap_lip") {
      const slab = (z0: number, z1: number) => k.a.t(k.a.t(k.mf.Manifold.cube([1000, 1000, z1 - z0])).translate([-500, -500, z0]));
      const fuseOuter = cavity(k, shape, Math.max(0.6, b.wall - 0.3), "closed");
      const lipOuter = cavity(k, shape, b.wall + 0.2, "closed");
      const lipInner = cavity(k, shape, b.wall + 1.4, "closed");
      if (fuseOuter && lipOuter && lipInner) {
        const fuse = k.a.t(k.a.t(fuseOuter.intersect(slab(z - 2, z))).subtract(lipInner));
        const lip = k.a.t(k.a.t(lipOuter.intersect(slab(z, z + 3))).subtract(lipInner));
        bottom = union(k, [bottom, fuse, lip]);
      }
    } else {
      const [w, d] = formFrame(b.form).size;
      const round = shape.type === "lathe";
      const spots: [number, number][] = round
        ? [45, 135, 225, 315].map((a) => [0.32 * w * Math.cos((a * Math.PI) / 180), 0.32 * w * Math.sin((a * Math.PI) / 180)])
        : [[-0.36 * w, -0.36 * d], [0.36 * w, -0.36 * d], [-0.36 * w, 0.36 * d], [0.36 * w, 0.36 * d]];
      const inside = cavity(k, shape, Math.max(0.6, b.wall - 0.3), "closed");
      if (inside) {
        const bosses = union(k, spots.map(([x, y]) => k.a.t(k.a.t(k.mf.Manifold.cylinder(z - b.wall + 0.3, 3.2, 3.2, 24)).translate([x, y, b.wall - 0.3]))));
        const holes = union(k, spots.map(([x, y]) => k.a.t(k.a.t(k.mf.Manifold.cylinder(z, 1.25, 1.25, 16)).translate([x, y, b.wall + 1]))));
        bottom = union(k, [bottom, k.a.t(k.a.t(bosses.intersect(inside)).subtract(holes))]);
        const through = union(k, spots.map(([x, y]) => k.a.t(k.a.t(k.mf.Manifold.cylinder(1000, 1.5, 1.5, 16)).translate([x, y, z - 1]))));
        top = k.a.t(top.subtract(through));
      }
    }
  }
  const pieceOf = (p: "bottom" | "top") => b.pieces.find((q) => q.piece === p)!;
  return [
    { piece: pieceOf("bottom"), m: bottom },
    { piece: pieceOf("top"), m: top },
  ];
}

function meshArrays(k: K, m: Manifold): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
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

/**
 * Build every printable piece and every tube of a solved product. `mf` is an initialised
 * manifold-3d module (product-job.ts loadManifold()). Never mutates `solved`.
 */
export function buildProductMeshes(mf: ManifoldToplevel, solved: SolvedProduct): BuiltProduct {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const k: K = { mf, a: new Arena() };
  try {
    const pieces: BuiltPiece[] = [];
    for (const b of solved.bodies) {
      for (const raw of buildBody(k, b)) {
        const world = k.a.t(k.a.t(raw.m.rotate(b.rotation)).translate(b.position));
        const status = world.status();
        const arrays = meshArrays(k, world);
        const volume = Math.abs(world.volume());
        pieces.push({
          id: raw.piece.id,
          bodyId: b.id,
          piece: raw.piece.piece,
          role: b.role,
          material: b.material,
          colour: b.colour,
          colourHex: COLOUR_HEX[b.colour],
          finish: b.finish,
          ...arrays,
          triangles: arrays.indices.length / 3,
          volumeMm3: r3(volume),
          grams: gramsFor(volume, b.material),
          printable: b.printable,
          print: raw.piece.print,
          explode: v3.add(b.explode, raw.piece.explode),
          watertight: status === "NoError" && !world.isEmpty(),
        });
      }
    }
    const links: BuiltLink[] = solved.links.map((l, i) => {
      const path = catmullRom(l.points, 40);
      const tube = sweep(k, path, l.diameter / 2, 16);
      return { id: `link_${i + 1}`, kind: l.kind, colour: l.colour, colourHex: COLOUR_HEX[l.colour], ...meshArrays(k, tube) };
    });
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    return { hash: solved.hash, pieces, links, electronics: solved.electronics, bbox: solved.bbox, ms };
  } finally {
    k.a.free();
  }
}

/**
 * Real intersections between different bodies (mm³), from the solid geometry: the
 * "no intersecting bodies" check of the tests and the Engineer view. Touching faces
 * give 0; anything above `minVolume` is listed.
 */
export function measureOverlaps(mf: ManifoldToplevel, solved: SolvedProduct, minVolume = 1): { a: string; b: string; volume: number }[] {
  const k: K = { mf, a: new Arena() };
  try {
    const bodies = solved.bodies.map((b) => {
      const pieces = buildBody(k, b).map((raw) => k.a.t(k.a.t(raw.m.rotate(b.rotation)).translate(b.position)));
      return { id: b.id, box: b.box, m: union(k, pieces) };
    });
    const out: { a: string; b: string; volume: number }[] = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const A = bodies[i];
        const B = bodies[j];
        const apart = [0, 1, 2].some((q) => A.box.max[q] + 4 < B.box.min[q] || B.box.max[q] + 4 < A.box.min[q]);
        if (apart) continue;
        const v = Math.abs(k.a.t(A.m.intersect(B.m)).volume());
        if (v > minVolume) out.push({ a: A.id, b: B.id, volume: r3(v) });
      }
    }
    return out;
  } finally {
    k.a.free();
  }
}

/** Every transferable buffer of a built product (postMessage). */
export function productTransferables(p: BuiltProduct): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const m of [...p.pieces, ...p.links]) for (const a of [m.positions, m.normals, m.indices]) if (a.buffer instanceof ArrayBuffer) out.add(a.buffer);
  return [...out];
}
