// Viewer-owned materials + disposal helpers (three.js only, no React).

import * as THREE from "three";
import type { Colour, Finish } from "@/lib/studio/schema";
import { COLOUR_HEX, FINISH_PBR, LOOK_HEX } from "@/lib/studio/palette";

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

/**
 * Procedural wood (no textures): growth rings around the part's local X axis with
 * a narrow, warmer latewood band, fine fibre streaks along X, and slightly rougher
 * latewood so the grain also shows in the highlights.
 */
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
          "float gWarp = sin(vGrainPos.x * 0.045) * 2.2 + sin(vGrainPos.x * 0.013 + vGrainPos.z * 0.05) * 1.6 + sin(vGrainPos.y * 0.21 + vGrainPos.x * 0.11) * 0.6;",
          "float gR = length(vGrainPos.yz * vec2(1.0, 0.45)) + gWarp + sin(vGrainPos.x * 0.31 + vGrainPos.y * 0.07) * 0.35;",
          "float gG = fract(gR * 0.21);",
          "float gLate = smoothstep(0.3, 0.68, gG) * smoothstep(1.0, 0.72, gG);",
          "float gFibre = sin(vGrainPos.y * 3.7 + sin(vGrainPos.x * 0.9) * 0.6) * sin(vGrainPos.z * 2.9 + vGrainPos.x * 0.05);",
          "diffuseColor.rgb *= 1.04 - gLate * 0.16 + gFibre * 0.035;",
          "diffuseColor.rgb *= mix(vec3(1.0), vec3(1.02, 0.97, 0.9), gLate);",
        ].join("\n"),
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + gLate * 0.14 - 0.04, 0.05, 1.0);",
      );
  };
  m.customProgramCacheKey = () => "studio-wood-grain-3";
}

/**
 * Brushed aluminium without textures: fine streaks along the part's local X axis
 * vary the roughness by ±amount (and the colour a hair), which reads like the
 * anisotropic sheen of brushed, anodized metal.
 */
function addBrushed(m: THREE.MeshPhysicalMaterial, amount: number) {
  const a = amount.toFixed(3);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBrushPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBrushPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBrushPos;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float bS = sin(vBrushPos.y * 4.0 + sin(vBrushPos.x * 0.07) * 1.5) * 0.5",
          "  + sin(vBrushPos.y * 11.0 + vBrushPos.z * 9.0) * 0.3 + sin(vBrushPos.z * 6.5 + vBrushPos.y * 1.3) * 0.2;",
          "diffuseColor.rgb *= 1.0 + bS * 0.015;",
        ].join("\n"),
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 + bS * ${a}), 0.05, 1.0);`,
      );
  };
  m.customProgramCacheKey = () => `studio-brushed-${a}`;
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
  if (pbr.sheen) {
    m.sheen = pbr.sheen;
    m.sheenRoughness = pbr.sheenRoughness ?? 0.8;
    m.sheenColor = c.clone().lerp(new THREE.Color("#ffffff"), 0.25);
  }
  if (finish === "wood_look") addWoodGrain(m);
  else if (pbr.brushed) addBrushed(m, pbr.brushed);
  return m;
}

/** Bare PCB colours: their glossy solder mask gets a little less of the room reflection. */
const PCB_HEX = new Set((["pcb_green", "pcb_black", "pcb_blue"] as const).map((k) => new THREE.Color(LOOK_HEX[k]).getHex()));

/**
 * Give PCB-coloured materials under root their own (dimmer) environment: with an
 * explicit envMap, three uses material.envMapIntensity instead of scene.environmentIntensity.
 */
export function dimPcbEnvironment(root: THREE.Object3D, env: THREE.Texture | null, intensity: number): void {
  forEachMaterial(root, (mat) => {
    const m = mat as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial || !PCB_HEX.has(m.color.getHex())) return;
    if (m.envMap !== env) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    m.envMapIntensity = intensity;
  });
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
