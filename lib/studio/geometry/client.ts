// Main-thread side of the Studio geometry worker.
//
//  * getEnclosureGeometry / getMechGeometry post the job to ONE shared Web
//    Worker (studio-geometry.worker.ts) and rebuild BufferGeometry from the
//    transferred typed arrays. Where no Worker exists (vitest, SSR) or the
//    worker fails to start, the same job runs synchronously (job.ts, loaded on
//    demand), so callers never see a difference except timing.
//  * Results are cached by key (key.ts): colour / finish / x-ray never rebuild,
//    and the viewer, the Print step and the Make step share one build. The
//    cache owns the geometries (disposed when evicted); callers get FRESH Mesh
//    objects from enclosureMeshes() / mechObjects() and never dispose geometry.
//
// Loaded only from the 3D viewer chunk or by dynamic import (it pulls three.js).

import * as THREE from "three";
import type { LayoutResult } from "../layout";
import type { BuiltMechPart } from "../mech/build";
import { materialFor } from "../mech/materials";
import type { EnclosureSpec, Environment, LibraryPart, MechPart } from "../schema";
import type { EnclosureMeta } from "../enclosure/build";
import { enclosureKey, mechKey } from "./key";
import { unpackGeometry } from "./pack";
import type { GeometryReply, GeometryRequest, PackedEnclosure, PackedMechPart, PackedProduct } from "./protocol";
import { geometryStats, postToWorker, resetTransportForTests, warmGeometryWorker, type Job } from "./transport";
import type { SolvedProduct } from "../product/solve";
import { persistEnclosure, readPersistedEnclosure } from "./persist";

export { enclosureKey, mechKey } from "./key";

export type EnclosureGeometry = {
  key: string;
  base: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  feet: { name: string; geometry: THREE.BufferGeometry }[];
  meta: EnclosureMeta;
  /** Build time (ms) in the worker / fallback. */
  ms: number;
};

export type MechGeometryPart = Omit<PackedMechPart, "geometry"> & { geometry?: THREE.BufferGeometry };
export type MechGeometry = { key: string; encKey: string; parts: MechGeometryPart[]; ms: number };

// ---------------------------------------------------------------------------
// Worker transport: lib/studio/geometry/transport.ts (one worker, shared with the
// product preview client, no three.js). Where no Worker exists the job runs here.
// ---------------------------------------------------------------------------

export { geometryStats, warmGeometryWorker };

async function runOnMain(job: Job): Promise<GeometryReply> {
  geometryStats.main += 1;
  if (job.kind === "product") {
    const { handleProductRequest } = await import("./product-job");
    return (await handleProductRequest({ ...job, id: 0 })).reply;
  }
  if (job.kind === "enclosure" || job.kind === "mech") {
    const { handleRequest } = await import("./job");
    return handleRequest({ ...job, id: 0 } as GeometryRequest).reply;
  }
  // Preview pictures need the worker's OffscreenCanvas: no main-thread fallback (the page keeps the template flow).
  return { id: 0, ok: false, error: "no_worker" };
}

async function run(job: Job): Promise<GeometryReply> {
  try {
    return await postToWorker(job);
  } catch {
    /* worker unavailable: same job on the main thread */
  }
  return runOnMain(job);
}

// ---------------------------------------------------------------------------
// Caches (LRU; the cache owns the geometry)
// ---------------------------------------------------------------------------

const MAX_ENCLOSURES = 6;
const MAX_MECH = 4;
const enclosures = new Map<string, Promise<EnclosureGeometry>>();
const mechs = new Map<string, Promise<MechGeometry>>();

function touch<T>(cache: Map<string, Promise<T>>, key: string): Promise<T> | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function evict<T>(cache: Map<string, Promise<T>>, max: number, dispose: (v: T) => void) {
  while (cache.size > max) {
    const [k, p] = cache.entries().next().value as [string, Promise<T>];
    cache.delete(k);
    // Disposing frees GPU buffers only; a mesh still showing it is re-uploaded on its next frame.
    p.then(dispose, () => undefined);
  }
}

const disposeEnclosure = (e: EnclosureGeometry) => {
  e.base.dispose();
  e.lid.dispose();
  for (const f of e.feet) f.geometry.dispose();
};
const disposeMech = (m: MechGeometry) => {
  for (const p of m.parts) p.geometry?.dispose();
};

function inputOf(spec: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>) {
  return { spec, layout, parts: [...parts.entries()] };
}

function fromPacked(key: string, packed: PackedEnclosure, ms: number): EnclosureGeometry {
  return {
    key,
    base: unpackGeometry(packed.base),
    lid: unpackGeometry(packed.lid),
    feet: packed.feet.map((f) => ({ name: f.name, geometry: unpackGeometry(f.geometry) })),
    meta: packed.meta,
    ms,
  };
}

