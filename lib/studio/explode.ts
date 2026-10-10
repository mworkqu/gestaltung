// Pure explode-view math for the Design Studio viewer (no three.js, runs in vitest).
//
// Every object in the viewer has a REST position (mm, Z up). The exploded
// position is `rest + explodeOffset(...)`. The offset is 0 at t = 0, grows
// monotonically with t and only depends on t through ease(t), so moving the
// slider back to 0 always lands on the exact rest position (reversible).

export type Vec3 = [number, number, number];

/** What kind of object is being exploded. */
export type ExplodeKind = "lid" | "base" | "component" | "extra";

/** Smooth ease-in-out (cubic) on [0, 1]; t is clamped. ease(0) = 0, ease(1) = 1. */
export function easeExplode(t: number): number {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Base down-shift (mm) at full explode. */
export const BASE_DROP_MM = 10;
/** Lid lift at full explode, as a fraction of the enclosure height H. */
export const LID_LIFT = 0.9;
/** Radial push of components at full explode, as a fraction of H (min 12 mm). */
export const RADIAL_PUSH = 0.45;
/** Vertical spread per height layer, as a fraction of H. */
export const LAYER_LIFT = 0.25;

/**
 * Offset to add to the rest position.
 *  - lid:       straight up by H · 0.9
 *  - base:      down by 10 mm
 *  - component: outwards from `centre` in XY (radial) + up by its height rank
 *  - extra:     along `vector` (the caller's own explode vector, full length at t = 1)
 */
export function explodeOffset(
  kind: ExplodeKind,
  rest: Vec3,
  centre: Vec3,
  H: number,
  layerIndex: number,
  t: number,
  vector?: Vec3,
): Vec3 {
  const e = easeExplode(t);
  if (e === 0) return [0, 0, 0];
  const h = Number.isFinite(H) && H > 0 ? H : 0;
  switch (kind) {
    case "lid":
      return [0, 0, h * LID_LIFT * e];
    case "base":
      return [0, 0, -BASE_DROP_MM * e];
    case "extra": {
      const v = vector ?? [0, 0, 0];
      return [v[0] * e, v[1] * e, v[2] * e];
    }
    case "component": {
      const dx = rest[0] - centre[0];
      const dy = rest[1] - centre[1];
      const len = Math.hypot(dx, dy);
      const push = Math.max(12, h * RADIAL_PUSH);
      const ux = len > 1e-6 ? dx / len : 0;
      const uy = len > 1e-6 ? dy / len : 0;
      const layer = Math.max(0, Math.floor(layerIndex) || 0);
      // Even a single-layer build lifts a little so parts clear the base floor.
      const lift = h * LAYER_LIFT * (layer + 1) * 0.5;
      return [ux * push * e, uy * push * e, lift * e];
    }
  }
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
