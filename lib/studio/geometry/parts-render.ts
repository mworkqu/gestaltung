// The Parts step picture, drawn INSIDE the geometry worker (owner 2026-10-11:
// "load the engine only if the user is heading to the CAD"). The page shows a
// PNG instead of a live 3D canvas, so three.js / R3F never download on the
// main thread before "Create my CAD".
//
// Same look as the 3D viewer's plate mode: the shared plate packer
// (lib/studio/plate.ts), the library part models (lib/studio/models), the
// studio lights / ACES / room reflection (product/scene/stage.ts) and the
// worker's one offscreen renderer (product-render.ts). Owner-uploaded STL parts
// are fetched and placed like the viewer does (stl-fit); a failed STL keeps the
// grey placeholder box.
//
// Out: PNG bytes + where each part's centre lands on the picture (0–1), so the
// page can put a tap target on every part.

import * as THREE from "three";
import { buildPartModel, mat } from "../models";
import { dimPcbEnvironment } from "@/components/studio/viewer/materials";
import { stlFit } from "../library/stl-fit";
import { PLATE_T, platePlacements } from "../plate";
import { applyRendererLook, frameBox, makeLights, STAGE_LOOK } from "../product/scene/stage";
import type { LibraryPart } from "../schema";
import type { PartsPictureInput, PartsPictureResult } from "./protocol";
import { offscreenRenderer } from "./product-render";

/** The viewer's plate camera direction (Y up there: 0.5, 0.9, 1), in this Z-up frame. */
const PLATE_VIEW: [number, number, number] = [0.5, -1, 0.9];
const PCB_ENV_INTENSITY = 0.38;
const MAX_SIDE = 1600;

const stlCache = new Map<string, Promise<THREE.BufferGeometry>>();

function loadStl(url: string): Promise<THREE.BufferGeometry> {
  let p = stlCache.get(url);
  if (!p) {
    p = (async () => {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`STL ${res.status}`);
      const geo = new STLLoader().parse(await res.arrayBuffer());
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      return geo;
    })();
    p.catch(() => stlCache.delete(url));
    stlCache.set(url, p);
  }
  return p;
}

async function partModel(part: LibraryPart): Promise<THREE.Group> {
  if (part.model.kind === "stl" && part.model.url) {
    try {
      const geo = await loadStl(part.model.url);
      const bb = geo.boundingBox!;
      const fit = stlFit({ min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] }, part.dims);
      const mesh = new THREE.Mesh(geo, mat(part.look.body));
      mesh.scale.setScalar(fit.scale);
      mesh.position.set(...fit.offset);
      const g = new THREE.Group();
      g.add(mesh);
      return g;
    } catch {
      /* the placeholder box below */
    }
  }
  try {
    return buildPartModel(part);
  } catch {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 6), new THREE.MeshStandardMaterial({ color: "#c9d3df", roughness: 0.7 }));
    m.position.z = 3;
    g.add(m);
    return g;
  }
}

function plate(radius: number, accent: string): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius, PLATE_T, 96);
  geo.rotateX(Math.PI / 2); // axis Y → Z
  geo.translate(0, 0, -PLATE_T / 2);
  const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#f4f7fb", roughness: 0.55, metalness: 0 }));
  top.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.9, 12, 128), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.1 }));
  rim.position.z = 0.2;
  g.add(top, rim);
  return g;
}

/** GPU memory back (three re-uploads a disposed geometry / material if it is drawn again). */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of mats) x.dispose();
  });
}

/** Draw the parts plate. Rejects when the browser cannot draw off screen ("no_render"). */
export async function renderPartsPicture(input: PartsPictureInput): Promise<PartsPictureResult> {
  const off = offscreenRenderer();
  if (!off) throw new Error("no_render");
  const width = Math.max(64, Math.min(MAX_SIDE, Math.round(input.width)));
  const height = Math.max(64, Math.min(MAX_SIDE, Math.round(input.height)));
  const { renderer, canvas } = off;

  const byId = new Map(input.parts);
  const items = input.parts.map(([instanceId, part]) => ({ instanceId, partId: part.id }));
  const { placements, radius } = platePlacements(items, byId);
  const models = await Promise.all(placements.map((pl) => partModel(byId.get(pl.c.instanceId)!)));

  const scene = new THREE.Scene();
  scene.background = off.background;
  scene.environment = off.env.texture;
  scene.environmentIntensity = STAGE_LOOK.envIntensity;
  const lights = makeLights();
  scene.add(lights.group);
  const content = new THREE.Group();
  content.add(plate(radius, input.accent));
  const centres: { instanceId: string; at: THREE.Vector3 }[] = [];
  placements.forEach((pl, i) => {
    const g = models[i];
    g.position.set(pl.pos[0], pl.pos[1], pl.pos[2] + 1.6); // the viewer's resting bob height
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    dimPcbEnvironment(g, off.env.texture, PCB_ENV_INTENSITY);
    content.add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    centres.push({ instanceId: pl.c.instanceId, at: box.isEmpty() ? g.position.clone() : box.getCenter(new THREE.Vector3()) });
  });
  scene.add(content);

  // Frame the plate (its rim and the tallest part), like the viewer's plate fit.
  const top = Math.max(10, ...placements.map((pl) => (byId.get(pl.c.instanceId)?.dims.z ?? 6) + pl.pos[2]));
  // The plate is round: a square box around it would leave its corners empty in the
  // 3/4 view and shrink the picture, so frame a box a little inside the corners.
  const r = radius * 0.78;
  const frame = new THREE.Box3(new THREE.Vector3(-r, -r, -PLATE_T), new THREE.Vector3(r, r, top));
  const camera = new THREE.PerspectiveCamera(35, width / height, 1, 20000);
  frameBox(camera, frame, PLATE_VIEW, 0.9);
  const sphere = frame.getBoundingSphere(new THREE.Sphere());
  lights.place(sphere.center, Math.max(30, sphere.radius));

  try {
    applyRendererLook(renderer);
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
    // convertToBlob copies the canvas now (before any other job can draw on it).
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const spots = centres.map(({ instanceId, at }) => {
      const v = at.clone().project(camera);
      return { instanceId, x: Math.min(1, Math.max(0, (v.x + 1) / 2)), y: Math.min(1, Math.max(0, (1 - v.y) / 2)) };
    });
    return { png: await blob.arrayBuffer(), width, height, spots };
  } finally {
    disposeTree(content);
    scene.clear();
  }
}
