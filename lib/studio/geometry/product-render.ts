// Offscreen product pictures (P5-16 Phase 2b), INSIDE the geometry worker.
//
// three.js draws a built product (the kernel's cached meshes — they never leave
// the worker) in its scene (lib/studio/product/scene: props + the Studio
// viewer's lights / ACES / finishes) on an OffscreenCanvas, and returns PNG
// bytes only. Used for the three 512 px views the vision check reads (front,
// side, 3/4) and the final ≤ 1024 px 3/4 picture the client sees.
//
// One WebGL renderer per worker, created on first use and reused. A browser
// without OffscreenCanvas / WebGL gets `null` from offscreenRenderer(): the
// pipeline answers "no_render" and the page keeps the template enclosure flow.

import * as THREE from "three";
import type { BuiltProduct } from "./product-kernel";
import type { SolvedProduct } from "../product/solve";
import { buildSceneProps, sceneHintsFromPieces } from "../product/scene/props";
import {
  VIEW_DIRS,
  applyRendererLook,
  frameBox,
  geometryFromArrays,
  linkMaterial,
  makeBackground,
  makeEnvironment,
  makeLights,
  pictureBox,
  pieceMaterial,
  STAGE_LOOK,
  type ProductView,
} from "../product/scene/stage";

export type RenderShot = { view: ProductView; size: number };
export type SolvedStage = Pick<SolvedProduct, "scene" | "stage" | "bbox">;

type Offscreen = {
  renderer: THREE.WebGLRenderer;
  canvas: OffscreenCanvas;
  env: { texture: THREE.Texture; dispose(): void };
  background: THREE.Texture;
};

let shared: Offscreen | null | undefined;

/** The worker's one offscreen renderer (null when the browser cannot draw off screen). */
export function offscreenRenderer(): Offscreen | null {
  if (shared !== undefined) return shared;
  try {
    if (typeof OffscreenCanvas === "undefined") return (shared = null);
    const canvas = new OffscreenCanvas(512, 512);
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(1);
    applyRendererLook(renderer);
    shared = { renderer, canvas, env: makeEnvironment(renderer), background: makeBackground() };
  } catch {
    shared = null;
  }
  return shared;
}

export function canRenderOffscreen(): boolean {
  return offscreenRenderer() !== null;
}

/** Product meshes over the cached arrays (no copy) + their own materials. */
function productGroup(built: BuiltProduct): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "product";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  for (const p of built.pieces) {
    const g = geometryFromArrays(p);
    const m = pieceMaterial(p);
    geos.push(g);
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = p.material !== "resin_clear";
    mesh.receiveShadow = true;
    mesh.name = p.id;
    group.add(mesh);
  }
  for (const l of built.links) {
    const g = geometryFromArrays(l);
    const m = linkMaterial(l.kind, l.colourHex);
    geos.push(g);
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

async function toPng(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

/**
 * Pictures of a built product in its scene, one PNG per shot (in order). Rejects when
 * there is no offscreen renderer. Nothing but PNG bytes comes out.
 */
export async function renderProductShots(built: BuiltProduct, solved: SolvedStage, shots: RenderShot[]): Promise<ArrayBuffer[]> {
  const off = offscreenRenderer();
  if (!off) throw new Error("no_render");
  const { renderer, canvas } = off;
  const scene = new THREE.Scene();
  scene.background = off.background;
  scene.environment = off.env.texture;
  scene.environmentIntensity = STAGE_LOOK.envIntensity;
  const lights = makeLights();
  scene.add(lights.group);
  const props = buildSceneProps(solved.scene, solved.stage, solved.bbox, sceneHintsFromPieces(built.pieces));
  scene.add(props.group);
  const product = productGroup(built);
  scene.add(product.group);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  const box = pictureBox(solved.bbox, props.focus);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  lights.place(sphere.center, Math.max(30, sphere.radius));
  const out: ArrayBuffer[] = [];
  try {
    for (const shot of shots) {
      const size = Math.max(64, Math.min(1024, Math.round(shot.size)));
      renderer.setSize(size, size, false);
      camera.aspect = 1;
      frameBox(camera, box, VIEW_DIRS[shot.view], shot.view === "iso" ? 0.86 : 0.88);
      renderer.render(scene, camera);
      out.push(await toPng(canvas));
    }
  } finally {
    product.dispose();
    props.dispose();
    scene.clear();
  }
  return out;
}
