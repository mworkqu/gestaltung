"use client";

// Design Studio 3D viewer. Load it ONLY through ViewerLazy.tsx (next/dynamic,
// ssr:false) so three.js / R3F stay out of every other bundle.
//
// Coordinate choice: all content is authored in mm, Z up. The scene itself is
// standard three.js Y-up (camera.up, OrbitControls, ContactShadows, lights all
// default); the content group is rotated -90° about X, which maps Z-up → Y-up.
// Content (x, y, z) shows at world (x, z, -y).
//
// Rig (world Y-up):
//   turntable group (at the content centre, rotates about world Y)
//     ├─ ContactShadows (rotates with the product, baked once per change)
//     └─ offset group (-centre) → content group (rotation -90° X, Z-up frame)
//          ├─ plate (plate mode) · components · enclosure base/lid · extras
//          └─ ExplodeController (moves studio objects, Z-up maths)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import * as THREE from "three";
import { Canvas, invalidate as invalidateAll, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cn } from "@/lib/utils";
import { getPart } from "@/lib/studio/library";
import { pokeStats, worldBox, type LayoutResult } from "@/lib/studio/layout";
import { buildEnclosure } from "@/lib/studio/enclosure/build";
import { heightLayers, type Vec3 } from "@/lib/studio/explode";
import type { LayoutItem, LibraryPart } from "@/lib/studio/schema";
import { ViewerContext, type ViewerCtx } from "./context";
import { useDocumentHidden, usePrefersReducedMotion } from "./hooks";
import { studioData } from "./materials";
import ComponentMesh from "./ComponentMesh";
import EnclosureMesh from "./EnclosureMesh";
import MechPartMesh from "./MechPartMesh";
import ExplodeController from "./ExplodeController";
import type { ViewerApi, ViewerComponent, ViewerProps } from "./types";

export type { ViewerApi, ViewerProps } from "./types";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
type LightRefs = { key: THREE.DirectionalLight | null; fill: THREE.DirectionalLight | null; rim: THREE.DirectionalLight | null };

const BG = "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)";
const DEFAULT_ACCENT = "#0e59c5";
const TURNTABLE_RAD_S = 0.15;
const RESUME_MS = 4000;
const PLATE_T = 4;
const PLATE_LIFT = 3;
const CONTENT_ROT: [number, number, number] = [-Math.PI / 2, 0, 0];
/** Plate mode: share of the viewer's width / height the plate fills. */
const PLATE_FILL_X = 0.8;
const PLATE_FILL_Y = 0.88;

export default function Viewer(props: ViewerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const hidden = useDocumentHidden();
  const lastInteraction = useRef(0);
  const resumeTimer = useRef<number | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const { onSelect } = props;

  const touch = useCallback(() => {
    lastInteraction.current = performance.now();
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      invalidateAll();
    }, RESUME_MS + 50);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hidden) invalidateAll();
  }, [hidden]);

  return (
    <div
      role="img"
      aria-label={props.ariaLabel}
      className={cn("relative h-full w-full touch-none select-none overflow-hidden", props.className)}
      style={{ background: BG }}
      onPointerDownCapture={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
        touch();
      }}
      onWheelCapture={touch}
    >
      <Canvas
        frameloop={hidden ? "never" : "demand"}
        dpr={[1, 2]}
        shadows
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        camera={{ fov: 35, near: 1, far: 20000, position: [260, 220, 300] }}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
          onSelect?.(null);
        }}
      >
        <Scene {...props} reducedMotion={reducedMotion} hidden={hidden} lastInteraction={lastInteraction} />
      </Canvas>
    </div>
  );
}

type SceneProps = ViewerProps & {
  reducedMotion: boolean;
  hidden: boolean;
  lastInteraction: MutableRefObject<number>;
};

type Placement = { c: ViewerComponent; pos: [number, number, number]; rotZ: number; bobPhase?: number };

