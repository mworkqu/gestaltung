// The product "photo studio" (P5-16 Phase 2b), shared by the worker's preview
// pictures and the interactive viewer after "Create my CAD", so both look the
// same and match the current Studio viewer: ACES filmic tone mapping at the
// same exposure, the room reflection (RoomEnvironment), a hemisphere bounce and
// key / fill / rim lights in the same directions, finishes from FINISH_PBR.
//
// Pure three.js, no DOM: works on an OffscreenCanvas in the worker. World frame
// = the solver's (mm, Z up, −y front); the camera's up is +Z.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { makeEnclosureMaterial } from "@/components/studio/viewer/materials";
import type { Colour, Finish } from "../../schema";
import type { ProductMaterial } from "../schema";
import type { Box3 } from "../shapes";

/** Same look as components/studio/viewer/Viewer.tsx. */
export const STAGE_LOOK = { exposure: 0.92, envIntensity: 0.6 } as const;

/** View directions (from the target towards the camera), Z up. */
export const VIEW_DIRS = {
  front: [0, -1, 0.2],
  side: [1, 0, 0.2],
  /** The 3/4 view the Studio viewer opens on (its home direction, mapped to Z up). */
  iso: [0.75, -1, 0.62],
} as const satisfies Record<string, [number, number, number]>;
export type ProductView = keyof typeof VIEW_DIRS;

// Light directions of the viewer (Y up there), mapped to Z up: (x, y, z) → (x, −z, y).
const KEY_DIR = new THREE.Vector3(0.6, -0.75, 1.1).normalize();
const FILL_DIR = new THREE.Vector3(-0.9, -0.4, 0.45).normalize();
const RIM_DIR = new THREE.Vector3(-0.2, 1, 0.7).normalize();

