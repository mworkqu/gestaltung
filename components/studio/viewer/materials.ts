// Viewer-owned materials + disposal helpers (three.js only, no React).

import * as THREE from "three";
import type { Colour, Finish } from "@/lib/studio/schema";
import { COLOUR_HEX, FINISH_PBR } from "@/lib/studio/palette";

/** userData key marking a viewer object (component / enclosure / extra). */
export type StudioObjectData = {
  kind: "component" | "base" | "lid" | "extra";
  rest: [number, number, number];
  layer?: number;
  vector?: [number, number, number];
};

export function studioData(o: THREE.Object3D): StudioObjectData | undefined {
  return (o.userData as { studio?: StudioObjectData }).studio;
}

/** Procedural wood grain (rings around the part's local X axis), no textures. */
function addWoodGrain(m: THREE.MeshPhysicalMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrainPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGrainPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrainPos;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float gr = length(vGrainPos.yz * vec2(1.0, 0.45)) + sin(vGrainPos.x * 0.045) * 2.2 + sin(vGrainPos.x * 0.31 + vGrainPos.y * 0.07) * 0.35;",
          "float gg = fract(gr * 0.21);",
          "float ring = smoothstep(0.0, 0.55, gg) * smoothstep(1.0, 0.55, gg);",
          "diffuseColor.rgb *= mix(0.8, 1.07, ring);",
        ].join("\n"),
      );
  };
  m.customProgramCacheKey = () => "studio-wood-grain";
}

/** Enclosure material for a finish + colour; `tint` (optional accent) is mixed in at `tintAmount`. */
export function makeEnclosureMaterial(finish: Finish, colour: Colour, tint?: Colour, tintAmount = 0.3): THREE.MeshPhysicalMaterial {
  const pbr = FINISH_PBR[finish] ?? FINISH_PBR.matte_plastic;
  const c = new THREE.Color(COLOUR_HEX[colour] ?? COLOUR_HEX.chalk);
  if (tint && tint !== colour) c.lerp(new THREE.Color(COLOUR_HEX[tint]), tintAmount);
  const m = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: pbr.roughness,
    metalness: pbr.metalness,
    clearcoat: pbr.clearcoat ?? 0,
    clearcoatRoughness: pbr.clearcoatRoughness ?? 0,
    side: THREE.FrontSide,
  });
  if (finish === "wood_look") addWoodGrain(m);
  return m;
}

/** Clone every material of a built model (models share cached materials we must not mutate). */
export function cloneMaterials(root: THREE.Object3D): void {
  const map = new Map<THREE.Material, THREE.Material>();
  const cl = (m: THREE.Material) => {
    let c = map.get(m);
    if (!c) {
      c = m.clone();
      map.set(m, c);
    }
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cl) : cl(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Dispose geometries + materials under root (only for objects the viewer created). */
export function disposeObject(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) mats.add(m);
  });
  for (const m of mats) m.dispose();
}

export function forEachMaterial(root: THREE.Object3D, fn: (m: THREE.Material) => void): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) fn(m);
  });
}
