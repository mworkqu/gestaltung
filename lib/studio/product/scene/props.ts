// Scene props (P5-16 Phase 2b): the simple, stylised surroundings a product is
// shown in — a pot with soil and leaves, a desk, a wall, an open hand, a floor,
// a car dashboard, a patch of garden, a pet bowl. Soft neutral colours, no
// textures, never exported, never part of the product.
//
// Pure three.js (no DOM, no React): the SAME props are drawn by the geometry
// worker for the preview pictures (OffscreenCanvas) and by the interactive
// viewer after "Create my CAD", so the picture and the 3D view always match.
//
// Frame: mm, Z up, −y = the front (same as the solver). Sizes come from the
// solver's stage metrics (SolvedProduct.stage: the pot it widened to fit) and
// from the product's bounding box, so the props give scale without touching it.

import * as THREE from "three";
import type { Scene } from "../schema";
import type { SceneMetrics } from "../scene";
import type { Box3 } from "../shapes";

export const PROPS_NAME = "scene_props";

/** Soft neutral palette (no textures). */
export const PROP_COLOURS = {
  floor: "#e7ebf0",
  table: "#e6dfd5",
  wall: "#f1f2f4",
  pot: "#d6c1b1",
  potRim: "#cdb6a5",
  soil: "#6f5b4c",
  leaf: "#8fb08a",
  leafDark: "#7a9c76",
  stem: "#7c9a74",
  hand: "#e6d2c3",
  dash: "#575d68",
  dashTop: "#646b77",
  glass: "#cfd9e4",
  grass: "#c6d3bd",
  pebble: "#c3c7cc",
  bowl: "#c7d3e2",
  kibble: "#b88a5d",
} as const;

export type SceneProps = {
  group: THREE.Group;
  /** The part of the props a picture should keep in frame (the pot, the hand…), world box. */
  focus: Box3 | null;
  /** Free GPU memory (geometries + materials made here). */
  dispose(): void;
};

type Ctx = { group: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.Material[] };

function mat(ctx: Ctx, colour: string, opts: { roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: opts.roughness ?? 0.88, metalness: opts.metalness ?? 0 });
  m.userData.prop = true;
  ctx.mats.push(m);
  return m;
}

function add(ctx: Ctx, geo: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = ctx.group, opts: { cast?: boolean } = {}): THREE.Mesh {
  ctx.geos.push(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = opts.cast ?? false;
  parent.add(mesh);
  return mesh;
}

/** A disc (Z up) of radius r with its top at z. */
function disc(r: number, z: number, thickness = 2, segments = 96): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, thickness, segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, z - thickness / 2);
  return g;
}

/** A rounded slab (top at `top`), w × d × h, corner radius r, soft bevel. */
function slab(w: number, d: number, h: number, r: number, top: number): THREE.BufferGeometry {
  const rr = Math.max(0.5, Math.min(r, w / 2 - 0.5, d / 2 - 0.5));
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -d / 2, x1 = w / 2, y1 = d / 2;
  s.moveTo(x0 + rr, y0);
  s.lineTo(x1 - rr, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + rr);
  s.lineTo(x1, y1 - rr);
  s.quadraticCurveTo(x1, y1, x1 - rr, y1);
  s.lineTo(x0 + rr, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - rr);
  s.lineTo(x0, y0 + rr);
  s.quadraticCurveTo(x0, y0, x0 + rr, y0);
  const bevel = Math.min(3, h / 3);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.5, h - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, top - h + bevel);
  return g;
}

const extentOf = (b: Box3) => ({
  cx: (b.min[0] + b.max[0]) / 2,
  cy: (b.min[1] + b.max[1]) / 2,
  w: b.max[0] - b.min[0],
  d: b.max[1] - b.min[1],
  h: b.max[2] - b.min[2],
});

function box(min: [number, number, number], max: [number, number, number]): Box3 {
  return { min, max };
}

/** The ground everything stands on: a wide soft disc (receives the shadows). */
function floor(ctx: Ctx, z: number, reach: number, colour: string = PROP_COLOURS.floor) {
  add(ctx, disc(Math.max(260, reach * 3.2), z, 1, 128), mat(ctx, colour, { roughness: 0.95 }));
}

