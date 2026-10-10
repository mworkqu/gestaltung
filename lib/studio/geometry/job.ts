// The CPU-heavy part of the Studio: enclosure CSG (+ label + vents) and the
// printed parts. Runs inside the geometry worker; the same code is the
// synchronous fallback where no Worker exists (vitest, SSR, old browsers).
// planEnclosure runs here too (inside buildEnclosure), and its result (the
// plan: dims, settled layout, openings, label) travels back as `meta`.

import type * as THREE from "three";
import { buildEnclosure, type BuiltEnclosure } from "../enclosure/build";
import { buildMechParts } from "../mech/build";
import type { LibraryPart } from "../schema";
import { packGeometry, transferablesOf } from "./pack";
import type { EnclosureInput, GeometryReply, GeometryRequest, MechInput, PackedEnclosure, PackedMechPart } from "./protocol";

// Built enclosures by key (the mech build reuses the case it was cut for).
const MAX_CACHED = 3;
const built = new Map<string, BuiltEnclosure>();

function partsMap(input: EnclosureInput): Map<string, LibraryPart> {
  return new Map(input.parts);
}

function disposeEnclosure(e: BuiltEnclosure) {
  e.base.geometry.dispose();
  e.lid.geometry.dispose();
  for (const c of e.base.children) (c as THREE.Mesh).geometry?.dispose();
}

function enclosureFor(key: string, input: EnclosureInput): BuiltEnclosure {
  const hit = built.get(key);
  if (hit) {
    built.delete(key);
    built.set(key, hit);
    return hit;
  }
  const enc = buildEnclosure(input.spec, input.layout, partsMap(input));
  built.set(key, enc);
  while (built.size > MAX_CACHED) {
    const [oldKey, old] = built.entries().next().value as [string, BuiltEnclosure];
    built.delete(oldKey);
    disposeEnclosure(old);
  }
  return enc;
}

export function runEnclosure(key: string, input: EnclosureInput): PackedEnclosure {
  const enc = enclosureFor(key, input);
  return {
    base: packGeometry(enc.base.geometry),
    lid: packGeometry(enc.lid.geometry),
    feet: enc.base.children
      .filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
      .map((m) => ({ name: m.name, geometry: packGeometry(m.geometry) })),
    meta: enc.meta,
  };
}

export function runMech(encKey: string, input: MechInput): PackedMechPart[] {
  const enc = enclosureFor(encKey, input);
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
    const shell = b.template === "lid" || b.template === "base" ? b.template : undefined;
    const out: PackedMechPart = {
      id: b.id,
      template: b.template,
      name: b.name,
      explode: b.explode,
      printable: b.printable,
      volumeMm3: b.volumeMm3,
      triangles: b.triangles,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      ...(shell ? { shell } : { geometry: packGeometry(mesh.geometry) }),
    };
    if (!shell) mesh.geometry.dispose();
    return out;
  });
}

/** One request → one reply (+ the buffers to transfer). Never throws. */
export function handleRequest(req: GeometryRequest): { reply: GeometryReply; transfer: ArrayBuffer[] } {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const ms = () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  try {
    if (req.kind === "enclosure") {
      const result = runEnclosure(req.key, req.input);
      return {
        reply: { id: req.id, ok: true, kind: "enclosure", result, ms: ms() },
        transfer: transferablesOf([result.base, result.lid, ...result.feet.map((f) => f.geometry)]),
      };
    }
    const result = runMech(req.encKey, req.input);
    return {
      reply: { id: req.id, ok: true, kind: "mech", result, ms: ms() },
      transfer: transferablesOf(result.map((r) => r.geometry)),
    };
  } catch (err) {
    return { reply: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
