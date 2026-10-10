// BufferGeometry <-> plain typed arrays, so geometry built in the geometry
// worker crosses postMessage as transferables (no copy, no structured clone of
// three.js objects). Only position / normal / index + draw groups travel: that
// is all the enclosure + printed-part meshes carry (no uv, no colours).

import * as THREE from "three";

export type PackedGeometry = {
  position: Float32Array;
  normal?: Float32Array;
  index?: Uint32Array | Uint16Array;
  groups: { start: number; count: number; materialIndex?: number }[];
};

function floatArray(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Float32Array | undefined {
  if (!attr) return undefined;
  const a = attr as THREE.BufferAttribute;
  if (a.array instanceof Float32Array && a.itemSize === 3 && !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    // Copy: the worker's own geometry may be cached and reused there.
    return new Float32Array(a.array);
  }
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

export function packGeometry(g: THREE.BufferGeometry): PackedGeometry {
  const position = floatArray(g.getAttribute("position"))!;
  const normal = floatArray(g.getAttribute("normal"));
  const idx = g.getIndex();
  let index: Uint32Array | Uint16Array | undefined;
  if (idx) index = idx.array instanceof Uint16Array ? new Uint16Array(idx.array) : Uint32Array.from(idx.array as ArrayLike<number>);
  return {
    position,
    ...(normal ? { normal } : {}),
    ...(index ? { index } : {}),
    groups: g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex })),
  };
}

export function unpackGeometry(p: PackedGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
  if (p.normal) g.setAttribute("normal", new THREE.BufferAttribute(p.normal, 3));
  else g.computeVertexNormals();
  if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
  for (const gr of p.groups) g.addGroup(gr.start, gr.count, gr.materialIndex ?? 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Every ArrayBuffer inside packed geometries (for postMessage's transfer list). */
export function transferablesOf(geos: (PackedGeometry | undefined)[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const p of geos) {
    if (!p) continue;
    for (const a of [p.position, p.normal, p.index]) if (a && a.buffer instanceof ArrayBuffer) out.add(a.buffer);
  }
  return [...out];
}