// ---------------------------------------------------------------------------
// plant_pot: pot + soil + a few leaves, on a table
// ---------------------------------------------------------------------------

/** One leaf: a pointed oval, a little thick, lying along +y in its own frame. */
function leafGeometry(length: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width * 0.62, length * 0.32, 0, length);
  s.quadraticCurveTo(-width * 0.62, length * 0.32, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.6, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.3);
  return g;
}

function plant(ctx: Ctx, at: [number, number], away: number, height: number, soilZ: number) {
  const leafMat = mat(ctx, PROP_COLOURS.leaf, { roughness: 0.7 });
  const leafDark = mat(ctx, PROP_COLOURS.leafDark, { roughness: 0.75 });
  const stemMat = mat(ctx, PROP_COLOURS.stem, { roughness: 0.8 });
  // Seven stems fanning away from the product (and two short ones behind), deterministic.
  const stems = [
    { a: 0, h: 1, tilt: 0.18 },
    { a: 0.75, h: 0.82, tilt: 0.38 },
    { a: -0.75, h: 0.86, tilt: 0.36 },
    { a: 1.35, h: 0.62, tilt: 0.55 },
    { a: -1.4, h: 0.6, tilt: 0.55 },
    { a: 0.32, h: 0.7, tilt: 0.28 },
    { a: -0.4, h: 0.74, tilt: 0.26 },
    { a: 2.6, h: 0.45, tilt: 0.6 },
    { a: -2.5, h: 0.42, tilt: 0.62 },
  ];
  stems.forEach((s, i) => {
    const az = away + s.a;
    const len = height * s.h;
    const dir = new THREE.Vector3(Math.cos(az), Math.sin(az), 0);
    const base = new THREE.Vector3(at[0], at[1], soilZ - 2);
    const tip = base
      .clone()
      .addScaledVector(dir, len * Math.sin(s.tilt) * 0.9)
      .add(new THREE.Vector3(0, 0, len * Math.cos(s.tilt) * 0.82));
    const mid = base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0, len * 0.06)).addScaledVector(dir, -len * 0.04);
    const curve = new THREE.CatmullRomCurve3([base, mid, tip]);
    add(ctx, new THREE.TubeGeometry(curve, 16, 1.6, 8, false), stemMat, ctx.group, { cast: true });
    // The leaf hangs from the stem tip, opening outwards and drooping a little.
    const leafLen = 34 + 22 * s.h;
    const g = new THREE.Group();
    g.position.copy(tip);
    g.rotation.z = az - Math.PI / 2; // leaf +y → outwards
    const inner = new THREE.Group();
    inner.rotation.x = 0.55 + s.tilt * 0.6; // lift off the vertical
    inner.rotation.y = (i % 2 ? 1 : -1) * 0.35;
    g.add(inner);
    add(ctx, leafGeometry(leafLen, leafLen * 0.5), i % 3 === 0 ? leafDark : leafMat, inner, { cast: true });
    ctx.group.add(g);
  });
}

function plantPotProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const pot = stage.pot ?? { radius: 75, wall: 6, rimAbove: 10, depth: 110 };
  const soilZ = stage.groundZ;
  const bottomZ = soilZ - pot.depth;
  const topZ = soilZ + pot.rimAbove;
  const rTop = pot.radius;
  const rBot = pot.radius * 0.78;
  const rim = 5;
  // Lathed pot: outer taper, rolled rim, inner wall down to the soil (open top).
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(0.01, bottomZ),
    new THREE.Vector2(rBot - 4, bottomZ),
    new THREE.Vector2(rBot, bottomZ + 4),
    new THREE.Vector2(rTop - 1.5, topZ - rim - 1),
    new THREE.Vector2(rTop + 1.5, topZ - rim),
    new THREE.Vector2(rTop + 2, topZ - 1.5),
    new THREE.Vector2(rTop + 0.5, topZ),
    new THREE.Vector2(rTop - pot.wall + 0.5, topZ),
    new THREE.Vector2(rTop - pot.wall, topZ - 1.5),
    new THREE.Vector2(rTop - pot.wall - 0.5, soilZ - 6),
    new THREE.Vector2(0.01, soilZ - 6),
  ];
  const lathe = new THREE.LatheGeometry(prof, 128);
  lathe.rotateX(Math.PI / 2);
  add(ctx, lathe, mat(ctx, PROP_COLOURS.pot, { roughness: 0.82 }), ctx.group, { cast: true });
  // Soil: a slightly domed disc just under the rim.
  const soilR = rTop - pot.wall - 0.5;
  const soil = new THREE.LatheGeometry(
    [new THREE.Vector2(0.01, soilZ + 1.2), new THREE.Vector2(soilR * 0.6, soilZ + 0.8), new THREE.Vector2(soilR, soilZ - 0.6), new THREE.Vector2(soilR, soilZ - 5), new THREE.Vector2(0.01, soilZ - 5)],
    96,
  );
  soil.rotateX(Math.PI / 2);
  add(ctx, soil, mat(ctx, PROP_COLOURS.soil, { roughness: 1 }));
  // The plant grows on the side away from the product.
  const e = extentOf(product);
  let away = Math.atan2(-e.cy, -e.cx);
  if (Math.hypot(e.cx, e.cy) < 4) away = Math.atan2(0.35, -1); // product in the middle: plant back-left
  const off = soilR * 0.42;
  const at: [number, number] = [Math.cos(away) * off, Math.sin(away) * off];
  const height = Math.max(110, Math.min(200, Math.max(e.h, 60) * 0.95));
  plant(ctx, at, away, height, soilZ);
  // Table the pot stands on.
  floor(ctx, bottomZ, Math.max(rTop, e.w / 2, e.d / 2) * 1.2, PROP_COLOURS.table);
  return box([-rTop - 2, -rTop - 2, bottomZ], [rTop + 2, rTop + 2, Math.max(topZ, soilZ + height * 0.75)]);
}

// ---------------------------------------------------------------------------
// The others
// ---------------------------------------------------------------------------

function deskProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const z = stage.floorZ;
  const w = Math.max(320, e.w * 3.2);
  const d = Math.max(220, e.d * 3);
  add(ctx, slab(w, d, 18, 10, z), mat(ctx, PROP_COLOURS.table, { roughness: 0.78 }));
  floor(ctx, z - 18 - 380, w, PROP_COLOURS.floor);
  return box([e.cx - e.w * 0.9 - 20, e.cy - e.d * 0.9 - 20, z - 18], [e.cx + e.w * 0.9 + 20, e.cy + e.d * 0.9 + 20, z]);
}

function wallProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const wallY = stage.wallY;
  const floorZ = stage.floorZ;
  const w = Math.max(420, e.w * 4);
  const top = Math.max(product.max[2] + 160, stage.mountZ * 2 + 80);
  const g = new THREE.BoxGeometry(w, 16, top - floorZ);
  g.translate(e.cx, wallY + 8, (top + floorZ) / 2);
  add(ctx, g, mat(ctx, PROP_COLOURS.wall, { roughness: 0.95 }));
  floor(ctx, floorZ, w * 0.5, PROP_COLOURS.floor);
  return box([e.cx - e.w * 0.9 - 24, wallY - e.d - 10, product.min[2] - 30], [e.cx + e.w * 0.9 + 24, wallY + 4, product.max[2] + 30]);
}

