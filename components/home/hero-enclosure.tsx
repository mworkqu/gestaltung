"use client";

// Home hero visual (W7): a still poster of the Studio's demo enclosure (the
// LCP image, rendered on the server by hero-visual.tsx), replaced by the
// live 3D loop (slow turn, gentle open / close) once the page is idle. The 3D
// chunk (three.js + R3F, ~300 kB gz) is NOT in the page's first-load JS: it is
// imported only after ALL of
//   - the window `load` event,
//   - the first user interaction (pointer, key, scroll, touch) or 8 s (well after
//     the load-time measurement window of lab tools such as Lighthouse),
//   - requestIdleCallback,
//   - the box being on screen (IntersectionObserver),
// and never with prefers-reduced-motion (poster only) or Save-Data.
// The whole box is one link to /projects/new; the canvas takes no pointer
// events, so it never steals a scroll or a drag on a phone.

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// React.lazy (rendered only in the browser, after the gates below); next/dynamic would add its own client code.
const HeroEnclosureLive = lazy(() => import("./hero-enclosure-live"));

/** Fallback when no interaction happens (e.g. a visitor who just reads). */
const NO_INTERACTION_MS = 8000;

/** `poster`: the server-rendered <img> (components/home/hero-visual.tsx, next/image props, no client JS). */
export function HeroEnclosure({ label, poster, className }: { label: string; poster: ReactNode; className?: string }) {
  const box = useRef<HTMLAnchorElement>(null);
  const [live, setLive] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (reduce?.matches || saveData || !("IntersectionObserver" in window)) return;

    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      cleanups.push(() => window.clearTimeout(id));
    };

    const whenLoaded = () =>
      new Promise<void>((resolve) => {
        if (document.readyState === "complete") return resolve();
        const on = () => resolve();
        window.addEventListener("load", on, { once: true });
        cleanups.push(() => window.removeEventListener("load", on));
      });
    const whenEngaged = () =>
      new Promise<void>((resolve) => {
        const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "wheel"] as const;
        const on = () => {
          for (const e of events) window.removeEventListener(e, on);
          resolve();
        };
        for (const e of events) window.addEventListener(e, on, { passive: true, once: true });
        cleanups.push(() => {
          for (const e of events) window.removeEventListener(e, on);
        });
        later(on, NO_INTERACTION_MS);
      });
    const whenIdle = () =>
      new Promise<void>((resolve) => {
        const ric = window.requestIdleCallback;
        if (ric) {
          const id = ric(() => resolve(), { timeout: 3000 });
          cleanups.push(() => window.cancelIdleCallback?.(id));
        } else later(resolve, 200);
      });
    const whenVisible = () =>
      new Promise<void>((resolve) => {
        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              io.disconnect();
              resolve();
            }
          },
          { rootMargin: "100px" },
        );
        io.observe(el);
        cleanups.push(() => io.disconnect());
      });

    void (async () => {
      await whenLoaded();
      await whenEngaged();
      await whenIdle();
      await whenVisible();
      if (!cancelled) setLive(true);
    })();

    // Reduced motion switched on later: back to the poster.
    const onReduce = () => {
      if (reduce?.matches) {
        setLive(false);
        setShown(false);
      }
    };
    reduce?.addEventListener?.("change", onReduce);

    return () => {
      cancelled = true;
      reduce?.removeEventListener?.("change", onReduce);
      for (const c of cleanups) c();
    };
  }, []);

  return (
    <Link
      ref={box}
      href="/projects/new"
      aria-label={label}
      data-testid="hero-enclosure"
      data-live={shown ? "1" : "0"}
      className={cn(
        "group relative block aspect-[4/3] overflow-hidden rounded-[28px] shadow-neu-inset outline-none transition-transform duration-300 focus-visible:ring-2 focus-visible:ring-cobalt/60 motion-safe:hover:-translate-y-0.5",
        className,
      )}
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}
    >
      {poster}
      {live && (
        <div
          className={cn("pointer-events-none absolute inset-0 transition-opacity duration-700", shown ? "opacity-100" : "opacity-0")}
          aria-hidden
        >
          <Suspense fallback={null}>
            <HeroEnclosureLive onShown={() => setShown(true)} />
          </Suspense>
        </div>
      )}
    </Link>
  );
}