function footprint(part: LibraryPart | undefined, rotZ = 0): { w: number; d: number; h: number } {
  const x = part?.dims.x ?? 20;
  const y = part?.dims.y ?? 20;
  const z = part?.dims.z ?? 6;
  const swap = rotZ === 90 || rotZ === 270;
  return { w: swap ? y : x, d: swap ? x : y, h: z };
}

/** Gap between parts on the plate, and the rim around them (mm). */
const PLATE_GAP = 5;
const PLATE_MARGIN = 12;

/**
 * Plate mode: a compact shelf packing (rows centred, small gaps, largest parts first). The shelf
 * width is searched for the smallest circle around the cluster, so the plate hugs the parts
 * (content radius + PLATE_MARGIN) and they read large when the camera fits the plate.
 */
function platePlacements(components: ViewerComponent[], parts: Map<string, LibraryPart>) {
  const n = components.length;
  if (n === 0) return { placements: [] as Placement[], radius: 60 };
  const items = components
    .map((c, i) => ({ c, i, ...footprint(parts.get(c.instanceId)) }))
    .sort((a, b) => b.w * b.d - a.w * a.d || a.i - b.i);
  const maxW = Math.max(...items.map((it) => it.w));
  const sumW = items.reduce((t, it) => t + it.w, 0) + PLATE_GAP * (n - 1);

  const pack = (target: number) => {
    const rows: (typeof items)[] = [];
    let cur: typeof items = [];
    let curW = 0;
    for (const it of items) {
      const next = cur.length ? curW + PLATE_GAP + it.w : it.w;
      if (cur.length && next > target + 1e-9) {
        rows.push(cur);
        cur = [it];
        curW = it.w;
      } else {
        cur.push(it);
        curW = next;
      }
    }
    if (cur.length) rows.push(cur);
    const rowW = rows.map((r) => r.reduce((t, it) => t + it.w, 0) + PLATE_GAP * (r.length - 1));
    const rowD = rows.map((r) => Math.max(...r.map((it) => it.d)));
    const totalD = rowD.reduce((t, d) => t + d, 0) + PLATE_GAP * (rows.length - 1);
    const out: { it: (typeof items)[number]; x: number; y: number }[] = [];
    let y = totalD / 2;
    rows.forEach((r, ri) => {
      let x = -rowW[ri] / 2;
      for (const it of r) {
        out.push({ it, x: x + it.w / 2, y: y - rowD[ri] / 2 });
        x += it.w + PLATE_GAP;
      }
      y -= rowD[ri] + PLATE_GAP;
    });
    // Radius of the circle (about the origin) that holds every corner.
    let radius = 0;
    for (const o of out) radius = Math.max(radius, Math.hypot(Math.abs(o.x) + o.it.w / 2, Math.abs(o.y) + o.it.d / 2));
    return { out, radius };
  };

  let best = pack(maxW);
  for (let k = 1; k <= 24; k++) {
    const cand = pack(maxW + ((sumW - maxW) * k) / 24);
    if (cand.radius < best.radius - 1e-6) best = cand;
  }
  const placements: Placement[] = best.out.map(({ it, x, y }) => ({
    c: it.c,
    pos: [x, y, PLATE_LIFT],
    rotZ: 0,
    bobPhase: it.i * 1.7,
  }));
  return { placements, radius: Math.max(30, best.radius) + PLATE_MARGIN };
}

/** LayoutResult for the caller's layout (bbox from the same worldBox the layout engine uses). */
function layoutResultFrom(layout: LayoutItem[], parts: Map<string, LibraryPart>): LayoutResult {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const item of layout) {
    const part = parts.get(item.instanceId);
    if (!part) continue;
    const b = worldBox(item, part);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  if (!Number.isFinite(min[0])) {
    return { layout, bbox: { min: [0, 0, 0], max: [0, 0, 0] }, footprint: { w: 0, d: 0 }, height: 0 };
  }
  return {
    layout,
    bbox: { min, max },
    footprint: { w: max[0] - min[0], d: max[1] - min[1] },
    height: max[2] - Math.min(0, min[2]),
    ...pokeStats(layout, parts),
  };
}