/** An open palm under the product: rounded palm, four fingers and a thumb. */
function handProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const skin = mat(ctx, PROP_COLOURS.hand, { roughness: 0.72 });
  const top = product.min[2];
  const palmW = Math.max(78, Math.min(110, e.w * 1.15));
  const palmL = Math.max(86, Math.min(120, e.d * 0.75));
  const palm = slab(palmW, palmL, 22, palmW * 0.42, top);
  palm.translate(e.cx, e.cy - palmL * 0.2, 0);
  add(ctx, palm, skin, ctx.group, { cast: true });
  const fingerR = palmW / 10;
  const lens = [0.72, 0.82, 0.78, 0.6];
  lens.forEach((k, i) => {
    const len = palmL * k;
    const g = new THREE.CapsuleGeometry(fingerR, len, 6, 16);
    // Capsule axis is Y: lie it along +y (towards the back), resting at the palm's level.
    const x = e.cx - palmW / 2 + fingerR * 1.25 + i * ((palmW - fingerR * 2.5) / 3);
    g.translate(x, e.cy - palmL * 0.2 + palmL / 2 + len / 2 + fingerR * 0.6, top - fingerR - 1);
    add(ctx, g, skin, ctx.group, { cast: true });
  });
  const thumb = new THREE.CapsuleGeometry(fingerR * 1.15, palmL * 0.45, 6, 16);
  thumb.rotateZ(-0.9);
  thumb.translate(e.cx + palmW / 2 + fingerR * 0.8, e.cy - palmL * 0.25, top - fingerR * 1.2);
  add(ctx, thumb, skin, ctx.group, { cast: true });
  floor(ctx, top - 140, palmL * 1.5, PROP_COLOURS.floor);
  return box([e.cx - palmW / 2 - 30, e.cy - palmL * 0.75, top - 24], [e.cx + palmW / 2 + 30, e.cy + palmL * 1.2, top]);
}

function floorProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  floor(ctx, stage.floorZ, Math.max(e.w, e.d), PROP_COLOURS.floor);
  // A skirting wall behind, for scale.
  const w = Math.max(500, e.w * 4);
  const g = new THREE.BoxGeometry(w, 12, 120);
  g.translate(e.cx, product.max[1] + 120, stage.floorZ + 60);
  add(ctx, g, mat(ctx, PROP_COLOURS.wall, { roughness: 0.95 }));
  return box([product.min[0] - 20, product.min[1] - 20, stage.floorZ], [product.max[0] + 20, product.max[1] + 20, stage.floorZ + 10]);
}

function carDashProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const z = Math.min(stage.groundZ, product.min[2]);
  const w = Math.max(360, e.w * 4);
  // Dashboard: a long rounded slab, the back raised like a cowl.
  const dash = slab(w, Math.max(180, e.d * 3), 40, 26, z);
  dash.translate(e.cx, e.cy + 30, 0);
  add(ctx, dash, mat(ctx, PROP_COLOURS.dash, { roughness: 0.9 }));
  const cowl = new THREE.CylinderGeometry(30, 30, w * 0.96, 48, 1, false, 0, Math.PI);
  cowl.rotateZ(Math.PI / 2);
  cowl.translate(e.cx, e.cy + 30 + Math.max(180, e.d * 3) / 2 - 30, z);
  add(ctx, cowl, mat(ctx, PROP_COLOURS.dashTop, { roughness: 0.9 }));
  // Windscreen hint: a pale tilted plane behind.
  const glass = new THREE.PlaneGeometry(w * 0.96, 160);
  glass.rotateX(Math.PI / 2 - 0.55);
  glass.translate(e.cx, e.cy + 30 + Math.max(180, e.d * 3) / 2 + 40, z + 70);
  const gm = new THREE.MeshStandardMaterial({ color: PROP_COLOURS.glass, roughness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  gm.userData.prop = true;
  ctx.mats.push(gm);
  add(ctx, glass, gm);
  floor(ctx, z - 240, w * 0.6, PROP_COLOURS.floor);
  return box([e.cx - e.w - 30, e.cy - e.d - 30, z - 20], [e.cx + e.w + 30, e.cy + e.d + 40, z + 10]);
}

function outdoorProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const z = stage.floorZ;
  add(ctx, disc(Math.max(300, Math.max(e.w, e.d) * 3), z, 6, 128), mat(ctx, PROP_COLOURS.grass, { roughness: 1 }));
  const stone = mat(ctx, PROP_COLOURS.pebble, { roughness: 0.85 });
  // A few pebbles around (deterministic), clear of the product.
  const r0 = Math.max(e.w, e.d) / 2 + 26;
  [0.4, 1.3, 2.2, 3.4, 4.4, 5.5].forEach((a, i) => {
    const r = r0 + (i % 3) * 14;
    const s = 6 + (i % 2) * 4;
    const g = new THREE.SphereGeometry(s, 20, 12);
    g.scale(1.3, 1, 0.55);
    g.translate(e.cx + Math.cos(a) * r, e.cy + Math.sin(a) * r, z + s * 0.3);
    add(ctx, g, stone, ctx.group, { cast: true });
  });
  return box([product.min[0] - 30, product.min[1] - 30, z], [product.max[0] + 30, product.max[1] + 30, z + 10]);
}

