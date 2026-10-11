"use client";

// Wiring views (P5-17) — the 3D tab: the library's 3D parts on a mat with real
// wires on them, from the exact pin to the exact pin.
//
// Loaded ONLY through next/dynamic in WiringViews.tsx (three.js + R3F stay out
// of the Studio's first load). Same lighting and finishes as the Studio viewer
// (Viewer.tsx): ACES, RoomEnvironment, hemisphere + key/fill/rim lights, dimmer
// reflections on bare PCBs. LeanCanvas (not R3F's Canvas); everything new in
// the scene is built imperatively and shown through <primitive>.
//
// Data: lib/studio/wiring3d/* (pins3d → layout → wires, pure + tested); the
// Connection[] and the selection come from views-context.tsx. LeanCanvas has no
// context bridge, so the scene gets everything as props.
//
// Wires: TubeGeometry (48 × 8) along a centripetal Catmull-Rom spline through
// the points from wires.ts; an invisible fatter tube takes the taps. Hover (a
// mouse) or tap a wire → it glows and thickens, the rest dim. Build guide: the
// wires before the current one show normally, the current one draws in over
// 0.6 s (drawRange; shown at once under reduced motion), later ones are hidden.
// "Take it apart" lifts every part but the board; the wires stretch to follow.
// Parts can be dragged on the mat (P5-17d): pointer down on a part body -> it
// slides in the mat plane under the pointer (OrbitControls off meanwhile), only
// its own wires are rebuilt per move, it never overlaps another part; the spot
// is kept per session (sessionStorage, page + parts list) and "Reset layout"
// brings the auto layout back. A tap without movement still works as before.
// frameloop "demand": a frame only on camera moves, drags, hover/selection and
// the short animations.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Layers, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { WIRE_HEX, partName, type Connection, type WireColour } from "@/lib/studio/connections";
import { buildPartModel } from "@/lib/studio/models";
import type { GetPart, Locale } from "@/lib/studio/netlist";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { LibraryPart, Net, StudioDoc } from "@/lib/studio/schema";
import {
  apartLift,
  applyMoves,
  BREADBOARD_H,
  layoutMat,
  movePart,
  resolveMove,
  type MatLayout,
  type MatMoves,
  type Placement,
} from "@/lib/studio/wiring3d/layout";
import { buildWires, touchesPart, type WireSegment } from "@/lib/studio/wiring3d/wires";
import { cn } from "@/lib/utils";
import { LeanCanvas } from "../../viewer/LeanCanvas";
import { useDocumentHidden, usePrefersReducedMotion } from "../../viewer/hooks";
import { cloneMaterials, dimPcbEnvironment, disposeObject } from "../../viewer/materials";
import { useWiringViews } from "./views-context";

const accent = STEP_ACCENT.wiring;
const BG = "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)";
const EXPOSURE = 0.92;
const ENV_INTENSITY = 0.6;
const PCB_ENV_INTENSITY = 0.38;
const CONTENT_ROT: [number, number, number] = [-Math.PI / 2, 0, 0];
const MAT_MARGIN = 10;
const MAT_T = 3;
/** Wire radius (mm): normal / highlighted. */
const R_WIRE = 0.85;
const R_GLOW = 1.35;
const R_HIT = 3.2;
const TUBE_SEG = 48;
const TUBE_RAD = 8;
const DRAW_MS = 600;
const APART_MS = 500;
/** Pointer travel (px) before a press on a part becomes a drag. */
const DRAG_SLOP = 4;
const MOVES_KEY = "gestaltung:studio:wiring3d-moves";

function movesKey(compKey: string): string {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  return `${MOVES_KEY}:${path}:${compKey}`;
}

function loadMoves(key: string): MatMoves {
  try {
    const raw = window.sessionStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: MatMoves = {};
    for (const [id, xy] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(xy) && xy.length === 2 && xy.every((n) => typeof n === "number" && Number.isFinite(n))) out[id] = [xy[0], xy[1]];
    }
    return out;
  } catch {
    return {};
  }
}

