// The CPU-heavy part of the Studio: the template enclosure (+ label + vents) and
// the printed parts. Runs inside the geometry worker; the same code is the
// fallback where no Worker exists (vitest, SSR, old browsers).
//
// planEnclosure (lib/studio/enclosure/plan.ts) runs here, and its result (dims,
// settled layout, openings, label) travels back as `meta`. The MESH is built by
// the product kernel (enclosure-kernel.ts, manifold-3d), so it is watertight and
// one shell per body — which is why this path is async: manifold-3d is WASM and
// is loaded on demand, exactly like the product path.

import * as THREE from "three";
import { feetMeshes } from "../enclosure/feet";
import { planEnclosure, metaOf, type EnclosureMeta } from "../enclosure/plan";
import { buildMechParts, STAKE_SPIKE_ID } from "../mech/build";
import type { LibraryPart } from "../schema";
import { buildEnclosureCase, SPIKE_ID } from "./enclosure-kernel";
import type { MeshArrays } from "./kernel-core";
import { loadManifold } from "./manifold-loader";
import { packGeometry, transferablesOf } from "./pack";
import type { EnclosureInput, GeometryReply, GeometryRequest, MechInput, PackedEnclosure, PackedMechPart } from "./protocol";

export type BuiltEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; meta: EnclosureMeta };

// Built enclosures by key (the mech build reuses the case it was cut for).
// The shown case + its three "Other shapes" variants (built in the background) all stay.
const MAX_CACHED = 5;
const built = new Map<string, Promise<BuiltEnclosure>>();

function partsMap(input: EnclosureInput): Map<string, LibraryPart> {
  return new Map(input.parts);
}

function disposeEnclosure(e: BuiltEnclosure) {
  e.base.geometry.dispose();
  e.lid.geometry.dispose();
  for (const c of e.base.children) (c as THREE.Mesh).geometry?.dispose();
}

function geometryOf(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.clearGroups();
  g.addGroup(0, m.indices.length, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const shellMaterial = () => new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.7, metalness: 0 });

async function buildOne(input: EnclosureInput): Promise<BuiltEnclosure> {
  const plan = planEnclosure(input.spec, input.layout, partsMap(input));
  const mf = await loadManifold();
  const made = buildEnclosureCase(mf, plan);
  const base = new THREE.Mesh(geometryOf(made.base), shellMaterial());
  base.name = "enclosure_base";
  for (const f of feetMeshes(plan.dims, input.spec.feet)) base.add(f);
  if (made.spike) {
    // A separate printed part, shown in place under the pod (the viewer colours it like the case).
    const spike = new THREE.Mesh(geometryOf(made.spike), shellMaterial());
    spike.name = SPIKE_ID;
    base.add(spike);
  }
  const lid = new THREE.Mesh(geometryOf(made.lid), shellMaterial());
  lid.name = "enclosure_lid";
  return { base, lid, meta: { ...metaOf(plan), triangles: made.triangles, ms: made.ms } };
}

/**
 * One case, built now and not cached: the plan, the kernel meshes and the three.js
 * objects the viewer and the printed-parts build take (the base owns the rubber feet
 * and, for a stake pod, the soil spike).
 */
export function buildEnclosure(
  spec: EnclosureInput["spec"],
  layout: EnclosureInput["layout"],
  parts: Map<string, LibraryPart>,
): Promise<BuiltEnclosure> {
  return buildOne({ spec, layout, parts: [...parts.entries()] });
}

function enclosureFor(key: string, input: EnclosureInput): Promise<BuiltEnclosure> {
  const hit = built.get(key);
  if (hit) {
    built.delete(key);
    built.set(key, hit);
    return hit;
  }
  const p = buildOne(input);
  built.set(key, p);
  // A failed build is not kept (the next call tries again).
  p.catch(() => {
    if (built.get(key) === p) built.delete(key);
  });
  while (built.size > MAX_CACHED) {
    const [oldKey, old] = built.entries().next().value as [string, Promise<BuiltEnclosure>];
    built.delete(oldKey);
    old.then(disposeEnclosure, () => undefined);
  }
  return p;
}

export async function runEnclosure(key: string, input: EnclosureInput): Promise<PackedEnclosure> {
  const enc = await enclosureFor(key, input);
  return {
    base: packGeometry(enc.base.geometry),
    lid: packGeometry(enc.lid.geometry),
    feet: enc.base.children
      .filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
      .map((m) => ({ name: m.name, geometry: packGeometry(m.geometry) })),
    meta: enc.meta,
  };
}

export async function runMech(encKey: string, input: MechInput): Promise<PackedMechPart[]> {
  const enc = await enclosureFor(encKey, input);
  const parts = partsMap(input);
  // Standoffs fill floor → board underside where the parts stand in THIS case.
  const list = buildMechParts(
    input.mech,
    { ...input.layout, layout: enc.meta.layout },
    parts,
    { base: enc.base, lid: enc.lid, dims: enc.meta.dims },
    { environment: input.environment },
  );
  return list.map((b) => {
    const mesh = b.object as THREE.Mesh;
    // lid / base reuse the case's geometry on the main thread; the stake spike is its own part.
    const shell = b.id !== STAKE_SPIKE_ID && (b.template === "lid" || b.template === "base") ? b.template : undefined;
    const out: PackedMechPart = {
      id: b.id,
      template: b.template,
      name: b.name,
      explode: b.explode,
      printable: b.printable,
      volumeMm3: b.volumeMm3,
      triangles: b.triangles,
      check: b.check,
      size: b.size,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      ...(shell ? { shell } : { geometry: packGeometry(mesh.geometry) }),
    };
    if (!shell) mesh.geometry.dispose();
    return out;
  });
}

/** One request → one reply (+ the buffers to transfer). Never throws. */
export async function handleRequest(req: GeometryRequest): Promise<{ reply: GeometryReply; transfer: ArrayBuffer[] }> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const ms = () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  try {
    // Products are handled by product-job.ts, loaded on demand.
    if (req.kind !== "enclosure" && req.kind !== "mech") return { reply: { id: req.id, ok: false, error: "product requests go to product-job" }, transfer: [] };
    if (req.kind === "enclosure") {
      const result = await runEnclosure(req.key, req.input);
      return {
        reply: { id: req.id, ok: true, kind: "enclosure", result, ms: ms() },
        transfer: transferablesOf([result.base, result.lid, ...result.feet.map((f) => f.geometry)]),
      };
    }
    const result = await runMech(req.encKey, req.input);
    return {
      reply: { id: req.id, ok: true, kind: "mech", result, ms: ms() },
      transfer: transferablesOf(result.map((r) => r.geometry)),
    };
  } catch (err) {
    return { reply: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
