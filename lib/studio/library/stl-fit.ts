// How an uploaded STL is placed in the part frame (P5-15c). Pure, no three.js.
//
// STLs are taken as millimetres. When the mesh's size is within 10 % of the
// part's dims on every axis it is used as is; otherwise (an inch file, a wrong
// export) it is scaled UNIFORMLY so it fits inside dims. Then x and y are
// centred on 0 and the bottom sits on z = 0 — the same frame the procedural
// builders use, so layout and enclosure (which only read dims) stay right.

export type Box = { min: [number, number, number]; max: [number, number, number] };
export type Dims = { x: number; y: number; z: number };

export type StlFit = { scale: number; offset: [number, number, number] };

const TOLERANCE = 0.1;

export function stlFit(box: Box, dims: Dims): StlFit {
  const size = [0, 1, 2].map((i) => Math.max(0, box.max[i] - box.min[i])) as [number, number, number];
  const want = [dims.x, dims.y, dims.z];
  const close = size.every((s, i) => s > 0 && Math.abs(s - want[i]) <= want[i] * TOLERANCE);
  let scale = 1;
  if (!close) {
    const ratios = size.map((s, i) => (s > 0 ? want[i] / s : Infinity)).filter((r) => Number.isFinite(r));
    scale = ratios.length ? Math.min(...ratios) : 1;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  }
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  return { scale, offset: [-cx * scale, -cy * scale, -box.min[2] * scale] };
}
