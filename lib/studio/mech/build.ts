// Printable mechanical parts → three.js objects, placed in enclosure coords,
// with an explode vector and real grams (from the built geometry's volume).
// lid / base reuse the enclosure's own meshes when given (the enclosure IS the
// printable lid and base); otherwise the template fallback is built.

import * as THREE from "three";
import { estGrams, type Environment, type LibraryPart, type MATERIALS, type MechPart, type MechTemplate } from "../schema";
import type { LayoutResult } from "../layout";
import type { Vec3 } from "../explode";
import { MECH_BUILDERS, signedVolume, triangleCount } from "./templates";
import { dimsFromLayout, placeMechParts, type MechDims } from "./place";

export type Material = (typeof MATERIALS)[number];

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
};

export type MechEnclosure = { base: THREE.Mesh; lid: THREE.Mesh; dims: MechDims };

export const MECH_NAMES: Record<MechTemplate, { en: string; ar: string }> = {
  standoff: { en: "Standoff", ar: "عمود تثبيت" },
  pcb_cradle: { en: "Board cradle", ar: "حامل اللوحة" },
  battery_clip: { en: "Battery clip", ar: "مشبك البطارية" },
  sensor_mount: { en: "Sensor mount", ar: "حامل المستشعر" },
  cable_clip: { en: "Cable clip", ar: "مشبك السلك" },
  button_extender: { en: "Button extender", ar: "ممدّد الزر" },
  light_pipe: { en: "Light pipe", ar: "موجّه الضوء" },
  wall_bracket: { en: "Wall bracket", ar: "حامل الحائط" },
  lid: { en: "Lid", ar: "الغطاء" },
  base: { en: "Base", ar: "القاعدة" },
};

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

function materialFor(m: Material): THREE.MeshStandardMaterial {
  return m === "PETG"
    ? new THREE.MeshStandardMaterial({ color: COLOURS.PETG, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.6 })
    : new THREE.MeshStandardMaterial({ color: COLOURS[m], roughness: m === "TPU" ? 0.9 : 0.7, metalness: 0 });
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
  return mech.map((m, i) => {
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
      printable: { material, estGrams: estGrams(volumeMm3, material) },
      volumeMm3,
      triangles: triangleCount(mesh.geometry),
    };
  });
}
