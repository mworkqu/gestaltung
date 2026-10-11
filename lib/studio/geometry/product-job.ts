// Product builds inside the geometry worker (P5-16). Loaded on demand by
// studio-geometry.worker.ts the first time a product is asked for (and by the
// main-thread fallback where no Worker exists), so manifold-3d stays out of
// every other chunk.
//
// Built products are cached here by solvedHash (the same solved model never
// builds twice). Phase 2b renders its preview pictures from THIS cache inside
// the worker (getBuiltProduct), so before payment no geometry has to leave it:
// a request with `geometry: false` returns only the metadata (pieces, grams,
// print plans, electronics, explode vectors), never a vertex.

import { buildProductMeshes, productTransferables, type BuiltProduct } from "./product-kernel";
import { loadManifold } from "./manifold-loader";
import type { GeometryReply, PackedProduct, ProductRequest } from "./protocol";
import type { SolvedProduct } from "../product/solve";

const MAX_CACHED = 6;
const built = new Map<string, Promise<BuiltProduct>>();

/** Build (or reuse) a solved product. Rejects when the kernel fails. */
export function buildProduct(solved: SolvedProduct): Promise<BuiltProduct> {
  const key = solved.hash;
  const hit = built.get(key);
  if (hit) {
    built.delete(key);
    built.set(key, hit);
    return hit;
  }
  const p = loadManifold().then((mf) => buildProductMeshes(mf, solved));
  built.set(key, p);
  p.catch(() => {
    if (built.get(key) === p) built.delete(key);
  });
  while (built.size > MAX_CACHED) built.delete(built.keys().next().value as string);
  return p;
}

/** A product already built in this worker (Phase 2b: render pictures without sending geometry out). */
export function getBuiltProduct(hash: string): Promise<BuiltProduct> | undefined {
  return built.get(hash);
}

/** Copy for the page: metadata only, or with fresh copies of the arrays (the cache keeps its own). */
export function packProduct(p: BuiltProduct, withGeometry: boolean): PackedProduct {
  const strip = <T extends { positions: Float32Array; normals: Float32Array; indices: Uint32Array }>(m: T) => {
    const { positions, normals, indices, ...meta } = m;
    return withGeometry ? { ...meta, positions: positions.slice(), normals: normals.slice(), indices: indices.slice() } : meta;
  };
  return {
    hash: p.hash,
    ms: p.ms,
    geometry: withGeometry,
    pieces: p.pieces.map(strip),
    links: p.links.map(strip),
    electronics: p.electronics,
    bbox: p.bbox,
  };
}

/** One product request → one reply (+ buffers to transfer). Never throws. */
export async function handleProductRequest(req: ProductRequest): Promise<{ reply: GeometryReply; transfer: ArrayBuffer[] }> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const p = await buildProduct(req.input.solved);
    const result = packProduct(p, req.input.geometry);
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    const transfer = req.input.geometry ? productTransferables(result as unknown as BuiltProduct) : [];
    return { reply: { id: req.id, ok: true, kind: "product", result, ms }, transfer };
  } catch (err) {
    return { reply: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
