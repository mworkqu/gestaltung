// Enclosure templates: EnclosureSpec (tiny AI JSON) + layout → outer/inner
// dimensions that obey the design rules. Pure maths, no three.js — build.ts and
// cutouts.ts both read the shape through the helpers exported here, so the
// geometry, the cut-outs and the tests all agree on one definition.
//
// Enclosure space (all mm, Z up): outer shell spans x ∈ [-W/2, W/2],
// y ∈ [-D/2, D/2], z ∈ [0, H]; the floor top is at z = floorZ (= wall) and the
// layout is placed with its z = 0 on that floor (contentOffset). For soft_wedge
// H is the BACK height; the top falls towards the front (-y). For dome_base the
// outer top is a half-ellipsoid (topAt depends on x AND y): a cylinder up to
// dome.z0, then a cap rising dome.rise to H.

import {
  DEFAULT_ENCLOSURE,
  LIMITS,
  MECH_PARAMS,
  THROUGH_LID,
  type EnclosureSpec,
  type EnclosureTemplate,
  type LayoutItem,
  type LibraryPart,
  type ProductSpec,
} from "../schema";
import { hasTopPort, isPokeSensor, mountLift, POKE_OUT, worldBox, type LayoutResult, type Vec3 } from "../layout";

/** Templates the browser builder can make (all eight since Phase 3). */
export const BUILDABLE_TEMPLATES = [
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper", "lantern", "dome_base", "wall_plate",
] as const;
export type BuildableTemplate = (typeof BUILDABLE_TEMPLATES)[number];

export type ShapeKind = "rrect" | "stadium" | "circle";

/** dome_base: outer top = z0 + rise·√(1 − (r/R)²), R = W/2 (tangent to the cylinder wall at r = R). */
export type DomeDims = { z0: number; rise: number };

export type EnclosureDims = {
  /** Template actually built. */
  template: BuildableTemplate;
  /** Template the spec asked for. */
  requested: EnclosureTemplate;
  shape: ShapeKind;
  W: number;
  D: number;
  /** Max outer height (back height for soft_wedge, dome apex for dome_base). */
  H: number;
  innerW: number;
  innerD: number;
  innerH: number;
  wall: number;
  clearance: number;
  cornerRadius: number;
  edgeFillet: number;
  floorZ: number;
  splitZ: number;
  lidStyle: "cap" | "plate";
  /** soft_wedge: top tilt (deg) and the front height. */
  wedgeDeg?: number;
  frontH?: number;
  /** handheld_taper: narrows by `amount` towards the + end of `axis`. */
  taper?: { axis: "x" | "y"; amount: number };
  /** dome_base: the domed lid. */
  dome?: DomeDims;
  /** Where the layout's origin goes inside the enclosure. */
  contentOffset: Vec3;
};

/** Lid lip: gap to the base wall, ring thickness, depth below the split. */
export const LIP = { gap: LIMITS.lidLip, thickness: 1.2, height: 3, flange: 0.9 } as const;
/** Extra side space so the lid's lip ring never touches a part. */
export const LIP_ALLOWANCE = LIP.gap + LIP.thickness;
/** Air above the tallest part besides the clearance. */
const LID_SPACE = 1.5;
const HEADROOM_MULT = { low: 1, mid: 1.4, tall: 2.2 } as const;
/** Minimum height : smaller-side ratio per heightBias (keeps "tall" looking tall). */
const BIAS_RATIO = { low: 0, mid: 0.3, tall: 0.65 } as const;
const WEDGE_DEG = { low: 12, mid: 15, tall: 18 } as const;
const TAPER_AMOUNT = 0.2;
/** Below this (front) height the lid is just the top plate. */
const PLATE_LID_BELOW = 24;
/** lantern: minimum height : side per heightBias, and its own height cap (exempt from the 2× rule). */
const LANTERN_RATIO = { low: 1.3, mid: 1.8, tall: 2.5 } as const;
export const LANTERN_MAX_RATIO = 3;
/** lantern: the lid is the upper band (light slots + label) from this share of H. */
export const LANTERN_SPLIT = 0.55;
/** dome_base: dome rise as a share of the diameter. */
const DOME_RISE = { low: 0.25, mid: 0.35, tall: 0.5 } as const;
/** wall_plate: smallest footprint side and corner radius (two keyholes need room). */
export const WALL_PLATE_MIN_SIDE = 40;
export const WALL_PLATE_MIN_RADIUS = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (n: number) => Math.round(n * 100) / 100;