function Scene(p: SceneProps) {
  const { components, layout, enclosure, extraObjects, reducedMotion, hidden } = p;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);

  // --- environment (RoomEnvironment → PMREM, no network) -------------------
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.55;
    invalidate();
    return () => {
      if (scene.environment === rt.texture) scene.environment = null;
      rt.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  // --- parts + placements ----------------------------------------------------
  const compKey = components.map((c) => `${c.instanceId}:${c.partId}`).join("|");
  const parts = useMemo(() => {
    const m = new Map<string, LibraryPart>();
    for (const c of components) {
      const part = getPart(c.partId);
      if (part) m.set(c.instanceId, part);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compKey]);

  const layoutKey = layout ? JSON.stringify(layout) : "";
  const plate = !layout;

  // --- enclosure geometry (rebuilt only when the shape changes) -------------
  const encShapeKey = enclosure
    ? JSON.stringify({ ...enclosure, finish: undefined, colour: undefined, accentColour: undefined })
    : "";
  const enc = useMemo(() => {
    if (!enclosure || !layout || parts.size === 0) return null;
    try {
      return buildEnclosure(enclosure, layoutResultFrom(layout, parts), parts);
    } catch (err) {
      console.warn("[studio viewer] enclosure build failed", err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encShapeKey, layoutKey, parts]);

  useEffect(() => {
    return () => {
      enc?.base.geometry.dispose();
      enc?.lid.geometry.dispose();
    };
  }, [enc]);

  // With a case, parts stand where the case was cut for (poke-through sensors lifted to the lid).
  const shown = enc?.meta.layout ?? layout;
  const shownKey = shown ? JSON.stringify(shown) : "";

  const { placements, plateRadius, centre, height } = useMemo(() => {
    if (!shown) {
      const r = platePlacements(components, parts);
      const h = Math.max(10, ...r.placements.map((pl) => footprint(parts.get(pl.c.instanceId)).h + PLATE_LIFT));
      return { placements: r.placements, plateRadius: r.radius, centre: [0, 0, 0] as Vec3, height: h };
    }
    const byId = new Map<string, LayoutItem>(shown.map((l) => [l.instanceId, l]));
    // Parts without a layout entry (helpers such as resistors) are not shown physically.
    const pls: Placement[] = components.flatMap((c) => {
      const l = byId.get(c.instanceId);
      return l ? [{ c, pos: [l.pos[0], l.pos[1], l.pos[2]] as [number, number, number], rotZ: l.rotZ }] : [];
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pl of pls) {
      const f = footprint(parts.get(pl.c.instanceId), pl.rotZ);
      minX = Math.min(minX, pl.pos[0] - f.w / 2);
      maxX = Math.max(maxX, pl.pos[0] + f.w / 2);
      minY = Math.min(minY, pl.pos[1] - f.d / 2);
      maxY = Math.max(maxY, pl.pos[1] + f.d / 2);
      minZ = Math.min(minZ, pl.pos[2]);
      maxZ = Math.max(maxZ, pl.pos[2] + f.h);
    }
    const empty = pls.length === 0;
    return {
      placements: pls,
      plateRadius: 0,
      centre: (empty ? [0, 0, 0] : [(minX + maxX) / 2, (minY + maxY) / 2, 0]) as Vec3,
      height: empty ? 20 : Math.max(10, maxZ - Math.min(0, minZ)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compKey, shownKey, parts]);

  const layers = useMemo(() => heightLayers(placements.map((pl) => pl.pos[2])), [placements]);

  const H = enc?.meta.H ?? height;

  // --- refs, dirty flag, context ---------------------------------------------
  const contentRef = useRef<THREE.Group>(null);
  const turntableRef = useRef<THREE.Group>(null);
  const dirty = useRef(true);
  const markDirty = useCallback(() => {
    dirty.current = true;
    invalidate();
  }, [invalidate]);

  const accentHex = p.accent ?? DEFAULT_ACCENT;
  const accent = useMemo(() => new THREE.Color(accentHex), [accentHex]);
  const ctx = useMemo<ViewerCtx>(
    () => ({
      selected: p.selected ?? null,
      onSelect: (id) => p.onSelect?.(id),
      accent,
      reducedMotion,
      markDirty,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.selected, p.onSelect, accent, reducedMotion, markDirty],
  );

  // --- contact shadows re-bake key -------------------------------------------
  const [settled, setSettled] = useState(0);
  const onSettled = useCallback(() => {
    setSettled((v) => v + 1);
  }, []);
  const extrasKey = (extraObjects ?? []).map((e) => `${e.name}:${e.object.uuid}`).join("|");
  const contentKey = `${compKey}#${layoutKey}#${encShapeKey}#${extrasKey}`;
  const explodeTarget = plate ? 0 : Math.min(1, Math.max(0, p.explode ?? 0));

  // --- api -------------------------------------------------------------------
  const { onReady } = p;
  useEffect(() => {
    if (!onReady) return;
    const api: ViewerApi = {
      getObjects() {
        const out: THREE.Object3D[] = [];
        contentRef.current?.traverse((o) => {
          if (studioData(o)) out.push(o);
        });
        return out;
      },
      toPNG() {
        gl.render(scene, camera);
        return new Promise<Blob>((resolve, reject) => {
          gl.domElement.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error("toPNG: canvas is empty"));
          }, "image/png");
        });
      },
    };
    onReady(api);
  }, [onReady, gl, scene, camera]);

  // --- turntable ---------------------------------------------------------------
  const spin = (p.autoRotate ?? true) && !reducedMotion && !hidden;
  useEffect(() => {
    if (spin) invalidate();
    else if (turntableRef.current && reducedMotion) {
      turntableRef.current.rotation.y = 0;
      invalidate();
    }
  }, [spin, reducedMotion, invalidate]);
  useFrame((_, dt) => {
    if (!spin || !turntableRef.current) return;
    if (performance.now() - p.lastInteraction.current < RESUME_MS) return;
    turntableRef.current.rotation.y += Math.min(dt, 0.05) * TURNTABLE_RAD_S;
    invalidate();
  });

  // Z-up centre → world Y-up position of the turntable axis.
  const tPos = useMemo<[number, number, number]>(() => [centre[0], 0, -centre[1]], [centre]);
  const oPos = useMemo<[number, number, number]>(() => [-centre[0], 0, centre[1]], [centre]);
  const floorY = plate ? -PLATE_T - 0.2 : -0.2;

  const [radius, setRadius] = useState(100);
  const lights = useRef<LightRefs>({ key: null, fill: null, rim: null });
  const shadowKey = `${contentKey}#${settled}#${p.xray ? 1 : 0}#${Math.round(radius)}`;

  return (
    <ViewerContext.Provider value={ctx}>
      <Lights lights={lights} />
      <group ref={turntableRef} position={tPos}>
        <ContactShadows
          key={shadowKey}
          frames={1}
          position={[0, floorY, 0]}
          scale={Math.max(80, radius * 3)}
          far={Math.max(20, radius * 1.5)}
          blur={2.4}
          opacity={0.45}
          resolution={512}
          color="#1c2434"
        />
        <group position={oPos}>
          <group ref={contentRef} rotation={CONTENT_ROT}>
            {plate && <Plate radius={plateRadius} accent={accentHex} />}
            {placements.map((pl, i) => (
              <ComponentMesh
                key={pl.c.instanceId}
                instanceId={pl.c.instanceId}
                partId={pl.c.partId}
                rest={pl.pos}
                rotZ={pl.rotZ}
                layer={layers[i] ?? 0}
                bobPhase={plate ? pl.bobPhase : undefined}
              />
            ))}
            {enc && enclosure && (
              <EnclosureMesh
                base={enc.base}
                lid={enc.lid}
                finish={enclosure.finish}
                colour={enclosure.colour}
                accentColour={enclosure.accentColour}
                xray={!!p.xray}
              />
            )}
            {(extraObjects ?? []).map((e) => (
              <MechPartMesh key={e.object.uuid} name={e.name} object={e.object} explode={e.explode} />
            ))}
            <ExplodeController
              root={contentRef}
              target={explodeTarget}
              centre={centre}
              H={H}
              reducedMotion={reducedMotion}
              dirty={dirty}
              onSettled={onSettled}
            />
          </group>
        </group>
      </group>
      <CameraRig
        contentRef={contentRef}
        lights={lights}
        fitKey={`${contentKey}#${explodeTarget > 0.05 ? 1 : 0}#${Math.round(plateRadius)}`}
        plateRadius={plate ? plateRadius : 0}
        plateTop={height}
        grow={1 + 0.6 * explodeTarget}
        reducedMotion={reducedMotion}
        onRadius={setRadius}
      />
    </ViewerContext.Provider>
  );
}

// --- lights ----------------------------------------------------------------------

const KEY_DIR = new THREE.Vector3(0.6, 1.1, 0.75).normalize();
const FILL_DIR = new THREE.Vector3(-0.9, 0.45, 0.4).normalize();
const RIM_DIR = new THREE.Vector3(-0.2, 0.7, -1).normalize();

function Lights({ lights }: { lights: MutableRefObject<LightRefs> }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const k = key.current;
    if (k) {
      k.shadow.mapSize.set(1024, 1024);
      k.shadow.bias = -0.0004;
      k.shadow.normalBias = 0.6;
      k.shadow.radius = 4;
    }
    lights.current = { key: key.current, fill: fill.current, rim: rim.current };
    return () => {
      lights.current = { key: null, fill: null, rim: null };
    };
  }, [lights]);
  return (
    <>
      <hemisphereLight args={["#ffffff", "#c9d3df", 0.35]} />
      <directionalLight ref={key} castShadow intensity={1.6} color="#ffffff" />
      <directionalLight ref={fill} intensity={0.45} color="#eef2f7" />
      <directionalLight ref={rim} intensity={0.7} color="#ffffff" />
    </>
  );
}

function placeLights(L: LightRefs, centre: THREE.Vector3, r: number) {
  const place = (l: THREE.DirectionalLight | null, dir: THREE.Vector3) => {
    if (!l) return;
    l.position.copy(centre).addScaledVector(dir, r * 4);
    l.target.position.copy(centre);
    l.target.updateMatrixWorld();
  };
  place(L.key, KEY_DIR);
  place(L.fill, FILL_DIR);
  place(L.rim, RIM_DIR);
  if (L.key) {
    const cam = L.key.shadow.camera;
    const s = r * 1.4;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = Math.max(0.5, r * 0.5);
    cam.far = r * 8;
    cam.updateProjectionMatrix();
    L.key.shadow.needsUpdate = true;
  }
}

// --- camera auto-fit -----------------------------------------------------------------

function CameraRig({
  contentRef,
  lights,
  fitKey,
  grow,
  plateRadius,
  plateTop,
  reducedMotion,
  onRadius,
}: {
  contentRef: RefObject<THREE.Group | null>;
  lights: MutableRefObject<LightRefs>;
  fitKey: string;
  grow: number;
  /** Plate mode: the plate's radius (mm), else 0. The camera frames the plate itself. */
  plateRadius: number;
  /** Plate mode: height of the tallest part above the plate (mm). */
  plateTop: number;
  reducedMotion: boolean;
  onRadius(r: number): void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const first = useRef(true);
  const growRef = useRef(grow);
  growRef.current = grow;
  const plateRef = useRef({ radius: plateRadius, top: plateTop });
  plateRef.current = { radius: plateRadius, top: plateTop };

  useEffect(() => {
    // Wait one frame so children have applied their rest poses.
    const id = requestAnimationFrame(() => {
      const g = contentRef.current;
      const c = controls.current;
      if (!g || !c) return;
      g.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) box.set(new THREE.Vector3(-40, -10, -40), new THREE.Vector3(40, 30, 40));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const r = Math.max(15, sphere.radius) * growRef.current;
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const aspect = Math.max(0.5, camera.aspect || 1);
      const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
      const dist = (r / Math.sin(fit / 2)) * 1.08;

      const plate = plateRef.current;
      // Plate: a slightly raised 3/4 view (~37° up); everything else keeps the lower default.
      const home = plate.radius > 0 ? new THREE.Vector3(0.5, 0.9, 1) : new THREE.Vector3(0.75, 0.62, 1);
      const dir = first.current ? home.clone().normalize() : camera.position.clone().sub(c.target).normalize();
      if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(home).normalize();

      let fitDist = dist;
      if (plate.radius > 0) {
        // Frame the plate's real outline (not its bounding sphere): it fills ~80 % of the width.
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          for (const [rr, z] of [[1, 0], [1, -PLATE_T], [0.7, plate.top]] as const) {
            pts.push(g.localToWorld(new THREE.Vector3(Math.cos(a) * plate.radius * rr, Math.sin(a) * plate.radius * rr, z)));
          }
        }
        const centre = sphere.center;
        const pos0 = camera.position.clone();
        const quat0 = camera.quaternion.clone();
        for (let it = 0; it < 8; it++) {
          camera.position.copy(centre).addScaledVector(dir, fitDist);
          camera.lookAt(centre);
          camera.updateMatrixWorld();
          let mx = 0;
          let my = 0;
          for (const p of pts) {
            const v = p.clone().project(camera);
            mx = Math.max(mx, Math.abs(v.x));
            my = Math.max(my, Math.abs(v.y));
          }
          const k = Math.max(mx / PLATE_FILL_X, my / PLATE_FILL_Y);
          if (Math.abs(k - 1) < 0.01) break;
          fitDist *= k;
        }
        camera.position.copy(pos0);
        camera.quaternion.copy(quat0);
      }

      camera.near = Math.max(0.5, r / 50);
      camera.far = r * 60;
      camera.updateProjectionMatrix();
      c.minDistance = r * 1.1;
      c.maxDistance = r * 6;

      goal.current = { pos: sphere.center.clone().addScaledVector(dir, fitDist), target: sphere.center.clone() };
      if (first.current || reducedMotion) {
        camera.position.copy(goal.current.pos);
        c.target.copy(goal.current.target);
        c.update();
        goal.current = null;
      }
      first.current = false;
      placeLights(lights.current, sphere.center, r);
      onRadius(r);
      invalidate();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [fitKey, camera, reducedMotion, invalidate, contentRef, lights, onRadius]);

  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.1));
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && c.target.distanceTo(g.target) < 0.05) goal.current = null;
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      screenSpacePanning
      maxPolarAngle={Math.PI * 0.495}
      onStart={() => {
        goal.current = null; // the user takes over the camera
      }}
    />
  );
}

// --- plate (plate mode) ----------------------------------------------------------------

function Plate({ radius, accent }: { radius: number; accent: string }) {
  const res = useMemo(() => {
    const plateGeo = new THREE.CylinderGeometry(radius, radius, PLATE_T, 96);
    plateGeo.rotateX(Math.PI / 2); // axis Y → Z (content frame)
    plateGeo.translate(0, 0, -PLATE_T / 2);
    const rimGeo = new THREE.TorusGeometry(radius, 0.9, 12, 128);
    const plateMat = new THREE.MeshStandardMaterial({ color: "#f4f7fb", roughness: 0.55, metalness: 0 });
    const rimMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.1 });
    return { plateGeo, rimGeo, plateMat, rimMat };
  }, [radius, accent]);
  useEffect(() => {
    return () => {
      res.plateGeo.dispose();
      res.rimGeo.dispose();
      res.plateMat.dispose();
      res.rimMat.dispose();
    };
  }, [res]);
  return (
    <group>
      <mesh geometry={res.plateGeo} material={res.plateMat} receiveShadow />
      <mesh geometry={res.rimGeo} material={res.rimMat} position={[0, 0, 0.2]} />
    </group>
  );
}
