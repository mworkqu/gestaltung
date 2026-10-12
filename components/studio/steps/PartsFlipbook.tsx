"use client";

// The Parts step's spinning parts (owner 2026-10-12: "spinning the electronics was
// cool"), WITHOUT the 3D engine: a flipbook over the small pictures the geometry worker
// drew (lib/studio/geometry/parts-render.ts). No dependencies, no three.js.
//
//  * cycles the frames at ~12 fps with requestAnimationFrame; pauses off screen
//    (IntersectionObserver) and in a hidden tab;
//  * drag / swipe left-right turns the parts by hand (pointer events; touch-action
//    pan-y keeps vertical scrolling); after a release the spin resumes a moment later;
//  * prefers-reduced-motion: the first frame stands still, dragging still turns it;
//  * the spin also holds while the mouse is over the picture, after a tap on a touch
//    screen (tap again to let it go) and while a part is selected, so the tap dots
//    (children) are there to hit: they are drawn only while the picture is not moving.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const FPS = 12;
/** A drag shorter than this (px) is a tap. */
const DRAG_START_PX = 6;
/** The spin comes back this long after a drag ends. */
const RESUME_MS = 1400;

export type FlipState = { frame: number; spinning: boolean };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function PartsFlipbook({
  frames,
  total,
  width,
  height,
  alt,
  hold,
  dim,
  children,
}: {
  /** Object URLs by frame index (undefined = not arrived yet). */
  frames: (string | undefined)[];
  total: number;
  width: number;
  height: number;
  alt: string;
  /** Keep the picture still (e.g. a part is selected). */
  hold: boolean;
  dim?: boolean;
  /** Drawn over the picture, e.g. the tap dots. */
  children?: (s: FlipState) => ReactNode;
}) {
  const complete = total > 1 && frames.length >= total && frames.slice(0, total).every(Boolean);
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [hover, setHover] = useState(false);
  const [tapHeld, setTapHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cooling, setCooling] = useState(false);
  const cool = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; x0: number; frame0: number; moved: boolean; onDot: boolean } | null>(null);

  const show = useCallback(
    (n: number) => {
      const i = total > 0 ? ((n % total) + total) % total : 0;
      frameRef.current = i;
      setFrame(i);
    },
    [total],
  );

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(
    () => () => {
      if (cool.current) clearTimeout(cool.current);
    },
    [],
  );

  const held = hover || tapHeld || hold || dragging || cooling;
  const spinning = complete && !reduced && onScreen && tabVisible && !held;

  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = 1000 / FPS;
    const tick = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      if (acc >= step) {
        const n = Math.floor(acc / step);
        acc -= n * step;
        show(frameRef.current + n);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, show]);

  const mode = !complete ? (total > 1 ? "loading" : "still") : spinning ? "spinning" : reduced ? "still" : "paused";

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, x0: e.clientX, frame0: frameRef.current, moved: false, onDot: !!(e.target as HTMLElement).closest("button") };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !complete) return;
    const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_START_PX) return;
      d.moved = true;
      setDragging(true);
      if (cool.current) clearTimeout(cool.current);
      setCooling(false);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is gone */
      }
    }
    // One turn = the picture's width. Right = the near side moves right (the turntable's direction).
    const w = e.currentTarget.clientWidth || 300;
    show(d.frame0 + Math.round((dx / w) * total));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      setDragging(false);
      setCooling(true);
      if (cool.current) clearTimeout(cool.current);
      cool.current = setTimeout(() => setCooling(false), RESUME_MS);
    } else if (e.pointerType !== "mouse" && !d.onDot && complete) {
      // A tap on a touch screen: hold still (the dots appear); tap again to spin on.
      setTapHeld((h) => !h);
    }
  };
  const cancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) {
      drag.current = null;
      setDragging(false);
    }
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!complete) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setTapHeld(true);
      show(frameRef.current + (e.key === "ArrowRight" ? 1 : -1));
    }
  };

  const src = frames[frame] ?? frames[0];
  if (!src) return null;
  return (
    <div
      ref={box}
      className="absolute inset-0 touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--tw-ring-color)]"
      style={{ touchAction: "pan-y" }}
      tabIndex={complete ? 0 : -1}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onKeyDown={key}
      data-testid="studio-parts-flipbook"
      data-mode={mode}
      data-frame={frame}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: frames made in the worker */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        draggable={false}
        className={cn("h-full w-full object-cover transition-opacity", dim && "opacity-60")}
        data-testid="studio-parts-picture"
      />
      {children?.({ frame, spinning })}
    </div>
  );
}