export function applyRendererLook(r: THREE.WebGLRenderer): void {
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = STAGE_LOOK.exposure;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** The room reflection (no network). Call dispose() with the renderer. */
export function makeEnvironment(r: THREE.WebGLRenderer): { texture: THREE.Texture; dispose(): void } {
  const pmrem = new THREE.PMREMGenerator(r);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}

/** The studio's soft background gradient (#f4f7fb → #e6ebf2), for opaque pictures. */
export function makeBackground(): THREE.DataTexture {
  const h = 128;
  const data = new Uint8Array(h * 4);
  const top = new THREE.Color("#f4f7fb");
  const bottom = new THREE.Color("#e3e9f1");
  for (let i = 0; i < h; i++) {
    const c = bottom.clone().lerp(top, i / (h - 1));
    data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, 1, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export type StageLights = {
  group: THREE.Group;
  key: THREE.DirectionalLight;
  /** Aim every light at `centre` for a product of radius `r` (and size the shadow camera). */
  place(centre: THREE.Vector3, r: number): void;
};

export function makeLights(): StageLights {
  const group = new THREE.Group();
  group.name = "stage_lights";
  // Light sky / cool floor bounce (the HemisphereLight's "up" is its position: +Z here).
  const hemi = new THREE.HemisphereLight("#fbfcff", "#b9c4d3", 0.55);
  hemi.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight("#fffaf2", 1.75);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight("#e8eef8", 0.4);
  const rim = new THREE.DirectionalLight("#ffffff", 0.85);
  group.add(hemi, key, key.target, fill, fill.target, rim, rim.target);
  return {
    group,
    key,
    place(centre, r) {
      const at = (l: THREE.DirectionalLight, dir: THREE.Vector3) => {
        l.position.copy(centre).addScaledVector(dir, r * 4);
        l.target.position.copy(centre);
        l.target.updateMatrixWorld();
      };
      at(key, KEY_DIR);
      at(fill, FILL_DIR);
      at(rim, RIM_DIR);
      const cam = key.shadow.camera;
      const s = r * 1.5;
      cam.left = -s;
      cam.right = s;
      cam.top = s;
      cam.bottom = -s;
      cam.near = Math.max(0.5, r * 0.5);
      cam.far = r * 9;
      cam.up.set(0, 0, 1);
      cam.updateProjectionMatrix();
      key.shadow.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Product meshes
// ---------------------------------------------------------------------------

export type PieceLook = {
  material: ProductMaterial;
  colour: Colour;
  colourHex: string;
  finish: Finish;
  role: string;
};

/** A warm glow for clear light rings / windows ("lights up to show what it's doing"). */
const GLOW = "#ff8f1f";
/** Neutral clear colours glow warm; a coloured clear part glows in its own colour. */
const NEUTRAL_CLEAR: readonly Colour[] = ["mist", "chalk", "graphite", "sand"];

/** The light colour of a glowing clear body. */
export function glowColour(p: Pick<PieceLook, "colour" | "colourHex">): THREE.Color {
  if (NEUTRAL_CLEAR.includes(p.colour)) return new THREE.Color(GLOW);
  // Saturated and bright, so ACES keeps the hue instead of washing it to white.
  const c = new THREE.Color(p.colourHex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.max(0.75, hsl.s), 0.58);
}

export function pieceMaterial(p: PieceLook, finishOverride?: Finish | null): THREE.Material {
  if (p.material === "aluminium") {
    return new THREE.MeshPhysicalMaterial({ color: "#c9ced6", metalness: 0.85, roughness: 0.32 });
  }
  if (p.material === "resin_clear") {
    const glows = p.role === "light_ring" || p.role === "window";
    if (glows) {
      // Frosted, lit from inside: the light colour on a pale body, bright enough to read
      // as "on" under the ACES tone mapping.
      const light = glowColour(p);
      return new THREE.MeshPhysicalMaterial({
        color: light.clone().lerp(new THREE.Color("#ffffff"), 0.1),
        roughness: 0.4,
        metalness: 0,
        transparent: true,
        opacity: 0.96,
        emissive: light,
        emissiveIntensity: 0.85,
        clearcoat: 0.4,
        clearcoatRoughness: 0.2,
      });
    }
    // Clear, not lit (a hopper, a tank window): see-through so what is inside shows.
    const c = new THREE.Color(p.colourHex).lerp(new THREE.Color("#ffffff"), 0.6);
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  if (p.material === "TPU") return makeEnclosureMaterial("soft_touch", p.colour);
  return makeEnclosureMaterial(finishOverride ?? p.finish, p.colour);
}

export function linkMaterial(kind: "tube" | "cable", colourHex: string): THREE.Material {
  if (kind === "cable") return new THREE.MeshStandardMaterial({ color: colourHex, roughness: 0.6 });
  // Silicone tube: a little see-through.
  return new THREE.MeshPhysicalMaterial({ color: colourHex, roughness: 0.35, transparent: true, opacity: 0.78, clearcoat: 0.3 });
}

/** A BufferGeometry from the kernel's arrays (world coordinates). Arrays are used as they are (no copy). */
export function geometryFromArrays(m: { positions: Float32Array; normals?: Float32Array; indices: Uint32Array }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  if (m.normals) g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  else g.computeVertexNormals();
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export const toBox3 = (b: Box3): THREE.Box3 => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));

// ---------------------------------------------------------------------------
// Camera framing
// ---------------------------------------------------------------------------

/**
 * Put `camera` on `dir` from the box centre so the box's 8 corners fill `fill` of the
 * frame (a few projection passes, like the viewer's plate fit). Z up.
 */
export function frameBox(camera: THREE.PerspectiveCamera, box: THREE.Box3, dir: readonly [number, number, number], fill = 0.84): void {
  const d = new THREE.Vector3(...dir).normalize();
  const centre = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(10, sphere.radius);
  camera.up.set(0, 0, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * Math.max(0.5, camera.aspect || 1)));
  let dist = (r / Math.sin(fit / 2)) * 1.02;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  for (let it = 0; it < 10; it++) {
    camera.position.copy(centre).addScaledVector(d, dist);
    camera.lookAt(centre);
    camera.near = Math.max(0.5, dist / 100);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let m = 0;
    for (const c of corners) {
      const v = c.clone().project(camera);
      m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
    }
    const k = m / fill;
    if (!Number.isFinite(k) || Math.abs(k - 1) < 0.01) break;
    // Perspective: scaling the distance scales the projection roughly by 1/k.
    dist *= Math.max(0.5, Math.min(2, k));
  }
}

/** The box a picture should show: the product plus the props' focus (pot, hand…), a little clipped below. */
export function pictureBox(product: Box3, focus: Box3 | null): THREE.Box3 {
  const b = toBox3(product);
  if (focus) {
    const f = toBox3(focus);
    // Keep the bottom of a deep pot from shrinking the product: show at most 60 % of the
    // product's height below its lowest point.
    const h = Math.max(20, b.max.z - b.min.z);
    f.min.z = Math.max(f.min.z, b.min.z - h * 0.6);
    b.union(f);
  }
  return b;
}