export function resolveTemplate(t: EnclosureTemplate | string | undefined): BuildableTemplate {
  return (BUILDABLE_TEMPLATES as readonly string[]).includes(t ?? "") ? (t as BuildableTemplate) : "rounded_box";
}

// ---------------------------------------------------------------------------
// Shape queries (shared with build.ts / cutouts.ts / tests)
// ---------------------------------------------------------------------------

/** Outline of the cross-section after insetting by `inset` (undeformed). */
export function outlineAt(d: EnclosureDims, inset: number): { hw: number; hd: number; r: number } {
  const hw = d.W / 2 - inset;
  const hd = d.D / 2 - inset;
  if (d.shape === "circle") return { hw, hd, r: hw };
  if (d.shape === "stadium") return { hw, hd, r: Math.min(hw, hd) };
  return { hw, hd, r: Math.max(0.3, Math.min(d.cornerRadius - inset, hw, hd)) };
}

/** Taper factor for a surface inset by `inset`, at coordinate `c` along the taper axis. */
export function taperScale(d: EnclosureDims, c: number, inset: number): number {
  if (!d.taper) return 1;
  const len = d.taper.axis === "x" ? d.W : d.D;
  const half = (d.taper.axis === "x" ? d.D : d.W) / 2;
  // Full size over the wide end's rounded corner, then a linear taper.
  const start = Math.min(d.cornerRadius, len / 3);
  const a = clamp((c + len / 2 - start) / (len - start), 0, 1);
  const s = 1 - d.taper.amount * a;
  return (half * s - inset) / Math.max(1e-6, half - inset);
}

/** d(taperScale)/dc — for transforming normals. */
export function taperSlope(d: EnclosureDims, c: number, inset: number): number {
  if (!d.taper) return 0;
  const len = d.taper.axis === "x" ? d.W : d.D;
  const half = (d.taper.axis === "x" ? d.D : d.W) / 2;
  const start = Math.min(d.cornerRadius, len / 3);
  if (c + len / 2 < start || c > len / 2) return 0;
  return (-half * d.taper.amount) / (len - start) / Math.max(1e-6, half - inset);
}

function insideRounded(hw: number, hd: number, r: number, x: number, y: number): boolean {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > hw + 1e-9 || ay > hd + 1e-9) return false;
  const cx = hw - r;
  const cy = hd - r;
  if (ax > cx && ay > cy) return (ax - cx) ** 2 + (ay - cy) ** 2 <= r * r + 1e-9;
  return true;
}

/** Is (x, y) inside the (tapered) cross-section inset by `inset`? */
export function insideSection(d: EnclosureDims, x: number, y: number, inset: number): boolean {
  let px = x;
  let py = y;
  if (d.taper?.axis === "x") py = y / taperScale(d, x, inset);
  else if (d.taper?.axis === "y") px = x / taperScale(d, y, inset);
  const o = outlineAt(d, inset);
  if (o.hw <= 0 || o.hd <= 0) return false;
  return insideRounded(o.hw, o.hd, o.r, px, py);
}

export type TopDims = Pick<EnclosureDims, "H" | "D" | "wedgeDeg"> & { W?: number; dome?: DomeDims };

/** Outer top surface height at (x, y). x only matters for dome_base (defaults to the centre line). */
export function topAt(d: TopDims, y: number, x = 0): number {
  if (d.dome) {
    const R = (d.W ?? d.D) / 2;
    const q = 1 - (x * x + y * y) / (R * R);
    return d.dome.z0 + d.dome.rise * Math.sqrt(Math.max(0, q));
  }
  if (!d.wedgeDeg) return d.H;
  return d.H + (Math.min(y, d.D / 2) - d.D / 2) * Math.tan((d.wedgeDeg * Math.PI) / 180);
}

/**
 * The lid's inner (cavity) ceiling at (x, y): topAt − wall; for the dome also never above the
 * inner ellipsoid (semi-axes R − wall, rise − wall), so the dome shell stays ≥ wall thick.
 * build.ts makes the cavity exactly this surface.
 */
export function innerTopAt(d: EnclosureDims, y: number, x = 0): number {
  const flat = topAt(d, y, x) - d.wall;
  if (!d.dome) return flat;
  const Ri = d.W / 2 - d.wall;
  const q = 1 - (x * x + y * y) / (Ri * Ri);
  const ell = d.dome.z0 + Math.max(0, d.dome.rise - d.wall) * Math.sqrt(Math.max(0, q));
  return Math.min(flat, ell);
}

