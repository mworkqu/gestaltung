// Product solver (P5-16): ProductModel + the chosen parts → SolvedProduct.
// Pure and deterministic (no three.js, no WASM, no randomness, no clock):
// the same input always gives the same output and the same `hash`.
//
//  1. clamp the model (never throws);
//  2. make sure every part has a physical home: pump → a reservoir (+ tube +
//     nozzle), soil probe → the stake (+ probe pins), LEDs → a clear light ring /
//     window, buttons → a button cap;
//  3. fit the electronics: the Studio layout packer (lib/studio/layout.ts) runs for
//     the electronics host and the host grows until the pack fits inside its wall
//     (+ clearance); too big → the battery moves to a base / handle; the pump goes
//     in the reservoir, the soil probe in the stake;
//  4. stack outlines (a light ring or lid stacked on the head takes its outline);
//  5. place every body by its anchor (no floating: offsets along the anchor normal
//     are snapped away), world bounding boxes, no overlap / scene checks;
//  6. ports from the library `ports` → cut-outs on the body the user can reach;
//     button caps get their stem to the switch; tubes get their path;
//  7. printability: shells split top/bottom (snap lip or screw bosses), each piece's
//     print pose (≤ 45° overhang where possible), fits a Prusa MK4, grams;
//  8. explode vectors; issues[] for the Engineer view; solvedHash.

import { estGrams, type ClampLog, type LibraryPart, type PortKind, type ProductSpec } from "../schema";
import {
  isBattery,
  isRoundSensorPort,
  layoutComponents,
  openingSize,
  rotateFace,
  rotateXY,
  rotatedSize,
  type LayoutInput,
  type RotZ,
} from "../layout";
import { portLocal } from "../enclosure/cutouts";
import { hashText, stableJson } from "../geometry/key";
import {
  ANCHORS,
  ANCHOR_NORMAL,
  HOLLOW_FORMS,
  anchorPoint,
  boxFits,
  fitHeight,
  insideSection,
  formFrame,
  isRoundForm,
  matchOutline,
  overhangDeg,
  scaleForm,
  sectionAt,
  solidVolume,
  stackOutline,
  topAt,
  type Anchor,
  type FormPart,
  type PrintPose,
} from "./forms";
import { clampBody, clampProductModel, type Archetype, type Body, type BodyRole, type Link, type ProductMaterial, type ProductModel, type Scene, type Shell } from "./schema";
import { POT, SCENE_METRICS, obstacleHit, plantPot, type Footprint, type SceneMetrics } from "./scene";
import { POWER_PORTS, isButtonPart, isLight, isPump, isSoilProbe } from "./parts";
import {
  boxGap,
  boxOverlap,
  catmullRom,
  eulerFromMatrix,
  matMul,
  polylineLength,
  r3,
  r3v,
  rotate,
  rotationMatrix,
  transformBox,
  transpose,
  v3,
  type Box3,
  type Vec3,
} from "./shapes";

// ---------------------------------------------------------------------------
// Output types (the contract Phase 2a / 2b and the kernel read)
// ---------------------------------------------------------------------------

/** Prusa MK4 build volume (mm). */
export const MK4_BED = { x: 250, y: 210, z: 220 } as const;
/** Gap kept around the electronics inside a host (mm). */
export const ELECTRONICS_CLEARANCE = 2;
/** Default shell wall (mm). */
export const DEFAULT_WALL = 2;
/** Gap between a lip and the wall it slides into (mm). */
export const LIP_GAP = 0.2;

export type IssueSeverity = "info" | "warn" | "error";
export type SolverIssue = { code: string; severity: IssueSeverity; body?: string; detail?: string };

export type CutoutKind = PortKind | "stem" | "pass" | "tube_inlet";
/** An opening through a body's wall, in that body's LOCAL frame. The prism runs along `normal`. */
export type SolvedCutout = {
  kind: CutoutKind;
  instanceId?: string;
  center: Vec3;
  normal: Vec3;
  /** Width (horizontal on side faces, x on top faces) and height of the opening (mm). */
  w: number;
  h: number;
  depth: number;
  round: boolean;
  /** Speaker grille: a grid of holes instead of one opening. */
  grille?: { hole: number; pitch: number };
};

/** A box removed from a solid body (a slot holding a part), body LOCAL frame. */
export type SolvedPocket = { center: Vec3; size: Vec3; instanceId?: string };

export type PrintPlan = {
  pose: PrintPose;
  /** World → print bed rotation (row-major 3×3). Apply to the WORLD mesh, then drop it on z = 0. */
  matrix: number[];
  /** Size on the bed (mm). */
  size: Vec3;
  fits: boolean;
  overhangDeg: number;
};

export type SolvedPiece = {
  /** Mesh id: the body id, or `${bodyId}__top` / `${bodyId}__bottom` for split shells. */
  id: string;
  piece: "whole" | "bottom" | "top";
  print: PrintPlan;
  /** Extra explode for this piece on top of the body's (the lid half lifts more). */
  explode: Vec3;
};

export type ResolvedShell = Exclude<Shell, "auto">;

export type SolvedBody = {
  id: string;
  role: BodyRole;
  form: FormPart;
  material: ProductMaterial;
  colour: Body["colour"];
  finish: Body["finish"];
  features: NonNullable<Body["features"]>;
  parent: string | null;
  anchor: Anchor | null;
  /** World transform: p_world = rotation · p_local + position (rotation = Euler deg, X then Y then Z). */
  position: Vec3;
  rotation: Vec3;
  matrix: number[];
  box: Box3;
  wall: number;
  shell: ResolvedShell;
  /** Flat edges where a neighbour is stacked (no fillet / chamfer there). */
  joints: { top: boolean; bottom: boolean };
  /** Split height (LOCAL z) and how the halves join. */
  split: { z: number; joint: "snap_lip" | "screw_bosses" } | null;
  /**
   * Open-topped shell with a layer stacked on it (head → light ring → cap): a snap lip
   * rises `height` mm above its top, `inset` mm in from its outline, into the layer above.
   */
  lip: { inset: number; height: number } | null;
  cutouts: SolvedCutout[];
  pockets: SolvedPocket[];
  /** Printed by us (false = bought: aluminium probe pins). */
  printable: boolean;
  pieces: SolvedPiece[];
  estGrams: number;
  explode: Vec3;
  /** Part instances inside this body. */
  hosts: string[];
};

export type SolvedLink = Link & { points: Vec3[]; length: number };

/** A part placed in the product. pos = where the part's own origin (bottom centre) goes. */
export type PlacedElectronic = {
  instanceId: string;
  partId: string;
  body: string;
  pos: Vec3;
  /** Euler degrees, applied X then Y then Z (three.js order "ZYX"). */
  rot: Vec3;
  matrix: number[];
  dims: Vec3;
  explode: Vec3;
};

export type SolvedProduct = {
  version: 1;
  /** The model after the solver's changes (grown host, added bodies…): what to store. */
  model: ProductModel;
  scene: Scene;
  /** The scene as solved (plant pot widened to fit the product): what the viewer draws. */
  stage: SceneMetrics;
  bodies: SolvedBody[];
  links: SolvedLink[];
  electronics: PlacedElectronic[];
  /** Parts that could not be placed (also in issues). */
  unplaced: string[];
  bbox: Box3;
  issues: SolverIssue[];
  /** Hash of everything above (cache key for the kernel and the preview pictures). */
  hash: string;
};

export type SolveOptions = {
  spec?: ProductSpec;
  /** Clamp log of the input model (admin only). */
  log?: ClampLog;
};

// ---------------------------------------------------------------------------
// Part classification
// ---------------------------------------------------------------------------

const USB_KINDS = POWER_PORTS;

/** Where each archetype wants its USB / power socket (WORLD direction). */
const USB_FACE: Record<Archetype, Vec3> = {
  stake_device: [0, 1, 0],
  planter_insert: [0, 1, 0],
  desk_object: [0, 1, 0],
  lamp: [0, 1, 0],
  wall_mount: [0, 0, -1],
  handheld: [0, 1, 0],
  wearable_band: [1, 0, 0],
  pet_feeder: [0, 1, 0],
  dispenser: [0, 1, 0],
  vehicle_mount: [0, 0, -1],
  outdoor_box: [0, 0, -1],
  tabletop_robot: [0, 1, 0],
};

const FACE_VEC: Record<string, Vec3> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function localBox(f: FormPart): Box3 {
  const [w, d, h] = formFrame(f).size;
  return { min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, h] };
}

function fitsMk4(size: Vec3): boolean {
  const [a, b] = [Math.max(size[0], size[1]), Math.min(size[0], size[1])];
  return a <= MK4_BED.x + 1e-6 && b <= MK4_BED.y + 1e-6 && size[2] <= MK4_BED.z + 1e-6;
}