function saveMoves(key: string, moves: MatMoves) {
  try {
    if (Object.keys(moves).length) window.sessionStorage.setItem(key, JSON.stringify(moves));
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

// ── WebGL check + error boundary (2D fallback message) ─────────────────────

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[studio wiring 3d] scene failed", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── The view ───────────────────────────────────────────────────────────────

export function Wiring3DView({ doc, locale }: { doc: StudioDoc; locale: Locale }) {
  const t = useTranslations("Studio.views.three");
  const { connections, byId, activeId, select, setHover, guide, engineer, getPart } = useWiringViews();
  const reducedMotion = usePrefersReducedMotion();
  const hidden = useDocumentHidden();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [apart, setApart] = useState(false);
  const labelA = useRef<HTMLDivElement>(null);
  const labelB = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setWebgl(hasWebGL());
  }, []);

  const compKey = doc.components.map((c) => `${c.instanceId}:${c.partId}`).join("|");
  const items = useMemo(
    () =>
      doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ instanceId: c.instanceId, part }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the parts list
    [compKey, getPart],
  );
  const auto = useMemo(() => layoutMat(items, connections), [items, connections]);
  // Parts the client moved by hand (per session, per page + parts list).
  const storeKey = useMemo(() => movesKey(compKey), [compKey]);
  const [moves, setMoves] = useState<{ key: string; moves: MatMoves }>(() => ({ key: storeKey, moves: loadMoves(storeKey) }));
  const current = moves.key === storeKey ? moves.moves : null;
  useEffect(() => {
    if (moves.key !== storeKey) setMoves({ key: storeKey, moves: loadMoves(storeKey) });
  }, [moves.key, storeKey]);
  const layout = useMemo(() => applyMoves(auto, current ?? {}), [auto, current]);
  const moved = !!current && Object.keys(current).length > 0;
  const [fitNonce, setFitNonce] = useState(0);
  const onMovePart = useCallback(
    (id: string, xy: [number, number]) => {
      setMoves((m) => {
        const next = { ...(m.key === storeKey ? m.moves : {}), [id]: xy };
        saveMoves(storeKey, next);
        return { key: storeKey, moves: next };
      });
    },
    [storeKey],
  );
  const resetLayout = () => {
    saveMoves(storeKey, {});
    setMoves({ key: storeKey, moves: {} });
    setFitNonce((n) => n + 1);
  };

  const active = activeId ? byId.get(activeId) : undefined;
  const label = (end: Connection["from"]) => {
    const name = partName(getPart(end.partId), locale, end.part);
    return `${name} ${end.label}`;
  };

  const fallback = (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm font-semibold text-body" dir={locale === "ar" ? "rtl" : "ltr"}>
      {t("noWebgl")}
    </div>
  );

  return (
    <div className="space-y-2" data-testid="studio-wiring-3d">
      <div
        dir="ltr"
        className="relative h-[min(75dvh,620px)] w-full touch-none select-none overflow-hidden rounded-[20px] shadow-neu-inset md:h-[min(82dvh,820px)]"
        style={{ background: BG }}
        onPointerDownCapture={(e) => {
          down.current = { x: e.clientX, y: e.clientY };
        }}
      >
        {webgl === false ? (
          fallback
        ) : webgl ? (
          <div role="img" aria-label={t("canvasLabel")} className="h-full w-full">
            <CanvasBoundary fallback={fallback}>
              <LeanCanvas
                frameloop={hidden ? "never" : "demand"}
                dpr={[1, 2]}
                shadows
                gl={{ antialias: true, alpha: true }}
                camera={{ fov: 35, near: 1, far: 20000, position: [120, 260, 220] }}
                onCreated={({ gl }) => {
                  gl.toneMapping = THREE.ACESFilmicToneMapping;
                  gl.toneMappingExposure = EXPOSURE;
                  gl.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
                }}
                onPointerMissed={(e) => {
                  const d = down.current;
                  if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
                  select(null);
                }}
              >
                <Scene
                  layout={layout}
                  items={items}
                  connections={connections}
                  nets={doc.netlist.nets}
                  getPart={getPart}
                  activeId={activeId}
                  guide={guide}
                  apart={apart}
                  reducedMotion={reducedMotion}
                  fitKey={`${auto.placements.map((q) => `${q.instanceId}@${q.pos.join(",")}`).join("|")}#${fitNonce}`}
                  onMovePart={onMovePart}
                  onHover={setHover}
                  onSelect={select}
                  labelA={labelA}
                  labelB={labelB}
                />
              </LeanCanvas>
            </CanvasBoundary>
          </div>
        ) : null}

        {active && webgl && (
          <>
            <EndLabel refEl={labelA} colour={active.wireColour} text={label(active.from)} locale={locale} />
            <EndLabel
              refEl={labelB}
              colour={active.wireColour}
              text={engineer ? `${label(active.to)} · ${active.id}` : label(active.to)}
              locale={locale}
            />
          </>
        )}

        {webgl && (
          <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-2" dir={locale === "ar" ? "rtl" : "ltr"}>
            {moved && (
              <button
                type="button"
                onClick={resetLayout}
                data-testid="studio-wiring-3d-reset"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-panel px-4 text-sm font-semibold text-heading shadow-neu-sm transition-colors hover:bg-white"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {t("reset")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setApart((v) => !v)}
              aria-pressed={apart}
              data-testid="studio-wiring-3d-apart"
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors",
                apart ? "text-white" : "bg-panel text-heading shadow-neu-sm hover:bg-white",
              )}
              style={apart ? { background: accent.ink } : undefined}
            >
              <Layers className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {apart ? t("together") : t("apart")}
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-mutedtext">
        {t("hint")} {t("dragHint")}
      </p>
    </div>
  );
}

function EndLabel({ refEl, colour, text, locale }: { refEl: RefObject<HTMLDivElement | null>; colour: WireColour; text: string; locale: Locale }) {
  return (
    <div
      ref={refEl}
      aria-hidden
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-heading shadow-neu-sm"
      style={{ opacity: 0, borderInlineStart: `5px solid ${WIRE_HEX[colour]}`, willChange: "transform" }}
    >
      {text}
    </div>
  );
}

// ── Shared materials ───────────────────────────────────────────────────────

type WireLook = "normal" | "glow" | "dim" | "ghost";
const wireMats = new Map<string, THREE.MeshStandardMaterial>();
function wireMaterial(colour: WireColour, look: WireLook): THREE.MeshStandardMaterial {
  const key = `${colour}:${look}`;
  let m = wireMats.get(key);
  if (!m) {
    const c = new THREE.Color(WIRE_HEX[colour]);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0 });
    if (look === "glow") {
      m.emissive = c.clone().lerp(new THREE.Color("#ffffff"), colour === "black" ? 0.45 : 0.15);
      m.emissiveIntensity = 0.55;
    } else if (look === "dim" || look === "ghost") {
      m.transparent = true;
      m.opacity = look === "dim" ? 0.2 : 0.07;
      m.depthWrite = false;
    }
    wireMats.set(key, m);
  }
  return m;
}
let hitMat: THREE.MeshBasicMaterial | null = null;
const hitMaterial = () => (hitMat ??= new THREE.MeshBasicMaterial({ visible: false }));
const noRaycast: THREE.Mesh["raycast"] = () => undefined;

