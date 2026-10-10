// Procedural model builders: pure three.js (no React), so the same code runs in
// the R3F viewer, in STL export and in vitest (node).
//
// Conventions (all builders):
//  * units mm, Z up;
//  * the returned Group's bounding box spans x ∈ [-dims.x/2, dims.x/2],
//    y ∈ [-dims.y/2, dims.y/2], z ∈ [0, dims.z] (sits ON the plane, centred in XY);
//  * PCB-like boards: the board is the bottom slab, parts sit on top (+z);
//  * port faces follow LibraryPart.ports (+x = right, +y = back, +z = top);
//  * meshes only use MeshStandardMaterial / MeshPhysicalMaterial from ./materials;
//  * no textures, no external fetches.

import type * as THREE from "three";
import type { LibraryPart } from "../schema";

export type BuildContext = {
  part: LibraryPart;
  /** Builder params from part.model.params. */
  params: Record<string, unknown>;
};

export type ModelBuilder = (ctx: BuildContext) => THREE.Group;