const POSE_ROT: Record<PrintPose, Vec3> = { upright: [0, 0, 0], flipped: [180, 0, 0], on_side: [90, 0, 0] };

function poseSize(size: Vec3, pose: PrintPose): Vec3 {
  return pose === "on_side" ? [size[0], size[2], size[1]] : size;
}

function gramsFor(volume: number, material: ProductMaterial): number {
  if (material === "aluminium") return 0;
  if (material === "resin_clear") return estGrams(volume, "PETG");
  return estGrams(volume, material);
}

/** Opposite-facing anchor of a (rotated) child for a surface normal. */
function contactAnchor(m: number[], surfaceNormal: Vec3): Anchor {
  let best: Anchor = "bottom";
  let bestDot = Infinity;
  for (const a of ANCHORS) {
    const d = v3.dot(rotate(m, ANCHOR_NORMAL[a]), surfaceNormal);
    if (d < bestDot - 1e-9) {
      bestDot = d;
      best = a;
    }
  }
  return best;
}

/** Split an offset (parent LOCAL axes) into the slide along an anchor face (du, dv) and the push off it. */
function splitOffset(anchor: Anchor, o: Vec3): { du: number; dv: number; push: number } {
  switch (anchor) {
    case "top":
      return { du: o[0], dv: o[1], push: o[2] };
    case "bottom":
      return { du: o[0], dv: o[1], push: -o[2] };
    case "front":
      return { du: o[0], dv: o[2], push: -o[1] };
    case "back":
      return { du: o[0], dv: o[2], push: o[1] };
    case "left":
      return { du: o[1], dv: o[2], push: -o[0] };
    case "right":
      return { du: o[1], dv: o[2], push: o[0] };
  }
}

/**
 * A child stacked on its parent's top as the next layer of one shell (head → light
 * ring → cap): both have an outline there, the child sits centred and its outline is
 * within 15 % of the parent's. A small part merely sitting on top (a lens, a hopper on
 * a base) is not a layer.
 */
