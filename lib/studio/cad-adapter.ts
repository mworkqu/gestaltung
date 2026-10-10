// CAD backend seam for the Design Studio.
//
// Today every model is built in the browser (three.js + three-bvh-csg, see
// lib/studio/enclosure/build.ts). The inputs are deliberately small JSON objects
// — EnclosureSpec, LayoutResult and MechPart[] (lib/studio/schema.ts) — so a
// server backend can take over without changing them.
//
// Future CadQueryBackend (not built): POST the SAME EnclosureSpec + layout +
// MechPart[] JSON to the existing Cloud Run worker (services/cad-worker, P5-11,
// authenticated like lib/cad/cloud.ts) and receive STEP + STL files back; load
// the STL into THREE meshes named "enclosure_base" / "enclosure_lid" so the
// viewer and exports stay identical. The formats must not change: if a field is
// needed, add it to schema.ts for both backends.

import * as THREE from "three";
import type { EnclosureSpec, LibraryPart, MechPart } from "./schema";
import type { LayoutResult } from "./layout";
import { buildEnclosure, type EnclosureMeta } from "./enclosure/build";
import { buildMechGeometry } from "./mech/templates";

export type CadEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; meta: EnclosureMeta };

export interface CadBackend {
  id: "browser" | "cadquery";
  buildEnclosure(enc: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>): Promise<CadEnclosure>;
  buildMechPart(part: MechPart): Promise<THREE.Object3D>;
}

export class BrowserCadBackend implements CadBackend {
  readonly id = "browser" as const;

  async buildEnclosure(enc: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>): Promise<CadEnclosure> {
    return buildEnclosure(enc, layout, parts);
  }

  /** One printable part in its own local coords (placement: lib/studio/mech/build.ts). */
  async buildMechPart(part: MechPart): Promise<THREE.Object3D> {
    const mesh = new THREE.Mesh(
      buildMechGeometry(part),
      new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.7, metalness: 0 }),
    );
    mesh.name = part.id;
    return mesh;
  }
}

/**
 * Future server backend (NOT enabled). Contract and rollout: docs/STUDIO_CAD.md.
 * TODO(P5-15d+): implement POST /studio/build on services/cad-worker, then call it
 * from a server route (auth like lib/cad/cloud.ts) and load the returned STL into
 * meshes named "enclosure_base" / "enclosure_lid" / each MechPart.id. Until then
 * getCadBackend never returns this class.
 */
export class CadQueryBackend implements CadBackend {
  readonly id = "cadquery" as const;

  async buildEnclosure(): Promise<CadEnclosure> {
    throw new Error("CadQuery backend is not enabled");
  }

  async buildMechPart(): Promise<THREE.Object3D> {
    throw new Error("CadQuery backend is not enabled");
  }
}

export type CadBackendId = CadBackend["id"];
export const STUDIO_CAD_KEY = "studio_cad";

/**
 * store_settings.studio_cad = {"backend":"browser"} (jsonb object or a JSON string).
 * Only "browser" is accepted for now; anything else (including "cadquery") gives
 * "browser" and a console.warn. Missing / malformed = "browser".
 */
export function parseStudioCadSetting(raw: unknown): CadBackendId {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return "browser";
    }
  }
  if (typeof value !== "object" || value === null) return "browser";
  const backend = (value as { backend?: unknown }).backend;
  if (backend === undefined || backend === "browser") return "browser";
  console.warn(`[studio] store_settings.studio_cad backend ${JSON.stringify(backend)} is not enabled; using "browser"`);
  return "browser";
}

const browserBackend = new BrowserCadBackend();

/** The CAD backend to use. `setting` is the backend id (getStudioCadSetting()) or the raw jsonb; only "browser" exists. */
export function getCadBackend(setting?: unknown): CadBackend {
  if (setting !== undefined && setting !== "browser") {
    if (typeof setting === "string") console.warn(`[studio] CAD backend "${setting}" is not enabled; using "browser"`);
    else parseStudioCadSetting(setting);
  }
  return browserBackend;
}