/** Whether a shape is already built in memory (no worker job needed). */
export function hasEnclosureGeometry(spec: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>): boolean {
  return enclosures.has(enclosureKey(spec, layout, parts));
}

/**
 * The enclosure for this spec + layout + parts (cached; built in the worker). Rejects when the build fails.
 * The visitor's own case is also kept in this browser (persist.ts): a reload shows it at once.
 * Background builds ("Other shapes") pass `persist: false` so they never push it out.
 */
export function getEnclosureGeometry(
  spec: EnclosureSpec,
  layout: LayoutResult,
  parts: Map<string, LibraryPart>,
  opts: { persist?: boolean } = {},
): Promise<EnclosureGeometry> {
  const key = enclosureKey(spec, layout, parts);
  const hit = touch(enclosures, key);
  if (hit) return hit;
  const keep = opts.persist !== false;
  const p = (async (): Promise<EnclosureGeometry> => {
    if (keep) {
      const saved = await readPersistedEnclosure(key);
      if (saved) {
        geometryStats.persisted += 1;
        return fromPacked(key, saved.data, saved.ms);
      }
    }
    const r = await run({ kind: "enclosure", key, input: inputOf(spec, layout, parts) });
    if (!r.ok || r.kind !== "enclosure") throw new Error(r.ok ? "unexpected reply" : r.error);
    geometryStats.lastMs = r.ms;
    const g = fromPacked(key, r.result, r.ms);
    if (keep) persistEnclosure(key, r.result, r.ms);
    return g;
  })();
  enclosures.set(key, p);
  // A failed build is not cached (the next call tries again).
  p.catch(() => {
    if (enclosures.get(key) === p) enclosures.delete(key);
  });
  evict(enclosures, MAX_ENCLOSURES, disposeEnclosure);
  return p;
}

/**
 * Background builds, ONE AT A TIME in the given order (the first one is ready first), so a
 * tap on "Other shapes" swaps the case instantly. Stops as soon as `stop()` says so; a
 * failed build is skipped. Never persisted (only the shown case is kept in the browser).
 */
export async function prebuildInOrder(jobs: (() => Promise<unknown>)[], stop: () => boolean): Promise<number> {
  let done = 0;
  for (const job of jobs) {
    if (stop()) break;
    try {
      await job();
      done += 1;
    } catch {
      /* a variant that cannot be built is simply not offered pre-built */
    }
  }
  return done;
}

/** The printed parts for this case (cached; built in the worker next to the case they fit). */
export function getMechGeometry(
  spec: EnclosureSpec,
  layout: LayoutResult,
  parts: Map<string, LibraryPart>,
  mech: readonly MechPart[],
  environment?: Environment,
): Promise<MechGeometry> {
  const encKey = enclosureKey(spec, layout, parts);
  const key = mechKey(encKey, mech, environment);
  const hit = touch(mechs, key);
  if (hit) return hit;
  const p = run({
    kind: "mech",
    key,
    encKey,
    input: { ...inputOf(spec, layout, parts), mech: [...mech], environment },
  }).then((r) => {
    if (!r.ok || r.kind !== "mech") throw new Error(r.ok ? "unexpected reply" : r.error);
    return {
      key,
      encKey,
      ms: r.ms,
      parts: r.result.map(({ geometry, ...rest }) => ({ ...rest, ...(geometry ? { geometry: unpackGeometry(geometry) } : {}) })),
    };
  });
  mechs.set(key, p);
  p.catch(() => {
    if (mechs.get(key) === p) mechs.delete(key);
  });
  evict(mechs, MAX_MECH, disposeMech);
  return p;
}

// ---------------------------------------------------------------------------
// Products (P5-16): the real product model, built by manifold-3d in the worker
// ---------------------------------------------------------------------------

type PackedPieceMeta = Omit<PackedProduct["pieces"][number], "positions" | "normals" | "indices">;
type PackedLinkMeta = Omit<PackedProduct["links"][number], "positions" | "normals" | "indices">;

/** A built piece on the main thread: metadata, plus a BufferGeometry when geometry was asked for. */
export type ProductPiece = PackedPieceMeta & { geometry?: THREE.BufferGeometry };
export type ProductLink = PackedLinkMeta & { geometry?: THREE.BufferGeometry };
export type ProductGeometry = Omit<PackedProduct, "pieces" | "links"> & { key: string; pieces: ProductPiece[]; links: ProductLink[] };

const MAX_PRODUCTS = 4;
const products = new Map<string, Promise<ProductGeometry>>();

