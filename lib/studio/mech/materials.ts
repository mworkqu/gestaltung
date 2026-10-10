// Printed-part materials (shared by the geometry worker, which decides the
// material, and the main thread, which makes the three.js material for it).

import * as THREE from "three";
import type { Environment, MATERIALS, MechTemplate } from "../schema";

export type Material = (typeof MATERIALS)[number];

/**
 * Material: an explicit non-PLA choice on the part wins; else light_pipe → PETG
 * (clear), button_extender / cable_clip → TPU, outdoor → PETG, else PLA.
 */
export function defaultMaterial(template: MechTemplate, chosen: Material | undefined, environment?: Environment): Material {
  if (template === "light_pipe") return "PETG";
  if (chosen && chosen !== "PLA") return chosen;
  if (template === "button_extender" || template === "cable_clip") return "TPU";
  return environment === "outdoor" ? "PETG" : "PLA";
}

const COLOURS: Record<Material, number> = { PLA: 0xf2f0eb, PETG: 0xcfe6f2, TPU: 0x3a3d42 };

export function materialFor(m: Material): THREE.MeshStandardMaterial {
  return m === "PETG"
    ? new THREE.MeshStandardMaterial({ color: COLOURS.PETG, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.6 })
    : new THREE.MeshStandardMaterial({ color: COLOURS[m], roughness: m === "TPU" ? 0.9 : 0.7, metalness: 0 });
}
