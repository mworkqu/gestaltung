// Printable mechanical parts → three.js objects, placed in enclosure coords,
// with an explode vector and real grams (from the built geometry's volume).
// lid / base reuse the enclosure's own meshes when given (the enclosure IS the
// printable lid and base); otherwise the template fallback is built.

import * as THREE from "three";
import { type Environment, type LibraryPart, type MechPart, type MechTemplate } from "../schema";
import type { LayoutResult } from "../layout";
import type { Vec3 } from "../explode";
import { defaultMaterial, materialFor, type Material } from "./materials";
import { checkPrintable, type PrintCheck } from "../geometry/mesh-check";
import { gramsFromVolume } from "../weight";
import { MECH_BUILDERS, signedVolume, triangleCount } from "./templates";
import { dimsFromLayout, placeMechParts, type MechDims } from "./place";

export { defaultMaterial, type Material } from "./materials";

export type BuiltMechPart = {
  id: string;
  template: MechTemplate;
  name: { en: string; ar: string };
  /** Mesh named after the part id, positioned in enclosure coords. */
  object: THREE.Object3D;
  explode: Vec3;
  printable: { material: Material; estGrams: number };
  volumeMm3: number;
  triangles: number;
  /**
   * F-003: can a slicer print this mesh? The template builder works with
   * three-bvh-csg, whose boolean results are triangle soups (the tester's lid
   * had 2,483 unbalanced edges and read as 297 shells), so every body is checked
   * and a failing one is never offered as a download.
   */
  check: PrintCheck;
  /** Outer size in the print pose (mm) — what the plate packer needs. */
  size: { w: number; d: number; h: number };
};

export type MechEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; dims: MechDims };

import { MECH_NAMES } from "./names";
export { MECH_NAMES };

/** The manifold check on a three.js geometry (F-003). */
export function checkGeometry(g: THREE.BufferGeometry): PrintCheck {
  const pos = g.getAttribute("position");
  if (!pos) return { ok: false, watertight: false, badEdges: 0, shells: 0, triangles: 0 };
  const positions = new Float32Array(pos.array as ArrayLike<number>);
  const index = g.getIndex();
  const indices = index
    ? new Uint32Array(index.array as ArrayLike<number>)
    : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  return checkPrintable({ positions, indices });
}

/** Outer size of a mesh as it would sit on the bed (its own rotation applied). */
function sizeOf(mesh: THREE.Mesh): { w: number; d: number; h: number } {
  const g = mesh.geometry.clone();
  g.applyQuaternion(mesh.quaternion);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.dispose();
  if (!b) return { w: 0, d: 0, h: 0 };
  return { w: b.max.x - b.min.x, d: b.max.y - b.min.y, h: b.max.z - b.min.z };
}

export function buildMechParts(
  mech: readonly MechPart[],
  layout: LayoutResult,
  parts: Map<string, LibraryPart>,
  enclosure?: MechEnclosure,
  opts: { environment?: Environment } = {},
): BuiltMechPart[] {
  const dims = enclosure?.dims ?? dimsFromLayout(layout);
  const places = placeMechParts(mech, layout, parts, dims);
  const list = mech.map((m, i): BuiltMechPart => {
    const pl = places[i];
    const material = defaultMaterial(m.template, m.printable?.material, opts.environment);
    const shell = enclosure && (m.template === "lid" || m.template === "base") ? enclosure[m.template] : null;
    let mesh: THREE.Mesh;
    if (shell) {
      // The enclosure's own printable mesh (no rubber-feet children).
      mesh = new THREE.Mesh(shell.geometry, shell.material);
      mesh.position.copy(shell.position);
      mesh.rotation.copy(shell.rotation);
    } else {
      mesh = new THREE.Mesh(MECH_BUILDERS[m.template](pl.params), materialFor(material));
      mesh.position.set(...pl.position);
      mesh.rotation.z = (pl.rotZ * Math.PI) / 180;
    }
    mesh.name = m.id;
    mesh.userData = { mechId: m.id, template: m.template, forInstance: m.forInstance ?? null };
    const volumeMm3 = Math.abs(signedVolume(mesh.geometry));
    return {
      id: m.id,
      template: m.template,
      name: MECH_NAMES[m.template],
      object: mesh,
      explode: pl.explode,
      printable: { material, estGrams: gramsFromVolume(volumeMm3, material) },
      volumeMm3,
      triangles: triangleCount(mesh.geometry),
      check: checkGeometry(mesh.geometry),
      size: sizeOf(mesh),
    };
  });
  // stake_pod: the soil spike is printed on its own, peg end down (turned over here so the
  // slicer files rest on the flat peg; the case viewer shows it in place under the pod).
  const spike = enclosure?.base.children.find((c) => c.name === SPIKE_MESH) as THREE.Mesh | undefined;
  if (spike && mech.some((m) => m.template === "base")) {
    const geometry = spike.geometry.clone();
    const mesh = new THREE.Mesh(geometry, materialFor("PETG"));
    mesh.rotation.x = Math.PI;
    mesh.name = STAKE_SPIKE_ID;
    mesh.userData = { mechId: STAKE_SPIKE_ID, template: "base", forInstance: null };
    const volumeMm3 = Math.abs(signedVolume(geometry));
    list.push({
      id: STAKE_SPIKE_ID,
      template: "base",
      name: STAKE_SPIKE_NAME,
      object: mesh,
      explode: [0, 0, -Math.max(20, dims.H * 0.8)],
      // Soil is wet: PETG, whatever the environment.
      printable: { material: "PETG", estGrams: gramsFromVolume(volumeMm3, "PETG") },
      volumeMm3,
      triangles: triangleCount(geometry),
      check: checkGeometry(geometry),
      size: sizeOf(mesh),
    });
  }
  return list;
}

/** The stake pod's soil spike in the printed-parts list (an extra part next to lid + base). */
export const STAKE_SPIKE_ID = "stake_spike";
export const STAKE_SPIKE_NAME = { en: "Soil spike", ar: "وتد التربة" } as const;
/** Same name as lib/studio/enclosure/build.ts SPIKE_MESH (kept here so this file needs no CSG import). */
const SPIKE_MESH = "enclosure_spike";
