// Product meshes → files (P5-16). Pure typed-array maths (no three.js), so it
// works in the worker, on the main thread and in vitest.
//
//  * printReadyPositions(): a piece's WORLD mesh turned by its print plan (the
//    solver's pose: upright / upside down / on its side) and set on the bed
//    (centred in x, y, lowest point on z = 0) — what the slicer should get;
//  * binarySTL(): binary STL (mm, what PrusaSlicer / Cura assume);
//  * meshIsWatertight(): independent check that every edge is shared by exactly
//    two triangles with opposite winding (positions welded, so normal seams count
//    as one edge) — the "manifold check" for tests and the Engineer view.

export type MeshArrays = { positions: Float32Array; indices: Uint32Array };

/** World positions × the 3×3 print matrix, then centred on the bed with min z = 0. */
export function printReadyPositions(positions: Float32Array, matrix: readonly number[]): Float32Array {
  const out = new Float32Array(positions.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const X = matrix[0] * x + matrix[1] * y + matrix[2] * z;
    const Y = matrix[3] * x + matrix[4] * y + matrix[5] * z;
    const Z = matrix[6] * x + matrix[7] * y + matrix[8] * z;
    out[i] = X;
    out[i + 1] = Y;
    out[i + 2] = Z;
    if (X < minX) minX = X;
    if (X > maxX) maxX = X;
    if (Y < minY) minY = Y;
    if (Y > maxY) maxY = Y;
    if (Z < minZ) minZ = Z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= cx;
    out[i + 1] -= cy;
    out[i + 2] -= minZ;
  }
  return out;
}

/** Binary STL of an indexed mesh (facet normals from the winding). */
export function binarySTL(m: MeshArrays, name = "gestaltung360"): ArrayBuffer {
  const tris = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  const header = `Gestaltung360 Studio ${name}`.slice(0, 79);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, tris, true);
  const p = m.positions;
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** The STL a slicer should get for one printable piece. */
export function pieceSTL(piece: { id: string; positions: Float32Array; indices: Uint32Array; print: { matrix: readonly number[] } }): ArrayBuffer {
  return binarySTL({ positions: printReadyPositions(piece.positions, piece.print.matrix), indices: piece.indices }, piece.id);
}

/**
 * Closed, consistently wound triangle mesh? Positions are welded on a 1 µm grid; every
 * undirected edge must be used as often in one direction as in the other (normally once
 * each; twice each where two parts of a solid just touch along a line, which manifold-3d
 * keeps as a valid "pinched" edge).
 */
export function meshIsWatertight(m: MeshArrays, grid = 1e-3): { ok: boolean; badEdges: number; triangles: number } {
  const key = new Map<string, number>();
  const weld = new Uint32Array(m.positions.length / 3);
  for (let i = 0; i < weld.length; i++) {
    const k = `${Math.round(m.positions[i * 3] / grid)},${Math.round(m.positions[i * 3 + 1] / grid)},${Math.round(m.positions[i * 3 + 2] / grid)}`;
    let id = key.get(k);
    if (id === undefined) {
      id = key.size;
      key.set(k, id);
    }
    weld[i] = id;
  }
  const edges = new Map<string, number>();
  const tris = m.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const v = [weld[m.indices[t * 3]], weld[m.indices[t * 3 + 1]], weld[m.indices[t * 3 + 2]]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate after welding
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      // +1 for a→b with a < b, +100000 for the reverse: balanced edges are n·100001.
      edges.set(k, (edges.get(k) ?? 0) + (a < b ? 1 : 100000));
    }
  }
  let bad = 0;
  for (const v of edges.values()) if (v % 100001 !== 0) bad += 1;
  return { ok: bad === 0 && tris > 0, badEdges: bad, triangles: tris };
}
