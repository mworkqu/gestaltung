"use client";

// A lean stand-in for R3F's <Canvas> (P5-15e bundle budget). R3F's own Canvas
// calls extend(THREE) — the WHOLE three.js namespace into its catalogue —
// which keeps every three.js class in the bundle. This one registers only the
// JSX elements the Studio viewer (and drei's ContactShadows / OrbitControls)
// actually render, so webpack can drop the rest of three.js.
//
// Same behaviour the viewer relied on: R3F root on a <canvas> sized to its
// container (ResizeObserver), pointer events on the wrapper div, onCreated /
// onPointerMissed, demand frameloop, errors inside the scene re-thrown here.
// No context bridge: nothing inside the scene reads React context from outside
// (the viewer provides its own context inside).
//
// NEW JSX ELEMENT IN THE SCENE (e.g. <boxGeometry>) → add its class to CATALOGUE.

import { Component, Suspense, useInsertionEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, OrthographicCamera } from "three";
import { createRoot, events as createPointerEvents, extend, type ReconcilerRoot, type RenderProps } from "@react-three/fiber";

/** Every lowercase JSX element used inside the viewer's scene (<primitive> is built in). */
const CATALOGUE = { DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, OrthographicCamera };
let extended = false;

type Props = Omit<RenderProps<HTMLCanvasElement>, "size" | "events"> & {
  children?: ReactNode;
  className?: string;
};

class SceneErrorBoundary extends Component<{ onError: (e: unknown) => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LeanCanvas({ children, className, onCreated, ...config }: Props) {
  if (!extended) {
    extend(CATALOGUE);
    extended = true;
  }
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const root = useRef<ReconcilerRoot<HTMLCanvasElement> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, top: 0, left: 0 });
  const [error, setError] = useState<unknown>(null);
  if (error) throw error;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s.width === r.width && s.height === r.height && s.top === r.top && s.left === r.left
          ? s
          : { width: r.width, height: r.height, top: r.top, left: r.left },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Like R3F's Canvas: (re)configure + render on every render once the box has a size
  // (no dependency list on purpose; setError only fires on a failure, which then throws).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const r = (root.current ??= createRoot(canvas));
    let cancelled = false;
    r.configure({
      ...config,
      size,
      events: createPointerEvents,
      onCreated: (state) => {
        if (wrapRef.current) state.events.connect?.(wrapRef.current);
        onCreated?.(state);
      },
    })
      .then(() => {
        if (cancelled) return;
        r.render(
          <SceneErrorBoundary onError={setError}>
            <Suspense fallback={null}>{children ?? null}</Suspense>
          </SceneErrorBoundary>,
        );
      })
      .catch(setError);
    return () => {
      cancelled = true;
    };
  });

  // Insertion-effect cleanup (as R3F's Canvas): survives StrictMode effect replay; runs on real removal.
  useInsertionEffect(
    () => () => {
      root.current?.unmount();
      root.current = null;
    },
    [],
  );

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div ref={boxRef} style={{ width: "100%", height: "100%" }}>
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
    </div>
  );
}
