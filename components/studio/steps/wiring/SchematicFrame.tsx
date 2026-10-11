"use client";

// The wiring diagram viewer (W5). A big frame (full content width, height
// min(75dvh, 760px)) that opens fitted to the whole drawing; zoom with the
// buttons, Ctrl/Cmd + wheel or a two-finger pinch (anchored at the cursor /
// pinch midpoint), drag to pan, Fit to reset, and a full-screen dialog.
// The maths lives in lib/studio/viewport.ts (unit-tested). No dependencies:
// the drawing is the generated SVG, moved with one CSS transform.
//
// The drawing is always left-to-right (dir="ltr"), also in Arabic; the
// controls around it are localised and mirror normally.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Maximize2, Minimize2, Minus, Plus, ScanLine } from "lucide-react";

import {
  clampPan,
  distance,
  FIT_PADDING,
  fitTransform,
  midpoint,
  minScaleFor,
  parseViewBox,
  percentLabel,
  pinchTransform,
  zoomBy,
  ZOOM_STEP,
  type Fit,
  type Point,
  type Size,
  type ViewTransform,
} from "@/lib/studio/viewport";

const FALLBACK_SIZE: Size = { w: 800, h: 500 };
const KEY_PAN = 48;
const MIN_HUG_HEIGHT = 260;

const btn =
  "grid h-11 w-11 place-items-center rounded-full bg-surface text-heading shadow-neu-sm disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function SchematicFrame({ svg, label }: { svg: string; label: string }) {
  const t = useTranslations("Studio");
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <Viewport
        svg={svg}
        label={label}
        heightClass="h-[min(75dvh,760px)]"
        hug
        testId="studio-schematic"
        extra={
          <button type="button" className={btn} onClick={() => setOpen(true)} aria-label={t("schematic.fullscreen")}>
            <Maximize2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        }
      />
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        data-testid="studio-schematic-dialog"
        onClose={() => setOpen(false)}
        className="m-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden border-0 bg-surface p-0 text-body open:flex open:flex-col"
      >
        {open && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
            <h2 id={titleId} className="sr-only">
              {label}
            </h2>
            <Viewport
              svg={svg}
              label={label}
              heightClass="min-h-0 flex-1"
              testId="studio-schematic-full"
              extra={
                <button type="button" className={btn} onClick={() => setOpen(false)} aria-label={t("schematic.exitFullscreen")} autoFocus>
                  <Minimize2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              }
            />
          </div>
        )}
      </dialog>
    </>
  );
}

type Pointers = Map<number, Point>;