function isStacked(child: Body, parent: Body | undefined): boolean {
  if (!parent || child.attach.anchor !== "top") return false;
  if (Math.abs(child.attach.offset[0]) > 1 || Math.abs(child.attach.offset[1]) > 1) return false;
  if (child.role === "button_cap" || child.role === "window") return false;
  const a = stackOutline(parent.form, "top");
  const b = stackOutline(child.form, "bottom");
  if (!a || !b) return false;
  const ratio = (x: number, y: number) => Math.min(x, y) / Math.max(x, y);
  return ratio(a.w, b.w) >= 0.85 && ratio(a.d, b.d) >= 0.85;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

type Placement = { matrix: number[]; position: Vec3; box: Box3; normal: Vec3 | null };

function placeBodies(bodies: Body[], scene: SceneMetrics, issues: SolverIssue[], note: boolean): Map<string, Placement> {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const out = new Map<string, Placement>();
  let guard = 0;
  while (out.size < bodies.length && guard++ < bodies.length + 2) {
    for (const b of bodies) {
      if (out.has(b.id)) continue;
      const m = rotationMatrix(b.attach.rotate);
      const parent = byId.get(b.attach.to);
      if (parent && !out.has(parent.id)) continue;
      let target: Vec3;
      let surfaceNormal: Vec3;
      let attachNormal: Vec3 | null = null;
      if (!parent) {
        const o = b.attach.offset;
        if (b.attach.to === "scene" && b.attach.anchor === "back") {
          surfaceNormal = [0, -1, 0];
          if (note && Math.abs(o[1]) > 1e-9) issues.push({ code: "snapped_offset", severity: "info", body: b.id, detail: "against the wall" });
          target = [o[0], scene.wallY, scene.mountZ + o[2]];
        } else {
          surfaceNormal = [0, 0, 1];
          const baseZ = b.attach.to === "scene" ? scene.floorZ : scene.groundZ;
          let z = o[2];
          // Only a stake may go into the ground (and only down); everything else stands on it.
          if (b.role === "stake" && b.attach.to === "ground") z = Math.min(0, z);
          else if (Math.abs(z) > 1e-9) {
            if (note) issues.push({ code: "snapped_offset", severity: "info", body: b.id, detail: "onto the ground" });
            z = 0;
          }
          target = [o[0], o[1], baseZ + z];
        }
      } else {
        const p = out.get(parent.id)!;
        const { du, dv, push } = splitOffset(b.attach.anchor, b.attach.offset);
        if (note && Math.abs(push) > 0.5) issues.push({ code: "snapped_offset", severity: "info", body: b.id, detail: `touching ${parent.id}` });
        const ap = anchorPoint(parent.form, b.attach.anchor, du, dv);
        // On a curved top (a dome) a flat-bottomed part rests on the highest point under it.
        if (b.attach.anchor === "top" && b.role !== "button_cap") {
          const [cw, cd] = formFrame(b.form).size;
          const R = Math.max(cw, cd) / 2;
          let high = ap.p[2];
          for (let i = 0; i < 24; i++) {
            const a = (2 * Math.PI * i) / 24;
            for (const rr of [R / 2, R]) high = Math.max(high, topAt(parent.form, du + rr * Math.cos(a), dv + rr * Math.sin(a)));
          }
          if (high - ap.p[2] > 0.01) ap.p = [ap.p[0], ap.p[1], r3(high)];
        }
        target = v3.add(p.position, rotate(p.matrix, ap.p));
        surfaceNormal = v3.norm(rotate(p.matrix, ap.n));
        attachNormal = surfaceNormal;
      }
      const c = contactAnchor(m, surfaceNormal);
      const pc = anchorPoint(b.form, c).p;
      const position = r3v(v3.sub(target, rotate(m, pc)));
      out.set(b.id, { matrix: m, position, box: transformBox(localBox(b.form), m, position), normal: attachNormal });
    }
  }
  return out;
}

const toLocal = (pl: Placement, p: Vec3): Vec3 => rotate(transpose(pl.matrix), v3.sub(p, pl.position));
const toWorld = (pl: Placement, p: Vec3): Vec3 => v3.add(pl.position, rotate(pl.matrix, p));

// ---------------------------------------------------------------------------
// Electronics fit
// ---------------------------------------------------------------------------

type HostFit = {
  form: FormPart;
  ok: boolean;
  items: { instanceId: string; part: LibraryPart; pos: Vec3; rotZ: RotZ }[];
  /** Plan scale vs the input form (1 = unchanged). */
  grew: number;
};

function topLimit(f: FormPart, wall: number, shell: ResolvedShell): number {
  const h = formFrame(f).size[2];
  if (f.kind === "tank") return h - f.lidH;
  return shell === "open_top" ? h : h - wall;
}

/** Widest section between z0 and z1 (for growth estimates). */
function widestSection(f: FormPart, wall: number, z0: number, z1: number) {
  let best: ReturnType<typeof sectionAt> = null;
  let score = -1;
  for (let k = 0; k <= 24; k++) {
    const z = z0 + ((z1 - z0) * k) / 24;
    const s = sectionAt(f, z, wall);
    if (!s) continue;
    const v = s.kind === "round" ? s.r * s.r * 2 : s.hw * s.hd * 4;
    if (v > score) {
      score = v;
      best = s;
    }
  }
  return best;
}

/**
 * Pack `items` with the Studio layout packer, turn the pack so its USB ports face
 * `prefLocal`, and grow the form until the pack (+ clearance) fits inside the wall.
 */
function fitInside(form0: FormPart, wall: number, shell: ResolvedShell, items: LayoutInput[], prefLocal: Vec3 | null): HostFit {
  if (items.length === 0) return { form: form0, ok: true, items: [], grew: 1 };
  const c = ELECTRONICS_CLEARANCE;
  const lr = layoutComponents(items, { clearance: c });
  const partOf = new Map(items.map((it) => [it.instanceId, it.part]));
  let rot: RotZ = 0;
  if (prefLocal) {
    let bestScore = -Infinity;
    for (const r of [0, 90, 180, 270] as RotZ[]) {
      let s = 0;
      for (const it of lr.layout) {
        const part = partOf.get(it.instanceId)!;
        for (const p of part.ports) {
          if (!USB_KINDS.includes(p.kind) || p.face === "+z") continue;
          const f = rotateFace(rotateFace(p.face, it.rotZ), r);
          s += v3.dot(FACE_VEC[f], prefLocal);
        }
      }
      if (s > bestScore + 1e-9) {
        bestScore = s;
        rot = r;
      }
    }
  }
  const placed = lr.layout.map((it) => {
    const [x, y] = rotateXY(it.pos[0], it.pos[1], rot);
    return { instanceId: it.instanceId, part: partOf.get(it.instanceId)!, pos: [x, y, it.pos[2]] as Vec3, rotZ: (((it.rotZ + rot) % 360) as RotZ) };
  });
  const swap = rot === 90 || rot === 270;
  const W = (swap ? lr.footprint.d : lr.footprint.w) + 2 * c;
  const D = (swap ? lr.footprint.w : lr.footprint.d) + 2 * c;
  const H = lr.height + c;

  let form = form0;
  const w0 = formFrame(form0).size[0];
  let z0: number | null = null;
  for (let iter = 0; iter < 16; iter++) {
    const lim = topLimit(form, wall, shell);
    z0 = fitHeight(form, W, D, H, wall, lim);
    if (z0 !== null) break;
    const h = formFrame(form).size[2];
    const usable = lim - wall;
    let sz = usable < H * 1.05 ? Math.min(2, (H * 1.08 + (h - usable)) / h) : 1;
    const sec = widestSection(form, wall, wall, lim);
    let sx = 1;
    let sy = 1;
    if (!boxFits(sec, W * 1.02, D * 1.02)) {
      if (!sec) sx = sy = 1.25;
      else if (sec.kind === "round") sx = sy = Math.min(2, (Math.hypot(W / 2, D / 2) * 1.03 + wall) / (sec.r + wall));
      else {
        sx = Math.max(1, Math.min(2, (W / 2 * 1.03 + wall) / (sec.hw + wall)));
        sy = Math.max(1, Math.min(2, (D / 2 * 1.03 + wall) / (sec.hd + wall)));
        if (sx === 1 && sy === 1) sx = sy = 1.06; // the rounded corners are in the way
      }
    }
    if (sx <= 1.0001 && sy <= 1.0001 && sz <= 1.0001) sx = sy = sz = 1.05; // a narrowing shape: grow all round
    const next = scaleForm(form, sx, sy, sz);
    if (stableJson(next) === stableJson(form)) break; // at its maximum size
    form = next;
  }
  if (z0 === null) return { form, ok: false, items: [], grew: formFrame(form).size[0] / w0 };
  // Centre of the section (a lofted shape leans with shiftY).
  const fr = formFrame(form);
  let yc = 0;
  if (form.kind === "loft_rounded") yc = form.shiftY * ((z0 + H / 2) / form.h) + fr.offset[1];
  const lift = z0 + c / 2;
  const out = placed.map((p) => ({ ...p, pos: [r3(p.pos[0]), r3(p.pos[1] + yc), r3(p.pos[2] + lift)] as Vec3 }));
  return { form, ok: true, items: out, grew: formFrame(form).size[0] / w0 };
}

/** AABB of a placed item (host local). */
function itemBox(it: { part: LibraryPart; pos: Vec3; rotZ: RotZ }): Box3 {
  const [w, d] = rotatedSize(it.part, it.rotZ);
  return { min: [it.pos[0] - w / 2, it.pos[1] - d / 2, it.pos[2]], max: [it.pos[0] + w / 2, it.pos[1] + d / 2, it.pos[2] + it.part.dims.z] };
}

/** Distance from the axis to the inside (inset) / outside (inset 0) of the form along a horizontal direction. */
function extentAlong(f: FormPart, z: number, inset: number, axis: 0 | 1, lateral: number): number {
  const s = sectionAt(f, z, inset);
  if (!s) return 0;
  if (s.kind === "round") return Math.sqrt(Math.max(0, s.r * s.r - lateral * lateral));
  return axis === 0 ? s.hw : s.hd;
}

/** Move parts with a side port out to the wall they face (so a cable reaches them). */
function pushToWalls(form: FormPart, wall: number, items: HostFit["items"]): void {
  for (const it of items) {
    const port = it.part.ports.filter((p) => p.face !== "+z").sort((a, b) => b.size.w * b.size.h - a.size.w * a.size.h)[0];
    if (!port) continue;
    const face = rotateFace(port.face, it.rotZ);
    const n = FACE_VEC[face];
    const axis = n[0] !== 0 ? 0 : 1;
    const sign = n[axis];
    const b = itemBox(it);
    const halfAlong = (b.max[axis] - b.min[axis]) / 2;
    const lat0 = Math.abs(it.pos[1 - axis]) + (b.max[1 - axis] - b.min[1 - axis]) / 2;
    const zMid = it.pos[2] + it.part.dims.z / 2;
    const inner = Math.min(extentAlong(form, it.pos[2], wall, axis, lat0), extentAlong(form, zMid, wall, axis, lat0), extentAlong(form, it.pos[2] + it.part.dims.z, wall, axis, lat0));
    const faceAt = it.pos[axis] * sign + halfAlong;
    const shift = inner - faceAt - 0.5;
    if (shift <= 0.05) continue;
    const next = [...it.pos] as Vec3;
    next[axis] = r3(it.pos[axis] + sign * shift);
    const moved = itemBox({ ...it, pos: next });
    const clash = items.some((o) => {
      if (o === it) return false;
      const ov = boxOverlap(moved, itemBox(o));
      return ov[0] > 0.01 && ov[1] > 0.01 && ov[2] > 0.01;
    });
    if (!clash) it.pos = next;
  }
}

// ---------------------------------------------------------------------------
// Ensure every part has a physical home
// ---------------------------------------------------------------------------

function freshId(bodies: Body[], base: string): string {
  const ids = new Set(bodies.map((b) => b.id));
  let id = base;
  let n = 2;
  while (ids.has(id)) id = `${base}_${n++}`;
  return id;
}

function addBody(model: ProductModel, raw: Record<string, unknown>, issues: SolverIssue[], why: string): Body | null {
  if (model.bodies.length >= 8) {
    issues.push({ code: "body_limit", severity: "warn", detail: `no room for a ${raw.role} (${why})` });
    return null;
  }
  const b = clampBody({ ...raw, id: freshId(model.bodies, String(raw.id ?? raw.role)) }, model.bodies.length);
  model.bodies.push(b);
  issues.push({ code: "body_added", severity: "info", body: b.id, detail: why });
  return b;
}

type Groups = { pumps: LayoutInput[]; soils: LayoutInput[]; lights: LayoutInput[]; buttons: LayoutInput[]; rest: LayoutInput[] };

function ensureHomes(model: ProductModel, g: Groups, spec: ProductSpec | undefined, issues: SolverIssue[]): void {
  const host = () => model.bodies.find((b) => b.id === model.electronicsHost)!;
  const childrenOn = (id: string, anchor: Anchor) => model.bodies.filter((b) => b.attach.to === id && b.attach.anchor === anchor);
  const accent = host().colour;

  if (g.soils.length) {
    let stake = model.bodies.find((b) => b.form.kind === "stake");
    const h = host();
    if (!stake && (h.attach.to === "ground" || h.attach.to === "scene")) {
      stake = addBody(model, { id: "stake", role: "stake", form: { kind: "stake", section: "blade", length: 120, width: 28, thick: 12, taper: 0.35 }, attach: { to: "ground", anchor: "top", offset: [0, 0, -95] }, material: "PETG", colour: h.colour, finish: "matte_plastic" }, issues, "soil probe") ?? undefined;
      if (stake) h.attach = { to: stake.id, anchor: "top", offset: [0, 0, 0] };
    }
    if (stake && !model.bodies.some((b) => b.form.kind === "prongs")) {
      addBody(model, { id: "probe_tips", role: "stake", form: { kind: "prongs", length: 18, d: 3, spacing: 12 }, attach: { to: stake.id, anchor: "bottom", offset: [0, 0, 0] }, material: "aluminium", colour: "graphite", finish: "anodized_aluminium" }, issues, "soil probe tips");
    }
  }

  if (g.pumps.length) {
    let res = model.bodies.find((b) => b.role === "reservoir");
    if (!res) {
      const plant = model.scene === "plant_pot";
      res = addBody(model, {
        id: "reservoir",
        role: "reservoir",
        form: { kind: "tank", shape: "round", w: 72, d: 72, h: 92, r: 12, lidH: 8, window: 1 },
        attach: plant ? { to: "scene", anchor: "bottom", offset: [POT.radius + 14 + 36, 0, 0] } : { to: "ground", anchor: "top", offset: [formFrame(host().form).size[0] / 2 + 30 + 36, 0, 0] },
        material: "PETG",
        colour: "mist",
        finish: "glossy_plastic",
      }, issues, "pump") ?? undefined;
    }
    let nozzle = model.bodies.find((b) => b.role === "nozzle");
    const wantsNozzle = model.scene === "plant_pot" || spec?.placement === "plant_soil";
    if (!nozzle && wantsNozzle) {
      nozzle = addBody(model, { id: "nozzle", role: "nozzle", form: { kind: "nozzle", length: 18, d: 8, bore: 2.5, angle: 55, drop: 14 }, attach: { to: host().id, anchor: "front", offset: [0, 0, 0] }, material: "PLA", colour: accent, finish: "matte_plastic" }, issues, "water outlet") ?? undefined;
    }
    if (res && !model.links.some((l) => l.kind === "tube" && (l.from.body === res!.id || l.to.body === res!.id)) && model.links.length < 4) {
      model.links.push({ kind: "tube", from: { body: res.id, anchor: "top" }, to: { body: host().id, anchor: "back" }, diameter: 6, colour: "mist" });
      issues.push({ code: "link_added", severity: "info", detail: "tube from the reservoir" });
    }
  }

  if (g.lights.length && !model.bodies.some((b) => b.material === "resin_clear" && (b.role === "light_ring" || b.role === "window"))) {
    const h = host();
    const top = stackOutline(h.form, "top");
    // A glowing band only between the host and a layer already stacked on it (a lid / cap):
    // without one the band would leave the host open. Otherwise a small clear lens on top.
    const layer = childrenOn(h.id, "top").find((c) => isStacked(c, h));
    const rot = h.attach.rotate ? { rotate: h.attach.rotate } : {};
    if (top && layer) {
      const ring = addBody(model, { id: "light_ring", role: "light_ring", form: { kind: "ring", shape: top.shape, w: Math.max(10, top.w - 6), d: Math.max(10, top.d - 6), t: 3, h: 6, r: Math.max(1, top.r - 3) }, attach: { to: h.id, anchor: "top", offset: [0, 0, 0] }, material: "resin_clear", colour: "mist", finish: "glossy_plastic" }, issues, "LED light");
      if (ring) layer.attach = { ...layer.attach, to: ring.id };
    } else if (top) {
      addBody(model, { id: "window", role: "window", form: { kind: "rounded_extrude", shape: "rrect", w: 18, d: 18, h: 2.5, r: 8.9, fillet: 1 }, attach: { to: h.id, anchor: "top", offset: [0, 0, 0], ...rot }, material: "resin_clear", colour: "mist", finish: "glossy_plastic" }, issues, "LED light");
    } else {
      addBody(model, { id: "window", role: "window", form: { kind: "rounded_extrude", shape: "rrect", w: 22, d: 22, h: 3, r: 10, fillet: 1 }, attach: { to: h.id, anchor: "front", offset: [0, 0, 0], rotate: [90, 0, 0] }, material: "resin_clear", colour: "mist", finish: "glossy_plastic" }, issues, "LED light");
    }
  }

  if (g.buttons.length && !model.bodies.some((b) => b.role === "button_cap")) {
    addBody(model, { id: "button", role: "button_cap", form: { kind: "button_cap", d: 14, h: 4, dome: 0.5, stem: 0 }, attach: { to: host().id, anchor: "top", offset: [0, 0, 0], ...(host().attach.rotate ? { rotate: host().attach.rotate } : {}) }, material: "PLA", colour: accent, finish: "soft_touch" }, issues, "button");
  }
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function resolveShell(b: Body, model: ProductModel, joints: { top: boolean; bottom: boolean }): ResolvedShell {
  const hollowable = HOLLOW_FORMS.includes(b.form.kind);
  const want = b.shell ?? "auto";
  if (!hollowable) return "solid";
  if (want !== "auto") return want;
  if (b.form.kind === "tank") return "split";
  if (b.id === model.electronicsHost) return joints.top ? "open_top" : "split";
  if (joints.bottom && (b.role === "lid" || b.role === "cover" || b.role === "housing")) return "open_bottom";
  const [w, d, h] = formFrame(b.form).size;
  if ((b.role === "base" || b.role === "housing" || b.role === "cover") && Math.min(w, d, h) > 24) return "open_bottom";
  return "solid";
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

export function solveProduct(input: unknown, parts: readonly LayoutInput[], opts: SolveOptions = {}): SolvedProduct {
  const issues: SolverIssue[] = [];
  const model = clampProductModel(structuredClone(input ?? {}), opts.log ?? []);
  let scene = SCENE_METRICS[model.scene];
  const physical = [...parts]
    .filter((p) => !p.part.helper || p.part.ports.length > 0)
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  const groups: Groups = { pumps: [], soils: [], lights: [], buttons: [], rest: [] };
  for (const p of physical) {
    if (isPump(p.part)) groups.pumps.push(p);
    else if (isSoilProbe(p.part)) groups.soils.push(p);
    else {
      if (isLight(p.part)) groups.lights.push(p);
      if (isButtonPart(p.part)) groups.buttons.push(p);
      groups.rest.push(p);
    }
  }

  ensureHomes(model, groups, opts.spec, issues);
  const byId = () => new Map(model.bodies.map((b) => [b.id, b]));

  // Stacks, joints + shells from the attach graph (decided once, before anything grows).
  const stacked = new Set<string>();
  {
    const m = byId();
    for (const b of model.bodies) if (isStacked(b, m.get(b.attach.to))) stacked.add(b.id);
  }
  const jointsOf = (b: Body) => ({
    top: model.bodies.some((c) => c.attach.to === b.id && stacked.has(c.id)),
    bottom: stacked.has(b.id),
  });
  const shellOf = new Map<string, ResolvedShell>();
  for (const b of model.bodies) shellOf.set(b.id, resolveShell(b, model, jointsOf(b)));
  const wallOf = (b: Body) => b.wall ?? (b.role === "reservoir" ? 2.4 : DEFAULT_WALL);

  // --- Soil probe in the stake ------------------------------------------------
  const stake = model.bodies.find((b) => b.form.kind === "stake");
  const placedHomes = new Map<string, string>(); // instanceId → body id
  const pockets = new Map<string, SolvedPocket[]>();
  const soilPlan: { item: LayoutInput; above: number }[] = [];
  if (groups.soils.length) {
    if (stake && stake.form.kind === "stake") {
      const p = groups.soils[0].part;
      const thin = Math.min(p.dims.y, p.dims.z);
      const wide = Math.max(p.dims.y, p.dims.z);
      const above = 3; // the probe's connector end pokes into the head through its floor
      const inStake = p.dims.x - above;
      const f = { ...stake.form };
      f.section = "blade";
      f.width = Math.max(f.width, r3(wide + 2 * (1.6 + 0.4)));
      f.thick = Math.max(f.thick, r3(thin + 2 * (1.6 + 0.4)));
      f.length = Math.max(f.length, r3(inStake + 16));
      f.taper = Math.max(f.taper, 0.35);
      stake.form = scaleForm(f, 1, 1, 1);
      soilPlan.push({ item: groups.soils[0], above });
      placedHomes.set(groups.soils[0].instanceId, stake.id);
      if (groups.soils.length > 1) groups.rest.push(...groups.soils.slice(1));
    } else groups.rest.push(...groups.soils);
  }

  // --- Pump in the reservoir --------------------------------------------------
  const reservoir = model.bodies.find((b) => b.role === "reservoir");
  let pumpFit: HostFit | null = null;
  if (groups.pumps.length) {
    if (reservoir && HOLLOW_FORMS.includes(reservoir.form.kind)) {
      pumpFit = fitInside(reservoir.form, wallOf(reservoir), shellOf.get(reservoir.id)!, groups.pumps, null);
      reservoir.form = pumpFit.form;
      if (!pumpFit.ok) issues.push({ code: "electronics_dont_fit", severity: "error", body: reservoir.id, detail: "pump" });
      else for (const it of pumpFit.items) placedHomes.set(it.instanceId, reservoir.id);
    } else groups.rest.push(...groups.pumps);
  }

  // --- Everything else in the host ---------------------------------------------
  const host = model.bodies.find((b) => b.id === model.electronicsHost)!;
  const hostShell = shellOf.get(host.id)!;
  const hostRot = rotationMatrix(host.attach.rotate);
  const prefLocal = rotate(transpose(hostRot), USB_FACE[model.archetype]);
  const prefFlat: Vec3 | null = Math.hypot(prefLocal[0], prefLocal[1]) > 0.3 ? v3.norm([prefLocal[0], prefLocal[1], 0]) : null;
  let hostItems = groups.rest;
  let hostFit: HostFit = { form: host.form, ok: true, items: [], grew: 1 };
  let batteryFit: { body: Body; fit: HostFit } | null = null;
  if (HOLLOW_FORMS.includes(host.form.kind)) {
    hostFit = fitInside(host.form, wallOf(host), hostShell, hostItems, prefFlat);
    const battery = hostItems.find((it) => isBattery(it.part));
    const alt = model.bodies.find((b) => b.id !== host.id && (b.role === "base" || b.role === "handle") && HOLLOW_FORMS.includes(b.form.kind));
    if ((!hostFit.ok || hostFit.grew > 1.5) && battery && alt) {
      const fitAlt = fitInside(alt.form, wallOf(alt), shellOf.get(alt.id)!, [battery], null);
      if (fitAlt.ok) {
        hostItems = hostItems.filter((it) => it !== battery);
        hostFit = fitInside(host.form, wallOf(host), hostShell, hostItems, prefFlat);
        alt.form = fitAlt.form;
        batteryFit = { body: alt, fit: fitAlt };
        issues.push({ code: "part_moved", severity: "info", body: alt.id, detail: `${battery.instanceId} moved out of ${host.id}` });
      }
    }
    if (!hostFit.ok) issues.push({ code: "electronics_dont_fit", severity: "error", body: host.id });
    else if (hostFit.grew > 1.5) issues.push({ code: "host_grown", severity: "warn", body: host.id, detail: `x${r3(hostFit.grew)}` });
    host.form = hostFit.form;
    pushToWalls(host.form, wallOf(host), hostFit.items);
    for (const it of hostFit.items) placedHomes.set(it.instanceId, host.id);
    if (batteryFit) for (const it of batteryFit.fit.items) placedHomes.set(it.instanceId, batteryFit.body.id);
  } else if (hostItems.length) {
    issues.push({ code: "electronics_dont_fit", severity: "error", body: host.id, detail: "host is not a shell" });
  }

  // --- Stack outlines -----------------------------------------------------------
  {
    const m = byId();
    const parentUnder = m.get(host.attach.to);
    if (parentUnder && stacked.has(host.id)) {
      parentUnder.form = matchOutline(parentUnder.form, "top", stackOutline(host.form, "bottom")!);
    }
    // Forward pass from the roots: each stacked child takes its parent's top outline.
    const done = new Set<string>();
    for (let pass = 0; pass < model.bodies.length; pass++) {
      for (const b of model.bodies) {
        if (done.has(b.id)) continue;
        const p = m.get(b.attach.to);
        if (p && !done.has(p.id)) continue;
        if (p && stacked.has(b.id)) b.form = matchOutline(b.form, "bottom", stackOutline(p.form, "top")!);
        done.add(b.id);
      }
    }
  }

  // --- Place (pass 1) -------------------------------------------------------------
  let placement = placeBodies(model.bodies, scene, issues, false);

  // Plant pot: wide enough for what stands in it, and anything standing beside it outside.
  const rootOf = (b: Body): string => {
    let cur: Body | undefined = b;
    for (let i = 0; i < 10 && cur; i++) {
      const next = model.bodies.find((x) => x.id === cur!.attach.to);
      if (!next) return cur.attach.to;
      cur = next;
    }
    return "ground";
  };
  if (model.scene === "plant_pot") {
    let reach = 0;
    for (const b of model.bodies) {
      if (rootOf(b) !== "ground") continue;
      const bx = placement.get(b.id)!.box;
      if (bx.max[2] < scene.groundZ - 0.5) continue; // under the soil
      reach = Math.max(reach, Math.abs(bx.min[0]), Math.abs(bx.max[0]), Math.abs(bx.min[1]), Math.abs(bx.max[1]));
    }
    const radius = Math.max(POT.radius, Math.ceil(reach + POT.wall + 12));
    if (radius !== POT.radius) {
      scene = plantPot(radius);
      issues.push({ code: "pot_widened", severity: "info", detail: `${2 * radius} mm` });
    }
    for (const b of model.bodies.filter((x) => x.attach.to === "scene" && x.attach.anchor !== "back")) {
      const half = formFrame(b.form).size[0] / 2;
      const need = radius + 12 + half;
      const o = b.attach.offset;
      if (Math.hypot(o[0], o[1]) < need) b.attach = { ...b.attach, offset: [need, 0, 0] };
    }
  }

  // --- Button caps over their switches ---------------------------------------------
  const cutouts = new Map<string, SolvedCutout[]>(model.bodies.map((b) => [b.id, []]));
  const caps = model.bodies.filter((b) => b.role === "button_cap" && b.form.kind === "button_cap");
  const coverOf = (): Body => {
    // The body whose top closes the host: the host itself (split / closed), else the first
    // non-band layer stacked on it.
    if (hostShell !== "open_top") return host;
    let cur: Body = host;
    for (let i = 0; i < 6; i++) {
      const next = model.bodies.find((c) => c.attach.to === cur.id && stacked.has(c.id));
      if (!next) return cur;
      if (next.form.kind !== "ring") return next;
      cur = next;
    }
    return cur;
  };
  const cover = coverOf();
  const hostPl = () => placement.get(host.id)!;
  const topPortAt = (it: HostFit["items"][number], kind?: PortKind): Vec3 | null => {
    const port = it.part.ports.find((q) => q.face === "+z" && (!kind || q.kind === kind));
    if (!port) return null;
    const lp = portLocal(it.part, port.face, port.at.u, port.at.v);
    const [rx, ry] = rotateXY(lp[0], lp[1], it.rotZ);
    return [it.pos[0] + rx, it.pos[1] + ry, it.pos[2] + lp[2]];
  };

  // Top ports hidden under a body sitting on the cover (a hopper on a base): slide the
  // part inside the cavity until its port is clear.
  {
    const sitters = model.bodies.filter(
      (b) => (b.attach.to === cover.id || b.attach.to === host.id) && b.attach.anchor === "top" && !stacked.has(b.id) && !["button_cap", "window", "light_ring"].includes(b.role),
    );
    if (sitters.length && HOLLOW_FORMS.includes(host.form.kind)) {
      const hm = transpose(hostPl().matrix);
      const footprints = sitters.map((b) => {
        const bx = placement.get(b.id)!.box;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < 8; i++) {
          const q = rotate(hm, v3.sub([i & 1 ? bx.max[0] : bx.min[0], i & 2 ? bx.max[1] : bx.min[1], i & 4 ? bx.max[2] : bx.min[2]], hostPl().position));
          xs.push(q[0]);
          ys.push(q[1]);
        }
        return { minX: Math.min(...xs) - 4, maxX: Math.max(...xs) + 4, minY: Math.min(...ys) - 4, maxY: Math.max(...ys) + 4 };
      });
      const covered = (x: number, y: number, r: number) => footprints.some((f) => x + r > f.minX && x - r < f.maxX && y + r > f.minY && y - r < f.maxY);
      const wall = wallOf(host);
      for (const it of hostFit.items) {
        const port = it.part.ports.find((q) => q.face === "+z");
        if (!port) continue;
        const at = topPortAt(it)!;
        const reach = isButtonPart(it.part) ? 9 : Math.max(port.size.w, port.size.h) / 2 + 2;
        if (!covered(at[0], at[1], reach)) continue;
        const f = footprints.find((q) => at[0] + reach > q.minX && at[0] - reach < q.maxX && at[1] + reach > q.minY && at[1] - reach < q.maxY)!;
        const dir = v3.norm([at[0] - (f.minX + f.maxX) / 2, at[1] - (f.minY + f.maxY) / 2, 0]);
        const tryDir: Vec3 = v3.len(dir) > 0.1 ? dir : [0, -1, 0];
        for (let step = 2; step <= 200; step += 2) {
          const next: Vec3 = [r3(it.pos[0] + tryDir[0] * step), r3(it.pos[1] + tryDir[1] * step), it.pos[2]];
          const moved = itemBox({ ...it, pos: next });
          const inCavity = [moved.min[2], moved.max[2]].every((z) => {
            const sec = sectionAt(host.form, Math.min(z, formFrame(host.form).size[2]), wall);
            return [moved.min[0], moved.max[0]].every((x) => [moved.min[1], moved.max[1]].every((y) => insideSection(sec, x, y)));
          });
          if (!inCavity) break;
          const clash = hostFit.items.some((o) => {
            if (o === it) return false;
            const ov = boxOverlap(moved, itemBox(o));
            return ov[0] > 0.01 && ov[1] > 0.01 && ov[2] > 0.01;
          });
          if (clash) continue;
          const p2 = v3.add(next, v3.sub(at, it.pos));
          if (!covered(p2[0], p2[1], reach)) {
            it.pos = next;
            issues.push({ code: "part_moved", severity: "info", body: host.id, detail: `${it.instanceId} out from under a body` });
            break;
          }
        }
      }
    }
  }

  const buttonItems = hostFit.items.filter((it) => isButtonPart(it.part));
  const onCover = (at: Vec3) => {
    const cl = toLocal(placement.get(cover.id)!, toWorld(hostPl(), at));
    return { cl, surface: topAt(cover.form, cl[0], cl[1]) };
  };
  const coverRot = cover.attach.rotate ? { rotate: cover.attach.rotate } : {};
  caps.forEach((cap, i) => {
    const it = buttonItems[i];
    if (!it) return;
    const { cl, surface } = onCover(topPortAt(it, "button_cap")!);
    cap.attach = { to: cover.id, anchor: "top", offset: [r3(cl[0]), r3(cl[1]), 0], ...coverRot };
    if (cap.form.kind === "button_cap") {
      // On a curved top the cap rests on the highest point under it (seat), not its centre.
      const R = cap.form.d / 2 + 0.3;
      let high = surface;
      for (let i = 0; i < 24; i++) {
        const a = (2 * Math.PI * i) / 24;
        for (const rr of [R / 2, R]) high = Math.max(high, topAt(cover.form, cl[0] + rr * Math.cos(a), cl[1] + rr * Math.sin(a)));
      }
      const seat = high - surface > 0.05 ? r3(Math.min(10, high - surface + 0.2)) : 0;
      cap.form = { ...cap.form, stem: r3(Math.max(0, Math.min(30, surface - cl[2] - 0.3))), seat };
    }
    // A small light ring on the same face becomes the cap's halo.
    for (const ring of model.bodies.filter((b) => b.role === "light_ring" && b.form.kind === "ring" && !stacked.has(b.id) && (b.attach.to === cover.id || b.attach.to === host.id) && b.attach.anchor === "top")) {
      if (ring.form.kind !== "ring" || cap.form.kind !== "button_cap") continue;
      const hole = r3(Math.max(ring.form.w, cap.form.d + 3));
      ring.form = { ...ring.form, shape: "round", w: hole, d: hole };
      ring.attach = { to: cover.id, anchor: "top", offset: [r3(cl[0]), r3(cl[1]), 0], ...coverRot };
    }
  });
  // A window (lens) on the cover sits over the first light.
  const lightItem = hostFit.items.find((it) => isLight(it.part));
  if (lightItem) {
    for (const win of model.bodies.filter((b) => b.role === "window" && b.material === "resin_clear" && b.attach.to === cover.id && b.attach.anchor === "top")) {
      const at = topPortAt(lightItem) ?? [lightItem.pos[0], lightItem.pos[1], lightItem.pos[2] + lightItem.part.dims.z];
      const { cl } = onCover(at);
      win.attach = { ...win.attach, offset: [r3(cl[0]), r3(cl[1]), 0] };
      // Clear of the button caps on the same face: smaller first, then slid aside.
      for (const cap of caps) {
        if (cap.attach.to !== win.attach.to || cap.form.kind !== "button_cap" || win.form.kind !== "rounded_extrude") continue;
        const capR = cap.form.d / 2;
        const o = win.attach.offset;
        const c = cap.attach.offset;
        let dx = o[0] - c[0];
        let dy = o[1] - c[1];
        let dist = Math.hypot(dx, dy);
        const winR = Math.hypot(win.form.w, win.form.d) / 2;
        if (dist >= capR + winR + 1) continue;
        const side = Math.max(8, Math.min(win.form.w, 2 * (dist - capR - 1) / Math.SQRT2));
        win.form = { ...win.form, w: r3(side), d: r3(side), r: r3(Math.min(win.form.r, side / 2 - 0.01)) };
        const need = capR + (side * Math.SQRT2) / 2 + 1;
        if (dist < need) {
          if (dist < 1e-6) [dx, dy, dist] = [1, 0, 1];
          // Slide round the cap (starting on the light's side) to the first spot that stays on the face.
          const coverTop = sectionAt(cover.form, Math.max(0, formFrame(cover.form).size[2] - 0.5), 1);
          const half = side / 2;
          const a0 = Math.atan2(dy, dx);
          let placed = false;
          for (let i = 0; i < 12 && !placed; i++) {
            const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
            const x = c[0] + Math.cos(a) * need;
            const y = c[1] + Math.sin(a) * need;
            if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => insideSection(coverTop, x + sx * half, y + sy * half))) {
              win.attach = { ...win.attach, offset: [r3(x), r3(y), 0] };
              placed = true;
            }
          }
          if (!placed) issues.push({ code: "window_crowded", severity: "warn", body: win.id, detail: cap.id });
        }
      }
      break;
    }
  }

  // --- Place (pass 2, final) ------------------------------------------------------
  placement = placeBodies(model.bodies, scene, issues, true);
  const pl = (id: string) => placement.get(id)!;

  // --- Electronics → world + cut-outs ----------------------------------------------
  const electronics: PlacedElectronic[] = [];
  const hasClearLight = model.bodies.some((b) => b.material === "resin_clear");
  const addElectronic = (instanceId: string, part: LibraryPart, body: Body, localPos: Vec3, localMatrix: number[]) => {
    const p = pl(body.id);
    const m = matMul(p.matrix, localMatrix);
    electronics.push({
      instanceId,
      partId: part.id,
      body: body.id,
      pos: r3v(toWorld(p, localPos)),
      rot: eulerFromMatrix(m),
      matrix: m.map(r3),
      dims: [part.dims.x, part.dims.y, part.dims.z],
      explode: [0, 0, 0],
    });
  };
  const rotZMatrix = (deg: number) => rotationMatrix([0, 0, deg]);

  for (const it of hostFit.items) {
    addElectronic(it.instanceId, it.part, host, it.pos, rotZMatrix(it.rotZ));
    for (const port of it.part.ports) {
      const lp = portLocal(it.part, port.face, port.at.u, port.at.v);
      const [rx, ry] = rotateXY(lp[0], lp[1], it.rotZ);
      const at: Vec3 = [it.pos[0] + rx, it.pos[1] + ry, it.pos[2] + lp[2]];
      const open = openingSize(port);
      if (port.face !== "+z") {
        const n = FACE_VEC[rotateFace(port.face, it.rotZ)];
        const axis = n[0] !== 0 ? 0 : 1;
        const outside = extentAlong(host.form, at[2], 0, axis as 0 | 1, Math.abs(at[1 - axis]));
        const along = at[axis] * n[axis];
        const depth = r3(Math.max(wallOf(host) + 1, outside - along + 1.5));
        const center = [...at] as Vec3;
        center[axis] = r3(n[axis] * (along + depth / 2 - 0.5));
        cutouts.get(host.id)!.push({ kind: port.kind, instanceId: it.instanceId, center: r3v(center), normal: n, w: r3(open.w), h: r3(open.h), depth, round: open.round });
        continue;
      }
      // +z ports open through the body covering the host.
      if (isLight(it.part) && hasClearLight) continue;
      if (port.kind === "button_cap") {
        const world = toWorld(pl(host.id), at);
        const cl = toLocal(pl(cover.id), world);
        const surf = topAt(cover.form, cl[0], cl[1]);
        const capD = caps[buttonItems.indexOf(it)]?.form.kind === "button_cap" ? 5 : open.w;
        cutouts.get(cover.id)!.push({ kind: "stem", instanceId: it.instanceId, center: r3v([cl[0], cl[1], surf - wallOf(cover)]), normal: [0, 0, 1], w: r3(capD + 0.6), h: r3(capD + 0.6), depth: r3(4 * wallOf(cover) + 4), round: true });
        // …and a notch in anything the stem passes on its way down (the host's snap lip, a band).
        if (cover.id !== host.id) {
          const chain = model.bodies.filter((b) => b.id === host.id || (stacked.has(b.id) && b.form.kind === "ring"));
          for (const b of chain) {
            const bl = toLocal(pl(b.id), world);
            const top = formFrame(b.form).size[2];
            cutouts.get(b.id)!.push({ kind: "stem", instanceId: it.instanceId, center: r3v([bl[0], bl[1], top]), normal: [0, 0, 1], w: r3(capD + 0.6), h: r3(capD + 0.6), depth: 16, round: true });
          }
        }
        continue;
      }
      const world = toWorld(pl(host.id), at);
      const cl = toLocal(pl(cover.id), world);
      const surf = topAt(cover.form, cl[0], cl[1]);
      const round = open.round || isRoundSensorPort(port);
      cutouts.get(cover.id)!.push({
        kind: port.kind,
        instanceId: it.instanceId,
        center: r3v([cl[0], cl[1], surf - wallOf(cover)]),
        normal: [0, 0, 1],
        w: r3(open.w),
        h: r3(open.h),
        depth: r3(4 * wallOf(cover) + 4),
        round,
        ...(port.kind === "speaker_grille" ? { grille: { hole: 1.6, pitch: 3 } } : {}),
      });
    }
  }
  if (batteryFit) for (const it of batteryFit.fit.items) addElectronic(it.instanceId, it.part, batteryFit.body, it.pos, rotZMatrix(it.rotZ));
  if (pumpFit && reservoir) for (const it of pumpFit.items) addElectronic(it.instanceId, it.part, reservoir, it.pos, rotZMatrix(it.rotZ));

  // Soil probe: standing in a pocket in the stake, connector end up into the head.
  if (soilPlan.length && stake && stake.form.kind === "stake") {
    const { item, above } = soilPlan[0];
    const p = item.part;
    const L = stake.form.length;
    // Part x (long) → up, its widest side across the blade (local x), thin side along y.
    const wideIsY = p.dims.y >= p.dims.z;
    const m = wideIsY ? rotationMatrix([0, -90, 90]) : rotationMatrix([0, -90, 0]);
    const centerLocal: Vec3 = [0, 0, r3(L + above - p.dims.x / 2)];
    const originLocal = v3.sub(centerLocal, rotate(m, [0, 0, p.dims.z / 2]));
    addElectronic(item.instanceId, p, stake, r3v(originLocal), m);
    const wide = Math.max(p.dims.y, p.dims.z);
    const thin = Math.min(p.dims.y, p.dims.z);
    const depth = p.dims.x - above + 0.6;
    pockets.set(stake.id, [{ instanceId: item.instanceId, center: [0, 0, r3(L - depth / 2 + 0.5)], size: [r3(wide + 0.8), r3(thin + 0.8), r3(depth + 1)] }]);
    // …and through the floor of the body standing on the stake.
    const above1 = model.bodies.find((b) => b.attach.to === stake.id && b.attach.anchor === "top");
    if (above1) {
      cutouts.get(above1.id)!.push({ kind: "pass" as CutoutKind, instanceId: item.instanceId, center: [0, 0, 0], normal: [0, 0, -1], w: r3(wide + 1.2), h: r3(thin + 1.2), depth: r3(2 * wallOf(above1) + 2), round: false });
    }
  }

  // --- Links (tubes / cables) --------------------------------------------------------
  const links: SolvedLink[] = [];
  for (const l of model.links) {
    const a = model.bodies.find((b) => b.id === l.from.body);
    const b = model.bodies.find((x) => x.id === l.to.body);
    if (!a || !b) continue;
    const end = (body: Body, anchor: Anchor) => {
      const p = pl(body.id);
      // A tube leaving a reservoir comes out of its lid next to the centre; into a head
      // low on its back.
      const dv = anchor === "back" || anchor === "front" || anchor === "left" || anchor === "right" ? -0.15 * formFrame(body.form).size[2] : 0;
      const ap = anchorPoint(body.form, anchor, 0, dv);
      const world = toWorld(p, ap.p);
      const n = v3.norm(rotate(p.matrix, ap.n));
      if (HOLLOW_FORMS.includes(body.form.kind)) {
        cutouts.get(body.id)!.push({ kind: "tube_inlet", center: r3v(v3.sub(ap.p, v3.scale(ap.n, wallOf(body) / 2))), normal: ap.n, w: r3(l.diameter + 0.6), h: r3(l.diameter + 0.6), depth: r3(2 * wallOf(body) + 2), round: true });
      }
      return { world, n };
    };
    const A = end(a, l.from.anchor);
    const B = end(b, l.to.anchor);
    const lead = 22;
    const p1 = v3.add(A.world, v3.scale(A.n, lead));
    const p3 = v3.add(B.world, v3.scale(B.n, lead));
    const mid: Vec3 = [(p1[0] + p3[0]) / 2, (p1[1] + p3[1]) / 2, Math.max(p1[2], p3[2]) + 18];
    const points = [A.world, p1, mid, p3, B.world].map(r3v);
    links.push({ ...l, points, length: r3(polylineLength(catmullRom(points, 48))) });
  }

  // --- Checks: floating, overlap, scene ----------------------------------------------
  const parentOf = new Map(model.bodies.map((b) => [b.id, model.bodies.some((x) => x.id === b.attach.to) ? b.attach.to : null]));
  for (const b of model.bodies) {
    const par = parentOf.get(b.id);
    const box = pl(b.id).box;
    if (par) {
      if (boxGap(box, pl(par).box) > 0.6) issues.push({ code: "floating", severity: "error", body: b.id, detail: `not touching ${par}` });
    } else {
      const base = b.attach.to === "scene" ? (b.attach.anchor === "back" ? null : scene.floorZ) : scene.groundZ;
      if (base !== null && box.min[2] > base + 0.6) issues.push({ code: "floating", severity: "error", body: b.id, detail: "above the ground" });
    }
  }
  const ancestors = (id: string) => {
    const out = new Set<string>();
    let cur = parentOf.get(id);
    while (cur && !out.has(cur)) {
      out.add(cur);
      cur = parentOf.get(cur);
    }
    return out;
  };
  const roleOf = new Map(model.bodies.map((b) => [b.id, b.role]));
  /** Round bodies standing upright have a round footprint (their box corners are air). */
  const footprintOf = (b: Body): Footprint => {
    const box = pl(b.id).box;
    const rot = b.attach.rotate;
    const upright = !rot || (Math.abs(rot[0]) < 1e-9 && Math.abs(rot[1]) < 1e-9);
    if (!isRoundForm(b.form) || !upright) return { box };
    return { box, circle: { cx: (box.min[0] + box.max[0]) / 2, cy: (box.min[1] + box.max[1]) / 2, r: (box.max[0] - box.min[0]) / 2 } };
  };
  /** Parent ↔ child touch by design; a button cap's stem also passes down through its whole stack. */
  const related = (a: string, b: string) =>
    parentOf.get(a) === b ||
    parentOf.get(b) === a ||
    (roleOf.get(a) === "button_cap" && ancestors(a).has(b)) ||
    (roleOf.get(b) === "button_cap" && ancestors(b).has(a));
  /** `other` stands inside the hole of `ring` (a halo around a button): boxes overlap, bodies don't. */
  const inRingHole = (ring: Body, other: Body) => {
    if (ring.form.kind !== "ring") return false;
    const rp = pl(ring.id);
    const ob = pl(other.id).box;
    const m = transpose(rp.matrix);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 8; i++) {
      const q = rotate(m, v3.sub([i & 1 ? ob.max[0] : ob.min[0], i & 2 ? ob.max[1] : ob.min[1], i & 4 ? ob.max[2] : ob.min[2]], rp.position));
      xs.push(q[0]);
      ys.push(q[1]);
    }
    const hx = (Math.max(...xs) - Math.min(...xs)) / 2;
    const hy = (Math.max(...ys) - Math.min(...ys)) / 2;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const half = ring.form.shape === "round" ? Math.max(hx, hy) + Math.hypot(cx, cy) : 0;
    return ring.form.shape === "round" ? half <= ring.form.w / 2 + 0.01 : Math.abs(cx) + hx <= ring.form.w / 2 && Math.abs(cy) + hy <= ring.form.d / 2;
  };
  for (let i = 0; i < model.bodies.length; i++) {
    for (let j = i + 1; j < model.bodies.length; j++) {
      const a = model.bodies[i];
      const b = model.bodies[j];
      if (related(a.id, b.id)) continue;
      if (inRingHole(a, b) || inRingHole(b, a)) continue;
      const ov = boxOverlap(pl(a.id).box, pl(b.id).box);
      if (Math.min(ov[0], ov[1], ov[2]) > 0.5) issues.push({ code: "overlap", severity: "error", body: a.id, detail: b.id });
    }
    const a = model.bodies[i];
    for (const ob of scene.obstacles) {
      if (ob.inside.includes(a.role)) continue;
      if (obstacleHit(footprintOf(a), ob)) issues.push({ code: "scene_overlap", severity: "error", body: a.id, detail: ob.name });
    }
  }

  // Every part placed?
  const unplaced = physical.filter((p) => !placedHomes.has(p.instanceId)).map((p) => p.instanceId);
  for (const id of unplaced) issues.push({ code: "part_not_placed", severity: "error", detail: id });

  // USB reachable (not facing the floor or the wall, not blocked by another body).
  for (const e of electronics) {
    const it = hostFit.items.find((x) => x.instanceId === e.instanceId);
    if (!it) continue;
    for (const port of it.part.ports) {
      if (!USB_KINDS.includes(port.kind) || port.face === "+z") continue;
      const n = v3.norm(rotate(pl(host.id).matrix, FACE_VEC[rotateFace(port.face, it.rotZ)]));
      const lp = portLocal(it.part, port.face, port.at.u, port.at.v);
      const [rx, ry] = rotateXY(lp[0], lp[1], it.rotZ);
      const at = toWorld(pl(host.id), [it.pos[0] + rx, it.pos[1] + ry, it.pos[2] + lp[2]]);
      const facesDown = n[2] < -0.7 && host.attach.to === "ground";
      const facesWall = model.scene === "wall" && n[1] > 0.7;
      if (facesDown || facesWall) issues.push({ code: "usb_unreachable", severity: "warn", detail: e.instanceId });
      const probe = v3.add(at, v3.scale(n, 18));
      const blocked = model.bodies.some((b) => {
        if (b.id === host.id) return false;
        const bx = pl(b.id).box;
        return probe.every((x, k) => x > bx.min[k] && x < bx.max[k]);
      });
      if (blocked) issues.push({ code: "port_blocked", severity: "warn", detail: e.instanceId });
    }
  }

  // The water outlet should drip on the soil.
  if (scene.target) {
    for (const b of model.bodies.filter((x) => x.role === "nozzle")) {
      const box = pl(b.id).box;
      const tip: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
      const r = Math.hypot(tip[0] - scene.target.centre[0], tip[1] - scene.target.centre[1]);
      if (r > scene.target.radius || tip[2] < scene.groundZ) issues.push({ code: "nozzle_off_target", severity: "warn", body: b.id });
    }
  }
  if (groups.lights.length && !hasClearLight) issues.push({ code: "light_missing", severity: "warn" });

  // --- Printability, grams, explode ----------------------------------------------------
  const explodeOf = new Map<string, Vec3>();
  const order: Body[] = [];
  {
    const seen = new Set<string>();
    while (order.length < model.bodies.length) {
      const before = order.length;
      for (const b of model.bodies) {
        if (seen.has(b.id)) continue;
        const par = parentOf.get(b.id);
        if (par && !seen.has(par)) continue;
        seen.add(b.id);
        order.push(b);
      }
      if (order.length === before) break;
    }
  }
  const productBox = unionBoxes(model.bodies.map((b) => pl(b.id).box));
  const centre: Vec3 = v3.scale(v3.add(productBox.min, productBox.max), 0.5);
  for (const b of order) {
    const p = pl(b.id);
    const par = parentOf.get(b.id);
    const size = formFrame(b.form).size;
    if (!par) {
      // Roots stay, except a body standing beside the product (reservoir): slides out sideways.
      const bc = v3.scale(v3.add(p.box.min, p.box.max), 0.5);
      const away: Vec3 = [bc[0] - centre[0], bc[1] - centre[1], 0];
      explodeOf.set(b.id, b.role === "reservoir" && v3.len(away) > 1 ? r3v(v3.scale(v3.norm(away), 25)) : [0, 0, 0]);
      continue;
    }
    const n = p.normal ?? [0, 0, 1];
    const along = Math.abs(v3.dot(rotate(p.matrix, [size[0], size[1], size[2]]), n));
    explodeOf.set(b.id, r3v(v3.add(explodeOf.get(par) ?? [0, 0, 0], v3.scale(n, 14 + 0.35 * along))));
  }

  const solvedBodies: SolvedBody[] = model.bodies.map((b) => {
    const p = pl(b.id);
    const j = jointsOf(b);
    const shell = shellOf.get(b.id) ?? "solid";
    const wall = wallOf(b);
    const [w, d, h] = formFrame(b.form).size;
    const lathe = b.form.kind === "lathe_profile";
    let split: SolvedBody["split"] = null;
    if (shell === "split") {
      const z = b.form.kind === "tank" ? h - b.form.lidH : r3(lathe ? 0.6 * h : 0.55 * h);
      const big = Math.max(w, d, h) > 120 || model.archetype === "outdoor_box";
      split = { z: r3(z), joint: b.form.kind === "tank" ? "snap_lip" : big || b.features?.some((f) => f.kind === "screw_bosses") ? "screw_bosses" : "snap_lip" };
    }
    let lip: SolvedBody["lip"] = null;
    const layer = model.bodies.find((c) => c.attach.to === b.id && stacked.has(c.id));
    if (shell === "open_top" && layer) {
      // Inside the layer above: past a ring's band, or past a shell's wall.
      const band = layer.form.kind === "ring" ? layer.form.t : wallOf(layer);
      const height = layer.form.kind === "ring" ? Math.min(3, layer.form.h - 0.5) : 3;
      if (height >= 1.2) lip = { inset: r3(Math.max(band, wall) + LIP_GAP), height: r3(height) };
    }
    const printable = b.material !== "aluminium";
    const plan = (sz: Vec3, prefer: PrintPose[]): PrintPlan => {
      const cands = (["upright", "flipped", "on_side"] as PrintPose[]).map((pose) => {
        const s = poseSize(sz, pose);
        return { pose, size: r3v(s), fits: fitsMk4(s), overhangDeg: r3(overhangDeg(b.form, pose, { flatBottom: j.bottom })) };
      });
      const ok = cands.filter((c) => c.fits && c.overhangDeg <= 45);
      const pick =
        prefer.map((pp) => ok.find((c) => c.pose === pp)).find(Boolean) ??
        [...ok].sort((x, y) => x.overhangDeg - y.overhangDeg)[0] ??
        cands.filter((c) => c.fits).sort((x, y) => x.overhangDeg - y.overhangDeg)[0] ??
        cands[0];
      const matrix = matMul(rotationMatrix(POSE_ROT[pick.pose]), transpose(p.matrix)).map(r3);
      return { pose: pick.pose, matrix, size: pick.size, fits: pick.fits, overhangDeg: pick.overhangDeg };
    };
    const up = v3.norm(rotate(p.matrix, [0, 0, 1]));
    const pieces: SolvedPiece[] = [];
    if (split) {
      pieces.push({ id: `${b.id}__bottom`, piece: "bottom", print: plan([w, d, split.z], ["upright"]), explode: [0, 0, 0] });
      // A lathed top keeps its outside up (its inside has a 45° cone roof); a flat-topped top
      // half prints upside down so its roof becomes its floor.
      pieces.push({ id: `${b.id}__top`, piece: "top", print: plan([w, d, h - split.z], lathe ? ["upright"] : ["flipped"]), explode: r3v(v3.scale(up, 12 + 0.4 * (h - split.z))) });
    } else {
      const prefer: PrintPose[] = shell === "open_bottom" && !lathe ? ["flipped"] : b.form.kind === "stake" ? ["flipped"] : ["upright"];
      pieces.push({ id: b.id, piece: "whole", print: plan([w, d, h], prefer), explode: [0, 0, 0] });
    }
    for (const pc of pieces) {
      if (!printable) continue;
      if (!pc.print.fits) issues.push({ code: "too_big_for_printer", severity: "error", body: b.id, detail: pc.id });
      else if (pc.print.overhangDeg > 45) issues.push({ code: "overhang", severity: "warn", body: b.id, detail: `${pc.id} ${pc.print.overhangDeg}°` });
    }
    const solid = solidVolume(b.form);
    const hollowShare = shell === "solid" ? 1 : 1 - [w, d, h].reduce((acc, s) => acc * Math.max(0, 1 - (2 * wall) / Math.max(s, 1e-6)), 1);
    const pocketVol = (pockets.get(b.id) ?? []).reduce((s, q) => s + q.size[0] * q.size[1] * q.size[2], 0);
    const volume = Math.max(1, solid * hollowShare - pocketVol);
    return {
      id: b.id,
      role: b.role,
      form: b.form,
      material: b.material,
      colour: b.colour,
      finish: b.finish,
      features: b.features ?? [],
      parent: parentOf.get(b.id) ?? null,
      anchor: parentOf.get(b.id) ? b.attach.anchor : null,
      position: p.position,
      rotation: (b.attach.rotate ?? [0, 0, 0]).map(r3) as Vec3,
      matrix: p.matrix.map(r3),
      box: p.box,
      wall,
      shell,
      joints: j,
      split,
      lip,
      cutouts: cutouts.get(b.id) ?? [],
      pockets: pockets.get(b.id) ?? [],
      printable,
      pieces,
      estGrams: gramsFor(volume, b.material),
      explode: explodeOf.get(b.id) ?? [0, 0, 0],
      hosts: [...placedHomes.entries()].filter(([, body]) => body === b.id).map(([iid]) => iid).sort(),
    };
  });

  // Electronics explode: out of their body, away from its opening.
  const sb = new Map(solvedBodies.map((b) => [b.id, b]));
  for (const e of electronics) {
    const body = sb.get(e.body)!;
    const up = v3.norm(rotate(body.matrix, [0, 0, 1]));
    const h = formFrame(body.form).size[2];
    const lift = body.form.kind === "stake" ? 0.75 * e.dims[0] : 0.6 * h + 22;
    const c = v3.scale(v3.add(body.box.min, body.box.max), 0.5);
    const radial: Vec3 = [e.pos[0] - c[0], e.pos[1] - c[1], 0];
    const spread = v3.len(radial) > 1 ? v3.scale(v3.norm(radial), 8) : ([0, 0, 0] as Vec3);
    e.explode = r3v(v3.add(v3.add(body.explode, v3.scale(up, lift)), spread));
  }

  const bbox = unionBoxes(solvedBodies.map((b) => b.box));
  const solved: Omit<SolvedProduct, "hash"> = {
    version: 1,
    model,
    scene: model.scene,
    stage: scene,
    bodies: solvedBodies,
    links,
    electronics: electronics.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0)),
    unplaced,
    bbox,
    issues: dedupeIssues(issues),
  };
  return { ...solved, hash: solvedHash(solved) };
}

function unionBoxes(boxes: Box3[]): Box3 {
  if (!boxes.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  }
  return { min: r3v(min), max: r3v(max) };
}

function dedupeIssues(list: SolverIssue[]): SolverIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.body ?? ""}|${i.detail ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Cache key of a solved product: everything that changes geometry or placement. Issues
 * are left out (they follow from the rest). Same input → same hash, on any machine.
 */
export function solvedHash(s: Omit<SolvedProduct, "hash"> | SolvedProduct): string {
  const copy: Record<string, unknown> = { ...s };
  delete copy.issues;
  delete copy.hash;
  return `prod:${hashText(stableJson(copy))}`;
}