function petBowlProps(ctx: Ctx, stage: SceneMetrics, product: Box3): Box3 {
  const e = extentOf(product);
  const z = stage.floorZ;
  floor(ctx, z, Math.max(e.w, e.d) * 1.4, PROP_COLOURS.floor);
  // A bowl beside the feeder (on the reading-end side), with a little food.
  const R = 62;
  const cx = product.max[0] + R + 26;
  const cy = e.cy - e.d * 0.15;
  const bowl = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.01, z),
      new THREE.Vector2(R * 0.7, z),
      new THREE.Vector2(R, z + 32),
      new THREE.Vector2(R + 2, z + 36),
      new THREE.Vector2(R - 4, z + 36),
      new THREE.Vector2(R * 0.68 - 4, z + 6),
      new THREE.Vector2(0.01, z + 6),
    ],
    96,
  );
  bowl.rotateX(Math.PI / 2);
  bowl.translate(cx, cy, 0);
  add(ctx, bowl, mat(ctx, PROP_COLOURS.bowl, { roughness: 0.5 }), ctx.group, { cast: true });
  const kib = mat(ctx, PROP_COLOURS.kibble, { roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    const r = (i % 4) * 9 + 4;
    const g = new THREE.SphereGeometry(4.2, 10, 8);
    g.scale(1.2, 1, 0.7);
    g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + 9 + (i % 3) * 2);
    add(ctx, g, kib);
  }
  return box([product.min[0] - 10, Math.min(product.min[1], cy - R) - 10, z], [cx + R + 6, Math.max(product.max[1], cy + R) + 10, z + 40]);
}

/**
 * The props for a solved product's scene. `stage` = SolvedProduct.stage, `product` =
 * SolvedProduct.bbox (world). Everything is in one group named "scene_props".
 */
export function buildSceneProps(scene: Scene, stage: SceneMetrics, product: Box3): SceneProps {
  const ctx: Ctx = { group: new THREE.Group(), geos: [], mats: [] };
  ctx.group.name = PROPS_NAME;
  let focus: Box3 | null = null;
  switch (scene) {
    case "plant_pot":
      focus = plantPotProps(ctx, stage, product);
      break;
    case "desk":
      focus = deskProps(ctx, stage, product);
      break;
    case "wall":
      focus = wallProps(ctx, stage, product);
      break;
    case "hand":
      focus = handProps(ctx, stage, product);
      break;
    case "floor":
      focus = floorProps(ctx, stage, product);
      break;
    case "car_dash":
      focus = carDashProps(ctx, stage, product);
      break;
    case "outdoor":
      focus = outdoorProps(ctx, stage, product);
      break;
    case "pet_bowl":
      focus = petBowlProps(ctx, stage, product);
      break;
  }
  return {
    group: ctx.group,
    focus,
    dispose() {
      for (const g of ctx.geos) g.dispose();
      for (const m of ctx.mats) m.dispose();
    },
  };
}

/** Fade the props (the viewer does this while the product is taken apart). 1 = solid. */
export function setPropsOpacity(group: THREE.Object3D, opacity: number): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m.userData?.prop) return;
    const base = (m.userData.baseOpacity as number | undefined) ?? (m.transparent ? m.opacity : 1);
    m.userData.baseOpacity = base;
    const target = base * opacity;
    const transparent = target < 0.999 || base < 0.999;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.needsUpdate = true;
    }
    m.opacity = target;
    m.depthWrite = target > 0.6;
    if (mesh.userData.cast === undefined) mesh.userData.cast = mesh.castShadow;
    mesh.castShadow = mesh.userData.cast === true && target > 0.6;
  });
}