/** Lowest / highest outer top over an axis-aligned XY rectangle (corners, plus the point nearest the dome's centre). */
export function topRange(d: TopDims, x0: number, x1: number, y0: number, y1: number): { lo: number; hi: number } {
  const vals = [topAt(d, y0, x0), topAt(d, y0, x1), topAt(d, y1, x0), topAt(d, y1, x1)];
  if (d.dome) vals.push(topAt(d, clamp(0, y0, y1), clamp(0, x0, x1)));
  return { lo: Math.min(...vals), hi: Math.max(...vals) };
}

/** Wedge vertex shift: z' = z + delta(y)·blend(z). */
export function wedgeShift(d: EnclosureDims): { zA: number; zB: number; slope: number } | null {
  if (!d.wedgeDeg) return null;
  const zA = Math.max(d.edgeFillet, d.wall) + 0.5;
  let zB = d.H - Math.max(d.edgeFillet, d.wall) - 1;
  if (zB < zA + 1) zB = zA + 1;
  return { zA, zB, slope: Math.tan((d.wedgeDeg * Math.PI) / 180) };
}

/** Is p inside the air cavity, at least `margin` from every inner wall (floor contact allowed)? */
export function pointInCavity(d: EnclosureDims, p: Vec3, margin = 0): boolean {
  const [x, y, z] = p;
  if (z < d.floorZ - 1e-6) return false;
  if (z > innerTopAt(d, y, x) - margin + 1e-6) return false;
  return insideSection(d, x, y, d.wall + margin);
}