function Viewport({
  svg,
  label,
  heightClass,
  hug = false,
  testId,
  extra,
}: {
  svg: string;
  label: string;
  heightClass: string;
  /** Inline frame: no taller than the drawing needs at this width (never above heightClass's cap). */
  hug?: boolean;
  testId: string;
  extra: React.ReactNode;
}) {
  const t = useTranslations("Studio");
  const canvas = useRef<HTMLDivElement>(null);
  const content = useMemo(() => parseViewBox(svg) ?? FALLBACK_SIZE, [svg]);
  const [view, setView] = useState<Size | null>(null);
  const [tf, setTf] = useState<ViewTransform | null>(null);
  const [dragging, setDragging] = useState(false);

  // Refs mirror the state so event handlers (and the native wheel listener) never read stale values.
  const tfRef = useRef<ViewTransform | null>(null);
  const viewRef = useRef<Size | null>(null);
  const fitRef = useRef<Fit | null>(null);
  /** True until the user moves the drawing: then a resize (rotate, dialog) keeps it fitted. */
  const fitted = useRef(true);
  const pointers = useRef<Pointers>(new Map());
  const pinch = useRef<{ t: ViewTransform; mid: Point; dist: number } | null>(null);
  const last = useRef<Point | null>(null);

  const minScale = useCallback(() => (fitRef.current ? minScaleFor(fitRef.current) : 0.1), []);

  const commit = useCallback(
    (next: ViewTransform, keepFitted = false) => {
      const v = viewRef.current;
      const clamped = v ? clampPan(next, v, content) : next;
      tfRef.current = clamped;
      fitted.current = keepFitted;
      setTf(clamped);
    },
    [content],
  );

  const fit = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const f = fitTransform(v, content);
    fitRef.current = f;
    commit({ scale: f.scale, x: f.x, y: f.y }, true);
  }, [commit, content]);

  // Measure the frame; fit on first show, again when the drawing changes, and on resize while still fitted.
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const next = { w: r.width, h: r.height };
      const prev = viewRef.current;
      if (prev && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5) return;
      viewRef.current = next;
      setView(next);
      const f = fitTransform(next, content);
      fitRef.current = f;
      if (fitted.current || !tfRef.current) commit({ scale: f.scale, x: f.x, y: f.y }, true);
      else commit(tfRef.current, false);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content, commit]);

  // A new drawing starts fitted again.
  useEffect(() => {
    fitted.current = true;
    if (viewRef.current) fit();
  }, [svg, fit]);

  const centre = useCallback((): Point => {
    const v = viewRef.current;
    return v ? { x: v.w / 2, y: v.h / 2 } : { x: 0, y: 0 };
  }, []);

  const zoomButton = useCallback(
    (factor: number) => {
      const cur = tfRef.current;
      if (cur) commit(zoomBy(cur, factor, centre(), minScale()));
    },
    [commit, centre, minScale],
  );

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers send as ctrl+wheel) zooms at the cursor.
  // Native listener: React's onWheel is passive and cannot stop the page from zooming/scrolling.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // a plain wheel keeps scrolling the page
      e.preventDefault();
      const cur = tfRef.current;
      if (!cur) return;
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025));
      commit(zoomBy(cur, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, minScale()));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commit, minScale]);

  function local(e: React.PointerEvent): Point {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && tfRef.current) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { t: tfRef.current, mid: midpoint(a, b), dist: distance(a, b) };
      last.current = null;
    } else if (pointers.current.size === 1) {
      last.current = local(e);
      setDragging(true);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const cur = tfRef.current;
    if (!cur) return;
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      commit(pinchTransform(pinch.current, { mid: midpoint(a, b), dist: distance(a, b) }, minScale()));
    } else if (last.current) {
      const dx = p.x - last.current.x;
      const dy = p.y - last.current.y;
      last.current = p;
      if (dx || dy) commit({ ...cur, x: cur.x + dx, y: cur.y + dy });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    // One finger left after a pinch: carry on panning from where it is.
    const rest = [...pointers.current.values()];
    last.current = rest.length === 1 ? rest[0] : null;
    if (rest.length === 0) setDragging(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const cur = tfRef.current;
    if (!cur) return;
    let handled = true;
    if (e.key === "+" || e.key === "=") zoomButton(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomButton(1 / ZOOM_STEP);
    else if (e.key === "0") fit();
    else if (e.key === "ArrowLeft") commit({ ...cur, x: cur.x + KEY_PAN });
    else if (e.key === "ArrowRight") commit({ ...cur, x: cur.x - KEY_PAN });
    else if (e.key === "ArrowUp") commit({ ...cur, y: cur.y + KEY_PAN });
    else if (e.key === "ArrowDown") commit({ ...cur, y: cur.y - KEY_PAN });
    else handled = false;
    if (handled) e.preventDefault();
  }

  // A short drawing gets a short frame (still capped by heightClass, min 260 px) instead of a big empty one.
  const hugHeight =
    hug && view ? Math.max(MIN_HUG_HEIGHT, Math.ceil(content.h * ((view.w - 2 * FIT_PADDING) / content.w)) + 2 * FIT_PADDING) : null;
  const scale = tf?.scale ?? 1;
  const atMin = tf != null && scale <= minScale() + 1e-6;
  const atMax = tf != null && scale >= 4 - 1e-6;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" dir="ltr">
      <div className="flex flex-wrap items-center justify-end gap-1.5" dir="auto">
        <span className="me-auto text-xs text-mutedtext max-sm:hidden" dir="auto">
          {t("schematic.hint")}
        </span>
        <span
          className="min-w-[3.25rem] text-center text-sm font-semibold tabular-nums text-heading"
          data-testid="studio-schematic-zoom"
          aria-live="polite"
          aria-label={t("schematic.zoomLevel")}
        >
          {percentLabel(scale)}
        </span>
        <button type="button" className={btn} onClick={() => zoomButton(1 / ZOOM_STEP)} disabled={atMin} aria-label={t("schematic.zoomOut")}>
          <Minus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => zoomButton(ZOOM_STEP)} disabled={atMax} aria-label={t("schematic.zoomIn")}>
          <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className={btn} onClick={fit} aria-label={t("schematic.fit")} data-testid="studio-schematic-fit">
          <ScanLine className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
        {extra}
      </div>
      <div
        ref={canvas}
        className={`${heightClass} relative w-full select-none overflow-hidden rounded-[20px] bg-white shadow-neu-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        // Only this canvas swallows touch gestures; the rest of the page still scrolls.
        style={{ touchAction: "none", ...(hugHeight ? { maxHeight: hugHeight } : null) }}
        data-testid={testId}
        dir="ltr"
        tabIndex={0}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div
          role="img"
          aria-label={label}
          data-testid={`${testId}-content`}
          className="absolute left-0 top-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{
            width: content.w,
            height: content.h,
            transformOrigin: "0 0",
            transform: tf ? `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})` : "scale(0)",
            visibility: tf && view ? "visible" : "hidden",
            willChange: "transform",
          }}
          // Our own generated SVG (lib/studio/schematic.ts escapes all text).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
