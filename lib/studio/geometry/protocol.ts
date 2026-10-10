// Messages between the main thread (geometry/client.ts) and the geometry
// worker (studio-geometry.worker.ts → job.ts). Plain data only.

import type { EnclosureMeta } from "../enclosure/build";
import type { Vec3 } from "../explode";
import type { LayoutResult } from "../layout";
import type { MechTemplate, EnclosureSpec, Environment, LibraryPart, MechPart } from "../schema";
import type { Material } from "../mech/materials";
import type { PackedGeometry } from "./pack";

export type EnclosureInput = {
  spec: EnclosureSpec;
  layout: LayoutResult;
  /** [instanceId, part] pairs (a Map does not survive every clone path). */
  parts: [string, LibraryPart][];
};

export type MechInput = EnclosureInput & { mech: MechPart[]; environment?: Environment };

export type PackedEnclosure = {
  base: PackedGeometry;
  lid: PackedGeometry;
  /** Rubber feet (children of the base; geometry already in base coords). */
  feet: { name: string; geometry: PackedGeometry }[];
  /** The plan (dims, settled layout, openings, label) the shell was cut for. */
  meta: EnclosureMeta;
};

export type PackedMechPart = {
  id: string;
  template: MechTemplate;
  name: { en: string; ar: string };
  explode: Vec3;
  printable: { material: Material; estGrams: number };
  volumeMm3: number;
  triangles: number;
  /** lid / base: the enclosure's own geometry is reused on the main thread. */
  shell?: "lid" | "base";
  geometry?: PackedGeometry;
  position: Vec3;
  rotation: Vec3;
};

export type GeometryRequest =
  | { id: number; kind: "enclosure"; key: string; input: EnclosureInput }
  | { id: number; kind: "mech"; key: string; encKey: string; input: MechInput };

export type GeometryReply =
  | { id: number; ok: true; kind: "enclosure"; result: PackedEnclosure; ms: number }
  | { id: number; ok: true; kind: "mech"; result: PackedMechPart[]; ms: number }
  | { id: number; ok: false; error: string };