/** Distance from (ox, oy) along (dx, dy) to the outer surface (bisection). */
export function exitDistance(d: EnclosureDims, ox: number, oy: number, dx: number, dy: number, inset = 0): number {
  let lo = 0;
  let hi = d.W + d.D;
  if (!insideSection(d, ox, oy, inset)) return 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (insideSection(d, ox + dx * mid, oy + dy * mid, inset)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

type Need = { iw: number; id: number; ih: number };

/** Templates with a square / round footprint (widthToDepth is ignored). */
const SQUARE_FOOTPRINT: readonly BuildableTemplate[] = ["puck", "dome_base", "lantern"];

function shapeDims(tpl: BuildableTemplate, spec: EnclosureSpec, need: Need): EnclosureDims {
  const wall = clamp(spec.wall, LIMITS.wall.min, LIMITS.wall.max);
  const clearance = clamp(spec.clearance, LIMITS.clearance.min, LIMITS.clearance.max);
  const bias = spec.proportions.heightBias;
  let W = need.iw + 2 * wall;
  let D = need.id + 2 * wall;
  if (SQUARE_FOOTPRINT.includes(tpl)) {
    W = D = Math.max(W, D);
  } else {
    const r = clamp(spec.proportions.widthToDepth, LIMITS.widthToDepth.min, LIMITS.widthToDepth.max);
    // Only ever GROW a side to reach the requested proportion.
    if (W / D < r) W = D * r;
    else D = Math.max(D, W / r);
  }
  const minFoot = tpl === "wall_plate" ? WALL_PLATE_MIN_SIDE : LIMITS.minFootprint;
  W = Math.max(W, minFoot);
  D = Math.max(D, minFoot);
  const minSide = Math.min(W, D);

  let H = need.ih + 2 * wall;
  // A wall plate stays as thin as its parts allow; a lantern is tall on purpose.
  const ratio = tpl === "lantern" ? LANTERN_RATIO[bias] : tpl === "wall_plate" ? 0 : BIAS_RATIO[bias];
  H = Math.max(H, ratio * minSide, 2 * wall + LIP.height + 4);

  let dome: DomeDims | undefined;
  if (tpl === "dome_base") {
    // The parts fit under the shoulder (z0); the dome on top is the lid.
    const z0 = Math.max(H - wall, 2 * wall + LIP.height + 6);
    const rise = Math.max(wall + 6, DOME_RISE[bias] * W);
    dome = { z0: r1(z0), rise: r1(rise) };
    H = dome.z0 + dome.rise;
  }

  let frontH: number | undefined;
  let wedgeDeg: number | undefined;
  if (tpl === "soft_wedge") {
    wedgeDeg = WEDGE_DEG[bias];
    frontH = H;
    H = frontH + D * Math.tan((wedgeDeg * Math.PI) / 180);
  }

  const shape: ShapeKind = tpl === "puck" || tpl === "dome_base" ? "circle" : tpl === "pill" ? "stadium" : "rrect";
  const wantR = tpl === "wall_plate" ? Math.max(spec.cornerRadius, WALL_PLATE_MIN_RADIUS) : spec.cornerRadius;
  const cornerRadius =
    shape === "circle" ? W / 2 : shape === "stadium" ? minSide / 2 : clamp(wantR, LIMITS.cornerRadius.min, 0.33 * minSide);
  const edgeFillet = clamp(
    Math.min(spec.edgeFillet, 0.9 * wall, cornerRadius - 0.5, (dome ? dome.z0 : H) / 4),
    LIMITS.edgeFillet.min,
    LIMITS.edgeFillet.max,
  );

  const href = frontH ?? H;
  const innerTopRef = href - wall;
  let splitZ: number;
  let lidStyle: "cap" | "plate";
  if (dome) {
    // Just under the shoulder, so the lip flange sits in the cylindrical wall.
    splitZ = dome.z0 - 4;
    lidStyle = "cap";
  } else if (tpl === "lantern") {
    // The lid is the upper band: the light slots and the label live on it.
    splitZ = Math.round(H * LANTERN_SPLIT * 10) / 10;
    lidStyle = "cap";
    if (splitZ + LIP.flange + 2.5 > innerTopRef) splitZ = innerTopRef - LIP.flange - 2.5;
  } else if (href < PLATE_LID_BELOW) {
    splitZ = innerTopRef - 1.2;
    lidStyle = "plate";
  } else {
    splitZ = Math.round(href * 0.68 * 10) / 10;
    lidStyle = "cap";
    if (splitZ + LIP.flange + 2.5 > innerTopRef) splitZ = innerTopRef - LIP.flange - 2.5;
  }
  splitZ = Math.max(splitZ, wall + LIP.height + 0.8);

  return {
    template: tpl,
    requested: spec.template,
    shape,
    W: r1(W),
    D: r1(D),
    H: r1(H),
    innerW: r1(W - 2 * wall),
    innerD: r1(D - 2 * wall),
    innerH: r1(H - 2 * wall),
    wall,
    clearance,
    cornerRadius: r1(cornerRadius),
    edgeFillet: r1(edgeFillet),
    floorZ: wall,
    splitZ: r1(splitZ),
    lidStyle,
    ...(wedgeDeg !== undefined ? { wedgeDeg, frontH: r1(frontH!) } : {}),
    ...(tpl === "handheld_taper" ? { taper: { axis: W >= D ? ("x" as const) : ("y" as const), amount: TAPER_AMOUNT } } : {}),
    ...(dome ? { dome } : {}),
    contentOffset: [0, 0, wall],
  };
}

/** Height cap for a template: 2 × the smaller footprint side; a lantern may reach 3 ×. */
export function maxHeightRatio(template: EnclosureTemplate | string): number {
  return template === "lantern" ? LANTERN_MAX_RATIO : LIMITS.maxHeightRatio;
}

/** Design rule: H ≤ maxHeightRatio × the smaller footprint side. */
export function heightRuleOk(d: Pick<EnclosureDims, "H" | "W" | "D" | "template">): boolean {
  return d.H <= maxHeightRatio(d.template) * Math.min(d.W, d.D) + 1e-6;
}

/** Every corner of the layout box (+ clearance + lip allowance) sits inside the cavity. */
export function contentFits(d: EnclosureDims, lr: Pick<LayoutResult, "bbox" | "bodyHeight">, clearance = d.clearance): boolean {
  const m = clearance + LIP_ALLOWANCE;
  const { min, max } = lr.bbox;
  const z0 = d.floorZ + min[2];
  // Poke-through domes are allowed to leave the cavity through the lid.
  const z1 = d.floorZ + (lr.bodyHeight ?? max[2]) + clearance;
  for (const x of [min[0] - m, max[0] + m]) {
    for (const y of [min[1] - m, max[1] + m]) {
      if (!insideSection(d, x, y, d.wall)) return false;
      if (z0 < d.floorZ - 1e-6 || z1 > innerTopAt(d, y, x) + 1e-6) return false;
    }
  }
  return true;
}

export function enclosureDims(spec: EnclosureSpec, lr: LayoutResult): EnclosureDims {
  const tpl = resolveTemplate(spec.template);
  const wall = clamp(spec.wall, LIMITS.wall.min, LIMITS.wall.max);
  const c = clamp(spec.clearance, LIMITS.clearance.min, LIMITS.clearance.max);
  const m = c + LIP_ALLOWANCE;
  // The layout box is centred on XY, but use its real extents to be safe.
  const fw = 2 * Math.max(Math.abs(lr.bbox.min[0]), Math.abs(lr.bbox.max[0]));
  const fd = 2 * Math.max(Math.abs(lr.bbox.min[1]), Math.abs(lr.bbox.max[1]));
  const need: Need = {
    iw: Math.max(fw + 2 * m, LIMITS.minFootprint - 2 * wall),
    id: Math.max(fd + 2 * m, LIMITS.minFootprint - 2 * wall),
    ih: (lr.bodyHeight ?? lr.height) + (c + LID_SPACE) * HEADROOM_MULT[spec.proportions.heightBias],
  };
  // A poke-through dome must still stand on the floor with its top POKE_OUT above the lid.
  if (lr.pokeHeight) need.ih = Math.max(need.ih, lr.pokeHeight - POKE_OUT - wall);
  const square = SQUARE_FOOTPRINT.includes(tpl);
  let d = shapeDims(tpl, spec, need);
  for (let i = 0; i < 200; i++) {
    if (!heightRuleOk(d)) {
      // Too tall for its footprint → grow the footprint (never squash the content).
      const target = d.H / maxHeightRatio(tpl) - 2 * wall + 0.5;
      if (d.W <= d.D || square) need.iw = Math.max(need.iw + 0.5, target);
      if (d.D <= d.W || square) need.id = Math.max(need.id + 0.5, target);
    } else if (!contentFits(d, lr, c)) {
      const step = Math.max(1, 0.03 * Math.max(need.iw, need.id));
      need.iw += step;
      need.id += step;
    } else {
      return d;
    }
    d = shapeDims(tpl, spec, need);
  }
  return d;
}

/**
 * Lift every poke-through sensor (the PIR) so its dome top is POKE_OUT mm above the lid's
 * OUTER top surface (so also above the inner one) at the sensor's position. Other parts keep
 * their place. Pure: returns a new array, same order. cutouts.ts / the viewer use the result.
 */
export function settlePokes(layout: LayoutItem[], parts: Map<string, LibraryPart>, d: EnclosureDims): LayoutItem[] {
  return layout.map((it) => {
    const part = parts.get(it.instanceId);
    if (!part || !isPokeSensor(part)) return it;
    const x = it.pos[0] + d.contentOffset[0];
    const y = it.pos[1] + d.contentOffset[1];
    // Never below its own standoffs (mech/place.ts fills floor → board underside).
    const z = Math.max(mountLift(part), topAt(d, y, x) + POKE_OUT - d.contentOffset[2] - part.dims.z);
    return { ...it, pos: [it.pos[0], it.pos[1], Math.round(z * 1000) / 1000] };
  });
}

/** Air gap between a top-port part (screen, button, light pipe) and the lid's inner surface (mm). */
export const LID_GAP = 0.5;

/**
 * Gap under the lid's inner surface for a top-port part. A button (top button cap) leaves
 * room for the shortest printed extender: flange + shaft + cap, minus what pokes out.
 */
export function lidGapFor(part: LibraryPart, wall: number): number {
  if (!part.ports.some((p) => p.face === "+z" && p.kind === "button_cap")) return LID_GAP;
  const e = THROUGH_LID.extender;
  return Math.max(LID_GAP, e.flange + MECH_PARAMS.button_extender.length[0] + e.capT - e.proud - wall);
}

/**
 * Where the parts stand in THIS case (what cutoutsFor cuts for and the viewer draws):
 *  - poke-through sensors (the PIR) are lifted so the dome pokes out (settlePokes);
 *  - every other part with a +z port (screen, button, light pipe, grille) is lifted so its
 *    top is LID_GAP under the lid's inner surface over its whole footprint (a button: room
 *    for its printed extender, lidGapFor). The layout only
 *    levels them with the tallest stack, which can be far below the lid (a tall, sloped or
 *    domed case): a screen there is not seen through its own window. Never lowered, never
 *    pushed into a part stacked above it. Pure: new array, same order.
 */
export function settleLayout(layout: LayoutItem[], parts: Map<string, LibraryPart>, d: EnclosureDims): LayoutItem[] {
  const poked = settlePokes(layout, parts, d);
  const [ox, oy, oz] = d.contentOffset;
  return poked.map((it) => {
    const part = parts.get(it.instanceId);
    if (!part || isPokeSensor(part) || !hasTopPort(part)) return it;
    const box = worldBox(it, part);
    // The lowest point of the lid's inner surface over the part (wedge: along y; dome: radial).
    let ceiling =
      Math.min(
        innerTopAt(d, box.min[1] + oy, box.min[0] + ox),
        innerTopAt(d, box.min[1] + oy, box.max[0] + ox),
        innerTopAt(d, box.max[1] + oy, box.min[0] + ox),
        innerTopAt(d, box.max[1] + oy, box.max[0] + ox),
      ) - lidGapFor(part, d.wall) - oz;
    for (const other of poked) {
      if (other === it) continue;
      const op = parts.get(other.instanceId);
      if (!op) continue;
      const ob = worldBox(other, op);
      const overlapXY = ob.min[0] < box.max[0] && box.min[0] < ob.max[0] && ob.min[1] < box.max[1] && box.min[1] < ob.max[1];
      if (overlapXY && ob.min[2] >= box.max[2] - 1e-6) ceiling = Math.min(ceiling, ob.min[2]);
    }
    const z = Math.round((ceiling - part.dims.z) * 1000) / 1000;
    return z > it.pos[2] ? { ...it, pos: [it.pos[0], it.pos[1], z] } : it;
  });
}

// ---------------------------------------------------------------------------
// Default template suggestion (safe fallback when the AI fails)
// ---------------------------------------------------------------------------

export function templateFor(spec: ProductSpec): EnclosureTemplate {
  const text = `${spec.name} ${spec.oneLine} ${spec.features.join(" ")}`.toLowerCase();
  const round = /\b(round|circular|puck|disc|disk|coaster|dome|domed)\b/.test(text);
  const lampish = /\b(lamp|light|lights|nightlight|glow|lantern)\b/.test(text);
  const sensorish = /\b(sensor|motion|presence|pir|detector|smoke|air|temperature|humidity)\b/.test(text);
  const ring = /\b(ring|neopixel|ws2812|rgb)\b/.test(text);
  const carried = spec.use === "handheld" || spec.use === "wearable";
  if (spec.use === "wall") return "wall_plate";
  // Tall light / speaker products standing on a desk.
  const tallOutput = spec.outputs.includes("speaker") || (spec.outputs.includes("led") && (ring || lampish));
  if (tallOutput && !carried && (spec.sizeHint === "desk" || spec.sizeHint === "large")) return "lantern";
  // Round sensors / lamps / speakers on a desk.
  if (round && !carried && (sensorish || lampish || spec.outputs.includes("speaker"))) return "dome_base";
  if (round && (spec.sizeHint === "pocket" || spec.sizeHint === "palm")) return "puck";
  if (spec.use === "desk" && spec.outputs.includes("screen")) return "soft_wedge";
  if (spec.use === "wearable") return "pill";
  if (spec.use === "handheld") return spec.sizeHint === "pocket" ? "pill" : "handheld_taper";
  return "rounded_box";
}

/** A complete, valid EnclosureSpec for a product — used when the AI answer is unusable. */
export function defaultEnclosureFor(spec: ProductSpec): EnclosureSpec {
  const template = templateFor(spec);
  const heightBias = spec.use === "wall" || template === "puck" || template === "wall_plate" ? "low" : "mid";
  const square = template === "puck" || template === "dome_base" || template === "lantern";
  const widthToDepth = square ? 1 : template === "pill" || template === "handheld_taper" ? 2 : 1.4;
  const feet: EnclosureSpec["feet"] =
    template === "wall_plate" ? "none" : template === "dome_base" ? "ring" : spec.use === "desk" ? "rubber_4" : "none";
  const out: EnclosureSpec = {
    ...DEFAULT_ENCLOSURE,
    template,
    proportions: { widthToDepth, heightBias },
    feet,
    ...(spec.environment === "outdoor" ? { wall: 2.4 } : {}),
  };
  if (template === "wall_plate") out.cornerRadius = 8;
  if (template === "lantern") out.vents = { pattern: "slots", face: "+x", count: 6 };
  if (template === "dome_base" && spec.outputs.includes("speaker")) out.vents = { pattern: "grille", face: "+z", count: 9 };
  return out;
}
