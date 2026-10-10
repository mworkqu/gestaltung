// Pure explode-view math for the Design Studio viewer (no three.js, runs in vitest).
//
// Every object in the viewer has a REST position (mm, Z up). The exploded
// position is `rest + explodeOffset(...)`. The offset is 0 at t = 0, grows
// monotonically with t and only depends on t through ease(t), so moving the
// slider back to 0 always lands on the exact rest position (reversible).
//
// The full explode (t = 1) reads like a product-configurator exploded view:
//  * the base stays put and only drops a little (BASE_DROP_MM);
//  * components rise out of the base in layers (higher rest z → higher layer →
//    higher lift) and spread outwards from the centre;
//  * printed helpers (mech/place.ts) float between their part and their target:
//    standoffs / cradles under their part, extenders / light pipes between the
//    part and the lid;
//  * the lid rises well above everything: LID_LIFT · H + the tallest part.

export type Vec3 = [number, number, number];

/** What kind of object is being exploded. */
export type ExplodeKind = "lid" | "base" | "component" | "extra";

/** The numbers every offset is derived from (one per scene, see explodeFrame). */
export type ExplodeFrame = {
  /** XY centre the components spread away from. */
  centre: Vec3;
  /** Enclosure (or content) height, mm. */
  H: number;
  /** Height of the tallest single part, mm. */
  tallest: number;
  /** Number of height layers (≥ 1). */
  layers: number;
  /** Larger side of the content footprint, mm. */
  span: number;
  /** Top of the base (the lid split), mm; components rise until they clear it. Default 0.7 · H. */
  baseTop?: number;
};

/** Smooth ease-in-out (cubic) on [0, 1]; t is clamped. ease(0) = 0, ease(1) = 1. */
export function easeExplode(t: number): number {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Base down-shift (mm) at full explode. */
export const BASE_DROP_MM = 6;
/** Lid lift at full explode: LID_LIFT · H + the tallest part. */
export const LID_LIFT = 1.5;
/**
 * Components at full explode: their bottom rises to baseTop + COMP_CLEAR · H, plus
 * LAYER_LIFT · H spread over the height layers (lowest layer lowest), and at least
 * MIN_COMP_LIFT · H — so every part clearly leaves the base.
 */
export const COMP_CLEAR = 0.55;
export const LAYER_LIFT = 0.6;
export const MIN_COMP_LIFT = 0.35;
/** Radial push of components at full explode, as a fraction of the footprint span (min 8 mm). */
export const RADIAL_PUSH = 0.3;
const MIN_PUSH = 8;

const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Lid lift (mm) at full explode. */
export function lidLiftMm(H: number, tallest: number): number {
  return pos(H) * LID_LIFT + pos(tallest);
}

/** Component lift (mm) at full explode for a part resting with its bottom at `restZ` in height layer `layer`. */
export function componentLiftMm(frame: Pick<ExplodeFrame, "H" | "layers" | "baseTop">, layer: number, restZ: number): number {
  const H = pos(frame.H);
  const n = Math.max(1, Math.floor(frame.layers) || 1);
  const l = Math.min(n - 1, Math.max(0, Math.floor(layer) || 0));
  const frac = n > 1 ? l / (n - 1) : 0;
  const baseTop = Number.isFinite(frame.baseTop) ? (frame.baseTop as number) : 0.7 * H;
  const z = Number.isFinite(restZ) ? restZ : 0;
  return Math.max(MIN_COMP_LIFT * H, baseTop + H * (COMP_CLEAR + LAYER_LIFT * frac) - z);
}

/** Full-explode (t = 1) offset of a component resting at `rest` in height layer `layer`. */
export function componentVector(rest: Vec3, frame: ExplodeFrame, layer: number): Vec3 {
  const dx = rest[0] - frame.centre[0];
  const dy = rest[1] - frame.centre[1];
  const len = Math.hypot(dx, dy);
  const push = Math.max(MIN_PUSH, pos(frame.span) * RADIAL_PUSH);
  const ux = len > 1e-6 ? dx / len : 0;
  const uy = len > 1e-6 ? dy / len : 0;
  return [ux * push, uy * push, componentLiftMm(frame, layer, rest[2])];
}

/**
 * Offset to add to the rest position (= the full-explode vector · ease(t)).
 *  - lid:       straight up by lidLiftMm
 *  - base:      down by BASE_DROP_MM
 *  - component: outwards from the centre in XY + up by its height layer
 *  - extra:     along `vector` (the caller's own explode vector, full length at t = 1)
 */
export function explodeOffset(
  kind: ExplodeKind,
  rest: Vec3,
  frame: ExplodeFrame,
  layerIndex: number,
  t: number,
  vector?: Vec3,
): Vec3 {
  const e = easeExplode(t);
  if (e === 0) return [0, 0, 0];
  let v: Vec3;
  switch (kind) {
    case "lid":
      v = [0, 0, lidLiftMm(frame.H, frame.tallest)];
      break;
    case "base":
      v = [0, 0, -BASE_DROP_MM];
      break;
    case "extra":
      v = vector ?? [0, 0, 0];
      break;
    case "component":
      v = componentVector(rest, frame, layerIndex);
      break;
  }
  return [v[0] * e, v[1] * e, v[2] * e];
}

/**
 * Height rank per rest z (ascending; equal z within 0.5 mm share a layer).
 * Returns a layer index per input, in input order.
 */
export function heightLayers(restZ: number[]): number[] {
  const uniq: number[] = [];
  for (const z of [...restZ].sort((a, b) => a - b)) {
    if (uniq.length === 0 || z - uniq[uniq.length - 1] > 0.5) uniq.push(z);
  }
  return restZ.map((z) => {
    let idx = 0;
    for (let i = 0; i < uniq.length; i++) if (z >= uniq[i] - 0.5) idx = i;
    return idx;
  });
}

/** One placed part as the explode sees it: rest position (its origin) + rotated footprint + height. */
export type ExplodeItem = { pos: Vec3; w: number; d: number; h: number };

/**
 * The scene frame + each item's layer. Used by the viewer (components) AND by
 * mech/place.ts (vectors of the printed parts), so both agree on every number.
 */
export function explodeFrame(
  items: readonly ExplodeItem[],
  H: number,
  baseTop?: number,
): { frame: ExplodeFrame; layers: number[] } {
  const bt = Number.isFinite(baseTop) ? { baseTop } : {};
  if (items.length === 0) return { frame: { centre: [0, 0, 0], H: pos(H), tallest: 0, layers: 1, span: 0, ...bt }, layers: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, tallest = 0;
  for (const it of items) {
    minX = Math.min(minX, it.pos[0] - it.w / 2);
    maxX = Math.max(maxX, it.pos[0] + it.w / 2);
    minY = Math.min(minY, it.pos[1] - it.d / 2);
    maxY = Math.max(maxY, it.pos[1] + it.d / 2);
    tallest = Math.max(tallest, it.h);
  }
  const layers = heightLayers(items.map((it) => it.pos[2]));
  return {
    frame: {
      centre: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
      H: pos(H),
      tallest,
      layers: Math.max(1, ...layers.map((l) => l + 1)),
      span: Math.max(maxX - minX, maxY - minY),
      ...bt,
    },
    layers,
  };
}