export function productKey(solved: Pick<SolvedProduct, "hash">, geometry: boolean): string {
  return `${solved.hash}:${geometry ? "mesh" : "meta"}`;
}

function meshGeometry(m: { positions?: Float32Array; normals?: Float32Array; indices?: Uint32Array }): THREE.BufferGeometry | undefined {
  if (!m.positions || !m.indices) return undefined;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  if (m.normals) g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  else g.computeVertexNormals();
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * A solved product built in the worker (cached by solvedHash here AND in the worker).
 * `geometry: false` (the default) returns only metadata — pieces, grams, print plans,
 * electronics placement, explode vectors — so before payment no mesh reaches the page;
 * `geometry: true` also returns BufferGeometries in WORLD coordinates (normals included).
 */
export function getProductGeometry(solved: SolvedProduct, opts: { geometry?: boolean } = {}): Promise<ProductGeometry> {
  const withGeometry = opts.geometry === true;
  const key = productKey(solved, withGeometry);
  const hit = touch(products, key);
  if (hit) return hit;
  const p = run({ kind: "product", key, input: { solved, geometry: withGeometry } }).then((r) => {
    if (!r.ok || r.kind !== "product") throw new Error(r.ok ? "unexpected reply" : r.error);
    geometryStats.lastMs = r.ms;
    const { pieces, links, ...rest } = r.result;
    return {
      ...rest,
      key,
      pieces: pieces.map(({ positions, normals, indices, ...meta }) => ({ ...meta, ...(positions ? { geometry: meshGeometry({ positions, normals, indices }) } : {}) })),
      links: links.map(({ positions, normals, indices, ...meta }) => ({ ...meta, ...(positions ? { geometry: meshGeometry({ positions, normals, indices }) } : {}) })),
    } as ProductGeometry;
  });
  products.set(key, p);
  p.catch(() => {
    if (products.get(key) === p) products.delete(key);
  });
  evict(products, MAX_PRODUCTS, (g) => {
    for (const piece of g.pieces) piece.geometry?.dispose();
    for (const l of g.links) l.geometry?.dispose();
  });
  return p;
}

// ---------------------------------------------------------------------------
// Fresh meshes over cached geometry
// ---------------------------------------------------------------------------

let shellMat: THREE.MeshStandardMaterial | null = null;
let feetMat: THREE.MeshStandardMaterial | null = null;
const shellMaterial = () => (shellMat ??= new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.7, metalness: 0 }));
const feetMaterial = () => (feetMat ??= new THREE.MeshStandardMaterial({ color: 0x1f2125, roughness: 0.9, metalness: 0 }));

/** New base (with its rubber feet) + lid meshes over the cached geometry, named like buildEnclosure's. */
export function enclosureMeshes(g: EnclosureGeometry): { base: THREE.Mesh; lid: THREE.Mesh } {
  const base = new THREE.Mesh(g.base, shellMaterial());
  base.name = "enclosure_base";
  for (const f of g.feet) {
    // Rubber feet are dark; a stake pod's spike is printed like the case (the viewer gives it the case's finish).
    const m = new THREE.Mesh(f.geometry, f.name === "enclosure_spike" ? shellMaterial() : feetMaterial());
    m.name = f.name;
    base.add(m);
  }
  const lid = new THREE.Mesh(g.lid, shellMaterial());
  lid.name = "enclosure_lid";
  return { base, lid };
}

/**
 * BuiltMechPart list (same shape as lib/studio/mech/build.ts) with new meshes. lid / base
 * reuse the enclosure geometry. Each non-shell part gets its own material: the caller
 * disposes `object.material` when done (never the geometry).
 */
export function mechObjects(m: MechGeometry, enc: EnclosureGeometry): BuiltMechPart[] {
  return m.parts.map((p) => {
    const geometry = p.shell ? enc[p.shell] : p.geometry;
    const mesh = new THREE.Mesh(geometry ?? new THREE.BufferGeometry(), p.shell ? shellMaterial() : materialFor(p.printable.material));
    mesh.position.set(...p.position);
    mesh.rotation.set(...p.rotation);
    mesh.name = p.id;
    mesh.userData = { mechId: p.id, template: p.template, shell: !!p.shell };
    return {
      id: p.id,
      template: p.template,
      name: p.name,
      object: mesh,
      explode: p.explode,
      printable: p.printable,
      volumeMm3: p.volumeMm3,
      triangles: p.triangles,
      check: p.check,
      size: p.size,
    };
  });
}

/** Test hook: forget the worker + caches. */
export function resetGeometryClientForTests() {
  resetTransportForTests();
  enclosures.clear();
  mechs.clear();
  products.clear();
  geometryStats.worker = geometryStats.main = geometryStats.lastMs = geometryStats.persisted = 0;
}
