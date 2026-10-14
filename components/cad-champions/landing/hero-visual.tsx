"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { heroMode } from "@/lib/cad-champions/landing/hero-mode";
import { cn } from "@/lib/utils";

import { HeroStatic } from "./hero-static";

// The hero picture. The static drawing renders on the server and stays until
// the 3D model has drawn, inside a fixed aspect-ratio box (no layout shift).
// The 3D chunk (three.js + R3F) is requested only when the device qualifies
// (heroMode: no reduced motion, no Save-Data, not 2G, >= 4 GB memory, WebGL)
// AND the box is near the viewport; it pauses whenever the box is off-screen
// or the tab is hidden.

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => null });

type NavigatorExtras = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // probe only: free the context
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function HeroVisual({ label, className }: { label: string; className?: string }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = React.useState(false);
  const [near, setNear] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [pageVisible, setPageVisible] = React.useState(true);
  const [ready, setReady] = React.useState(false);

  // Device check (client only; runs once, and again if reduced motion changes).
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => {
      const nav = navigator as NavigatorExtras;
      setAllowed(
        heroMode({
          reducedMotion: mq.matches,
          saveData: nav.connection?.saveData ?? null,
          effectiveType: nav.connection?.effectiveType ?? null,
          deviceMemory: nav.deviceMemory ?? null,
          cores: nav.hardwareConcurrency ?? null,
          webgl: hasWebGL(),
        }) === "3d",
      );
    };
    decide();
    mq.addEventListener("change", decide);
    return () => {
      mq.removeEventListener("change", decide);
    };
  }, []);

  // Near the viewport → load; on screen → run.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || !allowed) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setVisible(e.isIntersecting);
          if (e.isIntersecting) setNear(true);
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [allowed]);

  React.useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const showScene = allowed && near;
  const onReady = React.useCallback(() => {
    // Give the first frame a moment before the drawing fades out.
    window.setTimeout(() => setReady(true), 120);
  }, []);

  return (
    <div ref={boxRef} className={cn("relative aspect-square w-full", className)}>
      <HeroStatic
        label={label}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-500 motion-reduce:transition-none",
          showScene && ready ? "opacity-0" : "opacity-100",
        )}
      />
      {showScene ? (
        <div className="absolute inset-0" aria-hidden="true">
          <HeroScene running={visible && pageVisible} onReady={onReady} />
        </div>
      ) : null}
    </div>
  );
}
