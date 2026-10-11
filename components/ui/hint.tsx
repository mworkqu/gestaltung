"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

// Short hint for a status pill, a column header or a field: ONE line of text in
// a small bubble. Opens on mouse hover, on keyboard focus and on tap (touch
// toggles); Escape, a tap elsewhere or scrolling closes it. The bubble is
// positioned in pixels from the trigger's rectangle and rendered in a portal,
// so it is never clipped by a scrolling table and works the same in RTL.
//
//   <Hint label="Tick after you message the customer." />          a small "?" dot
//   <Hint label="…" triggerLabel="What is this?" />                 own accessible name for the dot
//   <HintTip label="Money received."><StatusPill/></HintTip>        wraps a pill / header
//
// `label` is already translated by the caller (this component owns no copy, so
// it needs no message scope). Keep it to one short line.

const GAP = 8; // px between trigger and bubble
const EDGE = 8; // px kept free at the viewport edge

type Place = { top: number; left: number };

function useHint() {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const pointerType = React.useRef<string>("");
  const [open, setOpen] = React.useState(false);
  const [place, setPlace] = React.useState<Place | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Position from the trigger rectangle once the bubble has been measured.
  React.useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const t = triggerRef.current?.getBoundingClientRect();
    const b = bubbleRef.current?.getBoundingClientRect();
    if (!t || !b) return;
    const vw = document.documentElement.clientWidth;
    const centred = t.left + t.width / 2 - b.width / 2;
    const left = Math.max(EDGE, Math.min(centred, vw - b.width - EDGE));
    const roomAbove = t.top - GAP - b.height >= EDGE;
    setPlace({ left, top: roomAbove ? t.top - GAP - b.height : t.bottom + GAP });
  }, [open]);

  // Escape, a tap/click elsewhere, scroll and resize close it.
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (el && (triggerRef.current?.contains(el) || bubbleRef.current?.contains(el))) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      pointerType.current = e.pointerType;
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setOpen(true);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setOpen(false);
    },
    // A tap focuses the element too; the click that follows toggles, so a touch focus must not open it first.
    onFocus: () => {
      if (pointerType.current !== "touch" && pointerType.current !== "pen") setOpen(true);
    },
    onBlur: () => setOpen(false),
    onClick: () => {
      // A mouse click keeps the hover bubble open; a tap or Enter/Space toggles it.
      if (pointerType.current === "mouse") setOpen(true);
      else setOpen((v) => !v);
      pointerType.current = "";
    },
  };

  function bubble(label: string) {
    if (!open || !mounted) return null;
    return createPortal(
      <div
        ref={bubbleRef}
        id={id}
        role="tooltip"
        data-hint-bubble=""
        style={{ position: "fixed", top: place?.top ?? 0, left: place?.left ?? 0, visibility: place ? "visible" : "hidden" }}
        className="pointer-events-none z-[100] max-w-[min(15rem,calc(100vw-1rem))] rounded-lg bg-ink px-2.5 py-1.5 text-start text-xs font-medium leading-snug text-white shadow-lg"
      >
        {label}
      </div>,
      document.body
    );
  }

  return { id, open, triggerRef, handlers, bubble };
}

/** A small "?" dot with a hint. Use next to a label that needs one short line of context. */
export function Hint({
  label,
  triggerLabel,
  className,
}: {
  label: string;
  /** Accessible name of the dot; defaults to the hint text itself. */
  triggerLabel?: string;
  className?: string;
}) {
  const { id, open, triggerRef, handlers, bubble } = useHint();
  return (
    <>
      <button
        ref={(el) => {
          triggerRef.current = el;
        }}
        type="button"
        aria-label={triggerLabel ?? label}
        aria-describedby={open ? id : undefined}
        {...handlers}
        className={cn(
          "relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-panel align-middle text-[10px] font-bold leading-none text-mutedtext shadow-neu-sm",
          "before:absolute before:-inset-3 before:content-['']", // 40 px touch area around a 16 px dot
          "hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60",
          className
        )}
      >
        <span aria-hidden="true">?</span>
      </button>
      {bubble(label)}
    </>
  );
}

/**
 * Wraps a status pill or a column header so hovering, focusing or tapping it
 * shows the hint. The wrapper is focusable (Tab) and described by the bubble.
 */
export function HintTip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { id, open, triggerRef, handlers, bubble } = useHint();
  return (
    <>
      <span
        ref={(el) => {
          triggerRef.current = el;
        }}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        {...handlers}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handlers.onClick();
          }
        }}
        className={cn(
          "inline-flex cursor-help items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60",
          className
        )}
      >
        {children}
      </span>
      {bubble(label)}
    </>
  );
}
