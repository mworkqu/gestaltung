// Is this mesh something a slicer can print? (F-003)
//
// The tester's files were triangle soups: the lid had 2,483 unbalanced edges and
// trimesh read 297 separate shells, so PrusaSlicer had nothing solid to fill.
// Nothing downstream can repair that — manifold-3d refuses the same mesh with
// "Not manifold" even after merging coincident vertices — so the ONE rule is:
// check every body before it is offered, and refuse the file when it fails.
//
// Pure typed-array maths (no three.js, no WASM), so the worker, the main thread
// and vitest all run the same check.

import { meshIsWatertight, type MeshArrays } from "../product/stl";

export type PrintCheck = {
  /** Closed, one piece, consistently wound — safe to hand to a slicer. */
  ok: boolean;
  watertight: boolean;
  /** Edges used an unequal number of times in each direction (0 = consistent winding). */
  badEdges: number;
  /** Connected components over welded vertices; a printable body is exactly 1. */
  shells: number;
  triangles: number;
};

/** Vertex ids after welding positions onto a `grid` mm lattice. */
function weldIds(positions: Float32Array, grid: number): { weld: Uint32Array; count: number } {
  const key = new Map<string, number>();
  const weld = new Uint32Array(positions.length / 3);
  for (let i = 0; i < weld.length; i++) {
    const k = `${Math.round(positions[i * 3] / grid)},${Math.round(positions[i * 3 + 1] / grid)},${Math.round(positions[i * 3 + 2] / grid)}`;
    let id = key.get(k);
    if (id === undefined) {
      id = key.size;
      key.set(k, id);
    }
    weld[i] = id;
  }
  return { weld, count: key.size };
}

/** Connected triangle groups (welded vertices shared by two triangles join them). */
export function shellCount(m: MeshArrays, grid = 1e-3): number {
  const { weld, count } = weldIds(m.positions, grid);
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) {
      const next = parent[a];
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const used = new Set<number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [weld[m.indices[t]], weld[m.indices[t + 1]], weld[m.indices[t + 2]]];
    for (const x of v) used.add(x);
    const r0 = find(v[0]);
    for (let e = 1; e < 3; e++) {
      const r = find(v[e]);
      if (r !== r0) parent[r] = r0;
    }
  }
  const roots = new Set<number>();
  for (const v of used) roots.add(find(v));
  return roots.size;
}

/** The manifold check: watertight AND one shell AND consistent winding. */
export function checkPrintable(m: MeshArrays, grid = 1e-3): PrintCheck {
  const wt = meshIsWatertight(m, grid);
  const shells = wt.triangles > 0 ? shellCount(m, grid) : 0;
  return { ok: wt.ok && shells === 1, watertight: wt.ok, badEdges: wt.badEdges, shells, triangles: wt.triangles };
}

// ---------------------------------------------------------------------------
// Print plates (F-003): nothing may leave the studio larger than the bed.
// ---------------------------------------------------------------------------

/** Usable Prusa MK4 bed (mm). The tester's single plate was 406 mm long. */
export const MK4_BED = { x: 250, y: 210, z: 220 } as const;
/** Skirt / brim room kept clear round the outside of a plate. */
export const PLATE_MARGIN = 5;
/** Gap between two parts on one plate. */
export const PLATE_GAP = 6;

export type PlateItem = { w: number; d: number; h: number };
export type PlacedOnPlate = { index: number; x: number; y: number };
export type Plate = { items: PlacedOnPlate[]; w: number; d: number };
export type PlatePlan = { plates: Plate[]; tooBig: number[] };

/**
 * Shelf-pack parts onto as many beds as it takes. `x`/`y` are the centre each
 * part must be moved to, measured from the middle of the bed. A part that does
 * not fit a bed on its own is listed in `tooBig` and never put on a plate.
 */
export function platePlan(items: readonly PlateItem[], bed: { x: number; y: number; z: number } = MK4_BED, gap = PLATE_GAP): PlatePlan {
  const usableW = bed.x - 2 * PLATE_MARGIN;
  const usableD = bed.y - 2 * PLATE_MARGIN;
  const tooBig: number[] = [];
  const fits = items
    .map((it, index) => ({ ...it, index }))
    .filter((it) => {
      if (it.w <= usableW && it.d <= usableD && it.h <= bed.z) return true;
      tooBig.push(it.index);
      return false;
    })
    // Tallest shelf first keeps the rows tidy; `index` breaks ties so it is deterministic.
    .sort((a, b) => b.d - a.d || b.w - a.w || a.index - b.index);

  const plates: Plate[] = [];
  let rows: { items: typeof fits; w: number; d: number }[] = [];
  let usedD = 0;

  const flush = () => {
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.w));
    const d = usedD;
    const placed: PlacedOnPlate[] = [];
    let y = -d / 2;
    for (const r of rows) {
      let x = -r.w / 2;
      for (const it of r.items) {
        placed.push({ index: it.index, x: x + it.w / 2, y: y + r.d / 2 });
        x += it.w + gap;
      }
      y += r.d + gap;
    }
    plates.push({ items: placed.sort((a, b) => a.index - b.index), w, d });
    rows = [];
    usedD = 0;
  };

  for (const it of fits) {
    const row = rows[rows.length - 1];
    if (row && row.w + gap + it.w <= usableW && it.d <= row.d) {
      row.items.push(it);
      row.w += gap + it.w;
      continue;
    }
    const addD = usedD === 0 ? it.d : usedD + gap + it.d;
    if (addD > usableD) flush();
    usedD = usedD === 0 ? it.d : usedD + gap + it.d;
    rows.push({ items: [it], w: it.w, d: it.d });
  }
  flush();
  return { plates, tooBig };
}
