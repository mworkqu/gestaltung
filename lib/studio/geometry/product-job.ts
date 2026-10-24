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
import type {
  GeometryReply,
  GeometryRequest,
  PackedProduct,
  ProductPreviewInput,
  ProductRequest,
  ProductUnlockInput,
  WorkerMessage,
} from "./protocol";
import type { SolvedProduct } from "../product/solve";
import { fetchHttp, loadUnlockedProduct, productStlFiles, runProductPreview, type Http } from "./product-preview";

export type ProductJobRequest = Extract<GeometryRequest, { kind: "productPreview" | "productUnlocked" | "productStl" }>;

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

// ---------------------------------------------------------------------------
// Phase 2b: preview pictures / unlocked meshes / STLs (pipeline in product-preview.ts)
// ---------------------------------------------------------------------------

type PostFn = (message: WorkerMessage, transfer?: Transferable[]) => void;

/** Test harness path for ?productremote=1 (fixture only; answered by Playwright, never by the server). */
const E2E_REMOTE_BASE = "/__e2e/studio-product";

async function httpFor(input: ProductPreviewInput | ProductUnlockInput): Promise<Http> {
  if (input.mock?.remote) return fetchHttp(E2E_REMOTE_BASE);
  if (input.mock) {
    // Fixture pages only (the page sends `mock` only with its mock StudioApi).
    const { mockProductHttp } = await import("./product-mock");
    return mockProductHttp(input, input.mock);
  }
  return fetchHttp(input.apiBase);
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** One Phase 2b request → events (progress, pictures) + exactly one reply. Never throws. */
export async function handleProductJob(req: ProductJobRequest, post: PostFn): Promise<void> {
  const t0 = now();
  try {
    if (req.kind === "productPreview") {
      const { renderProductShots, canRenderOffscreen } = await import("./product-render");
      const http = await httpFor(req.input);
      const result = await runProductPreview(
        req.input,
        (event) => post({ id: req.id, event }, event.kind === "productPicture" ? [event.png] : []),
        { http, build: buildProduct, render: renderProductShots, canRender: canRenderOffscreen, now },
      );
      post({ id: req.id, ok: true, kind: "productPreview", result, ms: Math.round(now() - t0) });
      return;
    }
    if (req.kind === "productUnlocked") {
      const http = await httpFor(req.input);
      const { solved, built: b } = await loadUnlockedProduct(req.input, { http, build: buildProduct });
      const packed = packProduct(b, true);
      const result = { ...packed, designId: req.input.designId, scene: solved.scene, stage: solved.stage };
      post({ id: req.id, ok: true, kind: "productUnlocked", result, ms: Math.round(now() - t0) }, productTransferables(packed as unknown as BuiltProduct));
      return;
    }
    const hit = getBuiltProduct(req.input.hash);
    if (!hit) throw new Error("not_built");
    const result = productStlFiles(await hit, req.input.name);
    // One buffer per file and per plate; `combined` aliases plates[0], so it is not transferred twice.
    const transfer: ArrayBuffer[] = [...result.files.map((f) => f.data), ...result.plates.map((pl) => pl.data)];
    post({ id: req.id, ok: true, kind: "productStl", result, ms: Math.round(now() - t0) }, transfer);
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
