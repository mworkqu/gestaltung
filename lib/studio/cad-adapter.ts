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
//
// P5-16: buildProduct(ProductModel) builds the REAL product (several bodies from
// the form-part kit, lib/studio/product/*): the solver runs here (pure), the
// manifold-3d kernel runs in the Studio geometry worker. The CadQuery backend
// will take the same ProductModel JSON (docs/STUDIO_CAD.md, "Product models").

import * as THREE from "three";
import type { EnclosureSpec, LibraryPart, MechPart, ProductSpec } from "./schema";
import type { LayoutInput, LayoutResult } from "./layout";
import type { ProductModel } from "./product/schema";
import { solveProduct, type SolvedProduct } from "./product/solve";
import type { ProductGeometry } from "./geometry/client";
import { buildEnclosure, type EnclosureMeta } from "./enclosure/build";
import { buildMechGeometry } from "./mech/templates";

export type CadEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; meta: EnclosureMeta };

/**
 * P5-16: a whole product. `solved` = the solver's output (pure JSON: bodies, placements,
 * cut-outs, print plans, electronics, issues, hash); `geometry` = the built pieces. The
 * browser backend builds in the Studio worker with manifold-3d; the future CadQuery
 * backend takes the SAME ProductModel (docs/STUDIO_CAD.md) and returns STEP + STL.
 */
export type CadProduct = { solved: SolvedProduct; geometry: ProductGeometry };

export type BuildProductOptions = {
  /** The chosen parts (fitted inside the product). */
  parts?: readonly LayoutInput[];
  spec?: ProductSpec;
  /** true = meshes come back to the page (after "Create my CAD"); false = metadata only. */
  geometry?: boolean;
};

export interface CadBackend {
  id: "browser" | "cadquery";
  buildEnclosure(enc: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>): Promise<CadEnclosure>;
  buildMechPart(part: MechPart): Promise<THREE.Object3D>;
  buildProduct(model: ProductModel, opts?: BuildProductOptions): Promise<CadProduct>;
}

export class BrowserCadBackend implements CadBackend {
  readonly id = "browser" as const;

  /** Solve (pure, here) then build (worker, cached by the solved hash). */
  async buildProduct(model: ProductModel, opts: BuildProductOptions = {}): Promise<CadProduct> {
    const solved = solveProduct(model, opts.parts ?? [], { spec: opts.spec });
    const { getProductGeometry } = await import("./geometry/client");
    const geometry = await getProductGeometry(solved, { geometry: opts.geometry === true });
    return { solved, geometry };
  }

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

  /** Future: POST the ProductModel (+ parts) to /studio/product on the Cloud Run worker → STEP + STL per piece. */
  async buildProduct(): Promise<CadProduct> {
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
