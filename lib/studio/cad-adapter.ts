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

const browserBackend = new BrowserCadBackend();

/** The CAD backend to use. Only "browser" exists for now; anything else falls back to it. */
export function getCadBackend(setting?: string): CadBackend {
  void setting;
  return browserBackend;
}