// ── Scene ──────────────────────────────────────────────────────────────────

type SceneProps = {
  layout: MatLayout;
  items: { instanceId: string; part: LibraryPart }[];
  connections: Connection[];
  nets: Net[];
  getPart: GetPart;
  activeId: string | null;
  guide: number | null;
  apart: boolean;
  reducedMotion: boolean;
  /** Camera refit key: the auto layout + Reset count (a hand move never refits). */
  fitKey: string;
  /** A part was dragged to (x, y) on the mat (already clear of the others). */
  onMovePart: (id: string, xy: [number, number]) => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  labelA: RefObject<HTMLDivElement | null>;
  labelB: RefObject<HTMLDivElement | null>;
};

type WireMesh = { seg: WireSegment; mesh: THREE.Mesh<THREE.TubeGeometry>; hit: THREE.Mesh<THREE.TubeGeometry> };

function Scene(p: SceneProps) {
  const { layout, items, connections, nets, getPart, activeId, guide, apart, reducedMotion } = p;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  const contentRef = useRef<THREE.Group>(null);
  // The layout as drawn right now: the committed one, plus the part being dragged.
  const live = useRef(layout);
  const liveSrc = useRef(layout);

  // Environment: the viewer's RoomEnvironment reflections.
  const [envTex, setEnvTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = ENV_INTENSITY;
    setEnvTex(rt.texture);
    invalidate();
    return () => {
      setEnvTex(null);
      if (scene.environment === rt.texture) scene.environment = null;
      rt.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  // ── Parts (one model per instance, materials cloned like the viewer) ──
  const partOf = useMemo(() => new Map(items.map((i) => [i.instanceId, i.part])), [items]);
  const models = useMemo(() => {
    const m = new Map<string, THREE.Group>();
    for (const [instanceId, part] of partOf) {
      let g: THREE.Group;
      try {
        g = buildPartModel(part);
      } catch (err) {
        console.warn("[studio wiring 3d] model build failed", part.id, err);
        continue;
      }
      cloneMaterials(g);
      m.set(instanceId, g);
    }
    return m;
  }, [partOf]);
  useEffect(
    () => () => {
      for (const g of models.values()) disposeObject(g);
    },
    [models],
  );
  useEffect(() => {
    if (!envTex) return;
    for (const g of models.values()) dimPcbEnvironment(g, envTex, PCB_ENV_INTENSITY);
    invalidate();
  }, [models, envTex, invalidate]);

  // ── Take it apart (0 → 1 over APART_MS, at once under reduced motion) ──
  const lifts = useMemo(() => apartLift(layout), [layout]);
  const tRef = useRef(apart ? 1 : 0);
  const anim = useRef<{ from: number; to: number; start: number } | null>(null);
  useEffect(() => {
    const to = apart ? 1 : 0;
    if (reducedMotion) {
      tRef.current = to;
      anim.current = null;
    } else anim.current = { from: tRef.current, to, start: performance.now() };
    invalidate();
  }, [apart, reducedMotion, invalidate]);

  const groupRefs = useRef(new Map<string, THREE.Group>());
  const placeGroups = useCallback(
    (tt: number) => {
      for (const pl of live.current.placements) {
        const g = groupRefs.current.get(pl.instanceId);
        if (g) g.position.set(pl.pos[0], pl.pos[1], (lifts.get(pl.instanceId) ?? 0) * tt);
      }
    },
    [lifts],
  );

  // ── Wires ──
  const wireGroup = useMemo(() => new THREE.Group(), []);
  const wires = useRef<WireMesh[]>([]);
  const indexOf = useMemo(() => new Map(connections.map((c, i) => [c.id, i])), [connections]);
  const look = useCallback(
    (id: string): WireLook => {
      const i = indexOf.get(id) ?? 0;
      if (guide !== null) {
        // Build guide: wires already laid look normal, the current one glows, later ones are faint.
        if (i > guide) return "ghost";
        if (id === activeId) return "glow";
        return activeId === connections[guide]?.id ? "normal" : "dim";
      }
      if (activeId) return id === activeId ? "glow" : "dim";
      return "normal";
    },
    [indexOf, guide, activeId, connections],
  );

  const makeWire = useCallback(
    (seg: WireSegment): WireMesh => {
      const curve = new THREE.CatmullRomCurve3(
        seg.points.map((q) => new THREE.Vector3(q[0], q[1], q[2])),
        false,
        "centripetal",
      );
      const l = look(seg.id);
      const r = l === "glow" ? R_GLOW : R_WIRE;
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, TUBE_SEG, r, TUBE_RAD, false), wireMaterial(seg.colour, l));
      mesh.castShadow = l === "normal" || l === "glow";
      mesh.raycast = noRaycast;
      mesh.renderOrder = l === "glow" ? 2 : l === "normal" ? 1 : 0;
      const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, R_HIT, 6, false), hitMaterial());
      hit.userData.connectionId = seg.id;
      if (l === "ghost") hit.raycast = noRaycast;
      wireGroup.add(mesh, hit);
      return { seg, mesh, hit };
    },
    [wireGroup, look],
  );

  const rebuildWires = useCallback(
    (tt: number) => {
      for (const w of wires.current) {
        w.mesh.geometry.dispose();
        w.hit.geometry.dispose();
      }
      wireGroup.clear();
      const segs = buildWires({
        connections,
        layout: live.current,
        getPart,
        nets,
        lift: (id) => (lifts.get(id) ?? 0) * tt,
      });
      wires.current = segs.map(makeWire);
    },
    [wireGroup, connections, getPart, nets, lifts, makeWire],
  );

  // A dragged part: rebuild only the wires that touch it.
  const connById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const rebuildFor = useCallback(
    (instanceId: string, tt: number) => {
      const keep: WireMesh[] = [];
      for (const w of wires.current) {
        const c = connById.get(w.seg.id);
        if (c && touchesPart(c, instanceId)) {
          w.mesh.geometry.dispose();
          w.hit.geometry.dispose();
          wireGroup.remove(w.mesh, w.hit);
        } else keep.push(w);
      }
      const segs = buildWires({
        connections,
        layout: live.current,
        getPart,
        nets,
        lift: (id) => (lifts.get(id) ?? 0) * tt,
        only: (c) => touchesPart(c, instanceId),
      });
      wires.current = [...keep, ...segs.map(makeWire)];
    },
    [connById, wireGroup, connections, getPart, nets, lifts, makeWire],
  );

  useEffect(() => {
    // A new committed layout replaces the live one (a hover or look change mid-drag does not).
    if (liveSrc.current !== layout) {
      liveSrc.current = layout;
      live.current = layout;
    }
    rebuildWires(tRef.current);
    placeGroups(tRef.current);
    invalidate();
  }, [layout, rebuildWires, placeGroups, invalidate]);
  useEffect(
    () => () => {
      for (const w of wires.current) {
        w.mesh.geometry.dispose();
        w.hit.geometry.dispose();
      }
      wires.current = [];
    },
    [],
  );

  // ── Build guide: the current wire draws in ──
  const guideId = guide !== null ? connections[guide]?.id ?? null : null;
  const draw = useRef<{ id: string; start: number } | null>(null);
  useEffect(() => {
    draw.current = guideId && !reducedMotion ? { id: guideId, start: performance.now() } : null;
    invalidate();
  }, [guideId, reducedMotion, invalidate]);

  const applyDraw = useCallback(() => {
    const d = draw.current;
    for (const w of wires.current) {
      const idx = w.mesh.geometry.index;
      if (!idx) continue;
      let prog = 1;
      if (d && w.seg.id === d.id) {
        const pAll = Math.min(1, (performance.now() - d.start) / DRAW_MS);
        const twoParts = wires.current.filter((x) => x.seg.id === d.id).length > 1;
        prog = twoParts ? Math.min(1, Math.max(0, pAll * 2 - w.seg.part)) : pAll;
      }
      const tris = Math.floor((idx.count / 3) * prog);
      w.mesh.geometry.setDrawRange(0, tris * 3);
    }
    if (d && performance.now() - d.start >= DRAW_MS) draw.current = null;
  }, []);

  // ── Per frame: animations + end labels ──
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const a = anim.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.start) / APART_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      tRef.current = a.from + (a.to - a.from) * e;
      placeGroups(tRef.current);
      rebuildWires(tRef.current);
      if (k >= 1) anim.current = null;
      invalidate();
    }
    if (draw.current) invalidate();
    applyDraw();

    // Labels at both ends of the highlighted wire.
    const g = contentRef.current;
    const els = [p.labelA.current, p.labelB.current];
    const segs = activeId ? wires.current.filter((w) => w.seg.id === activeId) : [];
    if (!g || !segs.length) {
      for (const el of els) if (el) el.style.opacity = "0";
      return;
    }
    const ends = [segs[0].seg.points[0], segs[segs.length - 1].seg.points[segs[segs.length - 1].seg.points.length - 1]];
    const at = ends.map((q) => {
      v.set(q[0], q[1], q[2] + 3);
      g.localToWorld(v);
      v.project(camera);
      return v.z > 1 ? null : { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    });
    // Two ends close on screen: one label above its pin, the other below.
    const near = !!at[0] && !!at[1] && Math.abs(at[0].x - at[1].x) < 220 && Math.abs(at[0].y - at[1].y) < 44;
    const lower = near && at[0] && at[1] ? (at[0].y > at[1].y ? 0 : 1) : -1;
    at.forEach((s, i) => {
      const el = els[i];
      if (!el) return;
      if (!s) {
        el.style.opacity = "0";
        return;
      }
      const dy = i === lower ? "35%" : "-125%";
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, ${dy})`;
      el.style.opacity = "1";
    });
  });

  // A new highlight / guide step needs a frame (labels, looks).
  useEffect(() => {
    invalidate();
  }, [activeId, guide, invalidate]);

  // ── Pointer: hover (mouse only) and tap ──
  const idOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.object.userData as { connectionId?: string }).connectionId ?? null;
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    const id = idOf(e);
    if (!id || drag.current) return;
    e.stopPropagation();
    gl.domElement.style.cursor = "pointer";
    if (e.pointerType === "mouse") p.onHover(id);
  };
  // R3F's pointer-out event carries no pointerType: always clear (touch never sets a hover).
  const onOut = () => {
    if (drag.current) return;
    gl.domElement.style.cursor = hoverPart.current ? "grab" : "";
    p.onHover(null);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const id = idOf(e);
    if (!id || e.delta > 4) return;
    e.stopPropagation();
    p.onSelect(id);
  };

  // ── Drag a part on the mat ──
  const drag = useRef<{
    id: string;
    pointerId: number;
    sx: number;
    sy: number;
    /** World height of the grab point (the drag plane). */
    planeY: number;
    /** Part centre minus grab point, mat mm. */
    off: [number, number];
    xy: [number, number];
    moved: boolean;
  } | null>(null);
  const touches = useRef(new Set<number>());
  const hoverPart = useRef(false);
  const cbs = useRef({ onMovePart: p.onMovePart, onSelect: p.onSelect });
  useEffect(() => {
    cbs.current = { onMovePart: p.onMovePart, onSelect: p.onSelect };
  });
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitV = useMemo(() => new THREE.Vector3(), []);
  const setControls = useCallback(
    (on: boolean) => {
      const c = get().controls as unknown as { enabled: boolean } | null;
      if (c) c.enabled = on;
    },
    [get],
  );

  useEffect(() => {
    const el = gl.domElement;
    /** "up": the pointer let go; "cancel": the browser took it, or a second finger came (pinch). */
    const finish = (how: "up" | "cancel") => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setControls(true);
      el.style.cursor = hoverPart.current ? "grab" : "";
      if (d.moved) cbs.current.onMovePart(d.id, d.xy);
      else if (how === "up") cbs.current.onSelect(null); // a tap on a part, as before (nothing to show)
    };
    const onDownCapture = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.current.add(e.pointerId);
      if (touches.current.size > 1) finish("cancel"); // two fingers = orbit / zoom
    };
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      const g = contentRef.current;
      if (!d || !g || e.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -d.planeY;
      if (!ray.ray.intersectPlane(plane, hitV)) return;
      g.worldToLocal(hitV);
      if (!d.moved) {
        d.moved = true;
        el.style.cursor = "grabbing";
      }
      const xy = resolveMove(live.current.placements, d.id, [hitV.x + d.off[0], hitV.y + d.off[1]], d.xy);
      if (xy[0] === d.xy[0] && xy[1] === d.xy[1]) return;
      d.xy = xy;
      live.current = movePart(live.current, d.id, xy);
      const grp = groupRefs.current.get(d.id);
      if (grp) grp.position.set(xy[0], xy[1], grp.position.z);
      rebuildFor(d.id, tRef.current);
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      touches.current.delete(e.pointerId);
      if (drag.current?.pointerId === e.pointerId) finish("up");
    };
    const onCancel = (e: PointerEvent) => {
      touches.current.delete(e.pointerId);
      if (drag.current?.pointerId === e.pointerId) finish("cancel");
    };
    el.addEventListener("pointerdown", onDownCapture, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDownCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [gl, camera, ray, ndc, plane, hitV, rebuildFor, invalidate, setControls]);
  // Leaving the view mid-drag gives the camera back.
  useEffect(
    () => () => {
      if (drag.current) setControls(true);
    },
    [setControls],
  );

  const wireInFront = (e: ThreeEvent<PointerEvent>) => !!(e.intersections[0]?.object.userData as { connectionId?: string } | undefined)?.connectionId;
  const onPartDown = (instanceId: string) => (e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (wireInFront(e)) return; // the wire takes the tap
    if (e.pointerType === "touch" && touches.current.size > 1) return;
    const g = contentRef.current;
    const pl = live.current.placements.find((q) => q.instanceId === instanceId);
    if (!g || !pl || drag.current) return;
    e.stopPropagation();
    const local = g.worldToLocal(e.point.clone());
    drag.current = {
      id: instanceId,
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      planeY: e.point.y,
      off: [pl.pos[0] - local.x, pl.pos[1] - local.y],
      xy: [pl.pos[0], pl.pos[1]],
      moved: false,
    };
    setControls(false); // runs before OrbitControls sees this pointerdown
  };
  const onPartOver = (e: ThreeEvent<PointerEvent>) => {
    if (wireInFront(e)) return;
    hoverPart.current = true;
    if (!drag.current && e.pointerType === "mouse") gl.domElement.style.cursor = "grab";
  };
  const onPartOut = () => {
    hoverPart.current = false;
    if (!drag.current) gl.domElement.style.cursor = "";
  };

  // Test hook (e2e fixture pages only): where each part sits on screen, computed on demand.
  useEffect(() => {
    if (!window.location.pathname.includes("/e2e-fixtures/")) return;
    const w = window as unknown as { __wiring3dParts?: () => { id: string; board: boolean; size: number; x: number; y: number }[] };
    w.__wiring3dParts = () => {
      const g = contentRef.current;
      const r = gl.domElement.getBoundingClientRect();
      if (!g) return [];
      return live.current.placements.map((pl) => {
        const v = new THREE.Vector3(pl.pos[0], pl.pos[1], pl.pos[2] + pl.h * 0.5 + (lifts.get(pl.instanceId) ?? 0) * tRef.current);
        g.localToWorld(v).project(camera);
        return { id: pl.instanceId, board: pl.board, size: pl.w * pl.d * pl.h, x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      });
    };
    return () => {
      delete w.__wiring3dParts;
    };
  }, [gl, camera, lifts]);

  return (
    <>
      <Lights layout={layout} />
      <group rotation={CONTENT_ROT} ref={contentRef}>
        <Mat layout={layout} />
        {layout.placements.map((pl) => {
          const model = models.get(pl.instanceId);
          if (!model) return null;
          return (
            <group
              key={pl.instanceId}
              ref={(g) => {
                if (g) {
                  groupRefs.current.set(pl.instanceId, g);
                  const at = live.current.placements.find((q) => q.instanceId === pl.instanceId)?.pos ?? pl.pos;
                  g.position.set(at[0], at[1], (lifts.get(pl.instanceId) ?? 0) * tRef.current);
                } else groupRefs.current.delete(pl.instanceId);
              }}
              onPointerDown={onPartDown(pl.instanceId)}
              onPointerOver={onPartOver}
              onPointerOut={onPartOut}
            >
              {pl.breadboard && <Breadboard pl={pl} />}
              <group position={[0, 0, pl.pos[2]]} rotation={[0, 0, (pl.rotZ * Math.PI) / 180]}>
                <primitive object={model} />
              </group>
            </group>
          );
        })}
        <group onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
          <primitive object={wireGroup} />
        </group>
      </group>
      <CameraRig layout={layout} fitKey={p.fitKey} apart={apart} reducedMotion={reducedMotion} />
    </>
  );
}

// ── Mat + breadboard strip ─────────────────────────────────────────────────

function Mat({ layout }: { layout: MatLayout }) {
  const { minX, maxX, minY, maxY } = layout.bounds;
  const w = maxX - minX + MAT_MARGIN * 2;
  const d = maxY - minY + MAT_MARGIN * 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const res = useMemo(() => {
    const geo = new THREE.BoxGeometry(w, d, MAT_T);
    const mat = new THREE.MeshStandardMaterial({ color: "#dfe6ee", roughness: 0.85, metalness: 0 });
    // 10 mm grid printed on the mat.
    const pts: number[] = [];
    for (let x = -w / 2 + 10; x < w / 2; x += 10) pts.push(x, -d / 2, 0, x, d / 2, 0);
    for (let y = -d / 2 + 10; y < d / 2; y += 10) pts.push(-w / 2, y, 0, w / 2, y, 0);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: "#c6d1de", transparent: true, opacity: 0.7 });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.z = 0.05;
    grid.raycast = () => undefined;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = -MAT_T / 2;
    mesh.receiveShadow = true;
    mesh.raycast = () => undefined;
    const g = new THREE.Group();
    g.add(mesh, grid);
    return { g, geo, mat, gridGeo, gridMat };
  }, [w, d]);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
      res.gridGeo.dispose();
      res.gridMat.dispose();
    },
    [res],
  );
  return <primitive object={res.g} position={[cx, cy, 0]} />;
}

let bbMats: { body: THREE.MeshStandardMaterial; red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial } | null = null;
function Breadboard({ pl }: { pl: Placement }) {
  const res = useMemo(() => {
    bbMats ??= {
      body: new THREE.MeshStandardMaterial({ color: "#f3f1ea", roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.5 }),
      blue: new THREE.MeshStandardMaterial({ color: "#2563eb", roughness: 0.5 }),
    };
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(pl.w, pl.d, BREADBOARD_H), bbMats.body);
    body.position.z = BREADBOARD_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    for (const [s, m] of [[1, bbMats.red], [-1, bbMats.blue]] as const) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(pl.w - 2, 0.6, 0.06), m);
      stripe.position.set(0, s * (pl.d / 2 - 1.2), BREADBOARD_H + 0.03);
      g.add(stripe);
    }
    g.traverse((o) => {
      (o as THREE.Mesh).raycast = () => undefined;
    });
    return g;
  }, [pl.w, pl.d]);
  useEffect(
    () => () => {
      res.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
    [res],
  );
  return <primitive object={res} />;
}

// ── Lights (the viewer's rig) ──────────────────────────────────────────────

const KEY_DIR = new THREE.Vector3(0.6, 1.1, 0.75).normalize();
const FILL_DIR = new THREE.Vector3(-0.9, 0.45, 0.4).normalize();
const RIM_DIR = new THREE.Vector3(-0.2, 0.7, -1).normalize();

/** Content (x, y, z) Z-up → world (x, z, −y). */
function boundsWorld(layout: MatLayout) {
  const { minX, maxX, minY, maxY, maxZ } = layout.bounds;
  const centre = new THREE.Vector3((minX + maxX) / 2, Math.max(4, maxZ) / 2, -(minY + maxY) / 2);
  const r = Math.max(30, Math.hypot(maxX - minX + MAT_MARGIN, maxY - minY + MAT_MARGIN, maxZ) / 2);
  return { centre, r };
}

function Lights({ layout }: { layout: MatLayout }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const { centre, r } = boundsWorld(layout);
    const place = (l: THREE.DirectionalLight | null, dir: THREE.Vector3) => {
      if (!l) return;
      l.position.copy(centre).addScaledVector(dir, r * 4);
      l.target.position.copy(centre);
      l.target.updateMatrixWorld();
    };
    place(key.current, KEY_DIR);
    place(fill.current, FILL_DIR);
    place(rim.current, RIM_DIR);
    const k = key.current;
    if (k) {
      k.shadow.mapSize.set(1024, 1024);
      k.shadow.bias = -0.0004;
      k.shadow.normalBias = 0.6;
      k.shadow.radius = 4;
      const cam = k.shadow.camera;
      const s = r * 1.4;
      cam.left = -s;
      cam.right = s;
      cam.top = s;
      cam.bottom = -s;
      cam.near = Math.max(0.5, r * 0.5);
      cam.far = r * 8;
      cam.updateProjectionMatrix();
      k.shadow.needsUpdate = true;
    }
    invalidate();
  }, [layout, invalidate]);
  return (
    <>
      <hemisphereLight args={["#fbfcff", "#b9c4d3", 0.55]} />
      <directionalLight ref={key} castShadow intensity={1.75} color="#fffaf2" />
      <directionalLight ref={fill} intensity={0.4} color="#e8eef8" />
      <directionalLight ref={rim} intensity={0.85} color="#ffffff" />
    </>
  );
}

// ── Camera: fit the mat once per layout, then the user orbits ─────────────

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
const HOME_DIR = new THREE.Vector3(0.22, 1, 0.78).normalize();
const HOME_DIR_PORTRAIT = new THREE.Vector3(0.78, 1, -0.22).normalize();

function CameraRig({ layout, fitKey: baseKey, apart, reducedMotion }: { layout: MatLayout; fitKey: string; apart: boolean; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const first = useRef(true);
  // A new auto layout, Reset layout or a phone turned sideways frames from the home angle again;
  // "Take it apart" keeps the user's angle.
  const size = useThree((s) => s.size);
  const homeKey = `${baseKey}|${size.width / Math.max(1, size.height) < 0.8 ? "p" : "l"}`;
  const lastHome = useRef(homeKey);
  const fitKey = `${homeKey}#${apart ? 1 : 0}`;
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = controls.current;
      if (!c) return;
      const lift = apart ? Math.max(0, ...apartLift(layout).values()) : 0;
      const { minX, maxX, minY, maxY } = layout.bounds;
      const top = layout.bounds.maxZ + lift;
      const { r } = boundsWorld(layout);
      const centre = new THREE.Vector3((minX + maxX) / 2, Math.max(4, top) * 0.3, -(minY + maxY) / 2);
      camera.near = Math.max(0.5, r / 50);
      camera.far = r * 60;
      camera.updateProjectionMatrix();
      // Keep the user's angle after the first fit; fit the parts' corners (~95 % × 93 % of the view).
      // A wide mat in a tall (phone) view is seen from its side, so its long edge runs up the screen.
      const portrait = (camera.aspect || 1) < 0.8 && maxX - minX > (maxY - minY) * 1.2;
      const home = portrait ? HOME_DIR_PORTRAIT : HOME_DIR;
      const fresh = first.current || lastHome.current !== homeKey;
      lastHome.current = homeKey;
      const dir = fresh ? home.clone() : camera.position.clone().sub(c.target).normalize();
      if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(home);
      // Fit the parts (not the whole mat): the mat runs on past the frame edge.
      const m = 2;
      const pts: THREE.Vector3[] = [];
      for (const x of [minX - m, maxX + m]) for (const y of [minY - m, maxY + m]) for (const z of [0, top]) pts.push(new THREE.Vector3(x, z, -y));
      const pos0 = camera.position.clone();
      const quat0 = camera.quaternion.clone();
      let dist = r * 2.5;
      for (let it = 0; it < 10; it++) {
        camera.position.copy(centre).addScaledVector(dir, dist);
        camera.lookAt(centre);
        camera.updateMatrixWorld();
        let mx = 0;
        let my = 0;
        for (const q of pts) {
          const v = q.clone().project(camera);
          mx = Math.max(mx, Math.abs(v.x));
          my = Math.max(my, Math.abs(v.y));
        }
        const k = Math.max(mx / 0.95, my / 0.93);
        if (!Number.isFinite(k) || Math.abs(k - 1) < 0.01) break;
        dist *= k;
      }
      camera.position.copy(pos0);
      camera.quaternion.copy(quat0);
      c.minDistance = r * 0.4;
      c.maxDistance = r * 6;
      goal.current = { pos: centre.clone().addScaledVector(dir, dist), target: centre };
      if (first.current || reducedMotion) {
        camera.position.copy(goal.current.pos);
        c.target.copy(goal.current.target);
        c.update();
        goal.current = null;
      }
      first.current = false;
      invalidate();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only on a new auto layout, Reset, or apart
  }, [fitKey]);
  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.25));
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
      maxPolarAngle={Math.PI * 0.48}
      onStart={() => {
        goal.current = null; // the user takes over the camera
      }}
    />
  );
}
