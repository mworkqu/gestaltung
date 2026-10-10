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
import type { GeometryReply, GeometryRequest, PackedMechPart } from "./protocol";

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
// Worker transport (one worker, requests matched by id)
// ---------------------------------------------------------------------------

type Pending = { resolve: (r: GeometryReply) => void; reject: (e: Error) => void };
type Job = GeometryRequest extends infer R ? (R extends GeometryRequest ? Omit<R, "id"> : never) : never;

let worker: Worker | null | undefined; // undefined = not tried yet, null = unavailable
let nextId = 1;
const pending = new Map<number, Pending>();

/** Where the last job ran ("worker" / "main"); read by tests and the perf probe. */
export const geometryStats = { worker: 0, main: 0, lastMs: 0 };

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return (worker = null);
  try {
    const w = new Worker(new URL("./studio-geometry.worker.ts", import.meta.url), { type: "module", name: "studio-geometry" });
    w.onmessage = (e: MessageEvent<GeometryReply>) => {
      const p = pending.get(e.data?.id);
      if (!p) return;
      pending.delete(e.data.id);
      p.resolve(e.data);
    };
    const broken = (e: Event) => {
      // Failed to load (CSP, old browser) or crashed: everything waiting falls back to the main thread.
      e.preventDefault?.();
      if (worker === w) worker = null;
      w.terminate();
      failAll(new Error("geometry worker stopped"));
    };
    w.onerror = broken;
    w.onmessageerror = broken;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Start the worker (and its scripts) before the first build, e.g. when the Enclosure step opens. */
export function warmGeometryWorker(): void {
  getWorker();
}

async function runOnMain(job: Job): Promise<GeometryReply> {
  const { handleRequest } = await import("./job");
  geometryStats.main += 1;
  return handleRequest({ ...job, id: 0 } as GeometryRequest).reply;
}

async function run(job: Job): Promise<GeometryReply> {
  const w = getWorker();
  if (w) {
    try {
      const id = nextId++;
      const reply = await new Promise<GeometryReply>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ ...job, id } as GeometryRequest);
      });
      geometryStats.worker += 1;
      return reply;
    } catch {
      /* worker unavailable: same job on the main thread */
    }
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

/** The enclosure for this spec + layout + parts (cached; built in the worker). Rejects when the build fails. */
export function getEnclosureGeometry(
  spec: EnclosureSpec,
  layout: LayoutResult,
  parts: Map<string, LibraryPart>,
): Promise<EnclosureGeometry> {
  const key = enclosureKey(spec, layout, parts);
  const hit = touch(enclosures, key);
  if (hit) return hit;
  const p = run({ kind: "enclosure", key, input: inputOf(spec, layout, parts) }).then((r) => {
    if (!r.ok || r.kind !== "enclosure") throw new Error(r.ok ? "unexpected reply" : r.error);
    geometryStats.lastMs = r.ms;
    return {
      key,
      base: unpackGeometry(r.result.base),
      lid: unpackGeometry(r.result.lid),
      feet: r.result.feet.map((f) => ({ name: f.name, geometry: unpackGeometry(f.geometry) })),
      meta: r.result.meta,
      ms: r.ms,
    };
  });
  enclosures.set(key, p);
  // A failed build is not cached (the next call tries again).
  p.catch(() => {
    if (enclosures.get(key) === p) enclosures.delete(key);
  });
  evict(enclosures, MAX_ENCLOSURES, disposeEnclosure);
  return p;
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
    const m = new THREE.Mesh(f.geometry, feetMaterial());
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
    };
  });
}

/** Test hook: forget the worker + caches. */
export function resetGeometryClientForTests() {
  worker?.terminate();
  worker = undefined;
  failAll(new Error("reset"));
  enclosures.clear();
  mechs.clear();
  geometryStats.worker = geometryStats.main = geometryStats.lastMs = 0;
}
