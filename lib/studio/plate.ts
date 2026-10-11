// The Parts step "plate": every picked part laid out on a round plate (mm, Z up).
// Pure maths, shared by the 3D viewer (plate mode) and the geometry worker's
// parts picture (lib/studio/geometry/parts-render.ts), so both look the same.

import type { LibraryPart } from "./schema";

export type PlateItem = { instanceId: string; partId: string };
export type PlatePlacement<T extends PlateItem = PlateItem> = {
  c: T;
  pos: [number, number, number];
  rotZ: number;
  bobPhase: number;
};

/** Plate thickness, and how high the parts float above it (mm). */
export const PLATE_T = 4;
export const PLATE_LIFT = 3;
/** Gap between parts on the plate, and the rim around them (mm). */
const PLATE_GAP = 5;
const PLATE_MARGIN = 12;

export function footprint(part: Pick<LibraryPart, "dims"> | undefined, rotZ = 0): { w: number; d: number; h: number } {
  const x = part?.dims.x ?? 20;
  const y = part?.dims.y ?? 20;
  const z = part?.dims.z ?? 6;
  const swap = rotZ === 90 || rotZ === 270;
  return { w: swap ? y : x, d: swap ? x : y, h: z };
}

/**
 * A compact shelf packing (rows centred, small gaps, largest parts first). The shelf
 * width is searched for the smallest circle around the cluster, so the plate hugs the
 * parts (content radius + margin) and they read large when the camera fits the plate.
 */
export function platePlacements<T extends PlateItem>(
  components: T[],
  parts: Map<string, Pick<LibraryPart, "dims">>,
): { placements: PlatePlacement<T>[]; radius: number } {
  const n = components.length;
  if (n === 0) return { placements: [], radius: 60 };
  const items = components
    .map((c, i) => ({ c, i, ...footprint(parts.get(c.instanceId)) }))
    .sort((a, b) => b.w * b.d - a.w * a.d || a.i - b.i);
  const maxW = Math.max(...items.map((it) => it.w));
  const sumW = items.reduce((t, it) => t + it.w, 0) + PLATE_GAP * (n - 1);

  const pack = (target: number) => {
    const rows: (typeof items)[] = [];
    let cur: typeof items = [];
    let curW = 0;
    for (const it of items) {
      const next = cur.length ? curW + PLATE_GAP + it.w : it.w;
      if (cur.length && next > target + 1e-9) {
        rows.push(cur);
        cur = [it];
        curW = it.w;
      } else {
        cur.push(it);
        curW = next;
      }
    }
    if (cur.length) rows.push(cur);
    const rowW = rows.map((r) => r.reduce((t, it) => t + it.w, 0) + PLATE_GAP * (r.length - 1));
    const rowD = rows.map((r) => Math.max(...r.map((it) => it.d)));
    const totalD = rowD.reduce((t, d) => t + d, 0) + PLATE_GAP * (rows.length - 1);
    const out: { it: (typeof items)[number]; x: number; y: number }[] = [];
    let y = totalD / 2;
    rows.forEach((r, ri) => {
      let x = -rowW[ri] / 2;
      for (const it of r) {
        out.push({ it, x: x + it.w / 2, y: y - rowD[ri] / 2 });
        x += it.w + PLATE_GAP;
      }
      y -= rowD[ri] + PLATE_GAP;
    });
    // Radius of the circle (about the origin) that holds every corner.
    let radius = 0;
    for (const o of out) radius = Math.max(radius, Math.hypot(Math.abs(o.x) + o.it.w / 2, Math.abs(o.y) + o.it.d / 2));
    return { out, radius };
  };

  let best = pack(maxW);
  for (let k = 1; k <= 24; k++) {
    const cand = pack(maxW + ((sumW - maxW) * k) / 24);
    if (cand.radius < best.radius - 1e-6) best = cand;
  }
  const placements: PlatePlacement<T>[] = best.out.map(({ it, x, y }) => ({
    c: it.c,
    pos: [x, y, PLATE_LIFT],
    rotZ: 0,
    bobPhase: it.i * 1.7,
  }));
  return { placements, radius: Math.max(30, best.radius) + PLATE_MARGIN };
}
