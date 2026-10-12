"use client";

// Page side of the Parts step picture (owner 2026-10-11). Tiny on purpose: no
// three.js here. The geometry worker draws the parts on their plate as a small
// turntable (~30 WebP frames, streamed, frame 0 first; lib/studio/geometry/
// parts-render.ts); this file keeps one set of frames per parts list (same list =
// same frames, also after going back and forth). The page only flips <img> sources.

import type { LibraryPart } from "@/lib/studio/schema";
import type { PartsFrameEvent, PartsPictureSpot } from "@/lib/studio/geometry/protocol";

/** A Worker that can draw off screen (else the page shows the icon / photo grid). */
export function partsPictureSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/** Same parts (ids, models, sizes) + same box = same picture. */
export function partsPictureKey(parts: [string, LibraryPart][], width: number, height: number, accent: string): string {
  const list = parts.map(([id, p]) => `${id}:${p.id}:${p.model.kind === "stl" ? p.model.url : p.model.builder}:${p.dims.x}x${p.dims.y}x${p.dims.z}`);
  return `${list.join("|")}#${width}x${height}#${accent}`;
}

/**
 * Small parts side by side project to nearly the same point: push tap targets apart
 * until they are at least `minPx` apart on a `wPx` × `hPx` box (kept inside it), so
 * every part can be tapped. Pure; same order out as in.
 */
export function spreadSpots<T extends { x: number; y: number }>(spots: T[], wPx: number, hPx: number, minPx = 36): T[] {
  if (wPx <= 0 || hPx <= 0) return spots;
  const pts = spots.map((s) => ({ x: s.x * wPx, y: s.y * hPx }));
  const pad = minPx / 2;
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minPx) continue;
        if (d < 1e-6) {
          // Same point: split sideways (deterministic).
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minPx - d) / 2 + 0.01;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
        moved = true;
      }
    for (const p of pts) {
      p.x = Math.min(wPx - pad, Math.max(pad, p.x));
      p.y = Math.min(hPx - pad, Math.max(pad, p.y));
    }
    if (!moved) break;
  }
  return spots.map((s, i) => ({ ...s, x: pts[i].x / wPx, y: pts[i].y / hPx }));
}

const MAX_CACHED = 6;

/** The turntable frames that have arrived (by index) for one parts list. */
export type PartsSpin = {
  frames: (PartsFrame | undefined)[];
  total: number;
  width: number;
  height: number;
  /** Every frame arrived. */
  done: boolean;
  /** The worker stopped before the last frame (what arrived stays on screen as a still). */
  failed: boolean;
  /** Total encoded bytes of the frames received so far, and the worker's draw time (ms) once done. */
  bytes: number;
  ms: number;
  /** Request start to frame 0 on the page (ms), 0 until it arrived. */
  firstMs: number;
};
export type PartsFrame = { url: string; spots: PartsPictureSpot[] };

export type PartsSpinHandle = {
  get(): PartsSpin;
  subscribe(cb: () => void): () => void;
  /** Resolves with frame 0 as soon as it is drawn; rejects when nothing could be drawn. */
  first: Promise<PartsSpin>;
  /** Free the frame URLs. */
  dispose(): void;
};

const cache = new Map<string, PartsSpinHandle>();

function startSpin(parts: [string, LibraryPart][], width: number, height: number, accent: string): PartsSpinHandle {
  const spin: PartsSpin = { frames: [], total: 0, width: 0, height: 0, done: false, failed: false, bytes: 0, ms: 0, firstMs: 0 };
  const listeners = new Set<() => void>();
  const decoded: HTMLImageElement[] = [];
  const t0 = performance.now();
  let disposed = false;
  const notify = () => listeners.forEach((cb) => cb());
  // Frames are immutable once stored; hand out a fresh object per change (useSyncExternalStore friendly).
  let snapshot: PartsSpin = spin;
  const publish = () => {
    snapshot = { ...spin, frames: spin.frames.slice() };
    notify();
  };

  const first = new Promise<PartsSpin>((resolve, reject) => {
    let gotFirst = false;
    void (async () => {
      try {
        const { postToWorker } = await import("@/lib/studio/geometry/transport");
        const r = await postToWorker<PartsFrameEvent>({ kind: "partsPicture", input: { parts, width, height, accent } }, (ev) => {
          if (ev.kind !== "partsFrame" || disposed) return;
          const url = URL.createObjectURL(new Blob([ev.bytes], { type: ev.mime }));
          // Decode in the background so flipping to a frame never stalls on decoding.
          const img = new Image();
          img.decoding = "async";
          img.src = url;
          void img.decode?.().catch(() => undefined);
          decoded[ev.index] = img;
          spin.frames[ev.index] = { url, spots: ev.spots };
          spin.total = ev.total;
          spin.width = ev.width;
          spin.height = ev.height;
          spin.bytes += ev.bytes.byteLength;
          if (!spin.firstMs) spin.firstMs = Math.round(performance.now() - t0);
          publish();
          if (!gotFirst) {
            gotFirst = true;
            resolve(snapshot);
          }
        });
        if (!r.ok) throw new Error(r.error);
        if (r.kind !== "partsPicture") throw new Error("unexpected reply");
        spin.done = spin.frames.filter(Boolean).length === spin.total && spin.total > 0;
        spin.failed = !spin.done;
        spin.ms = Math.round(performance.now() - t0);
        publish();
        if (!gotFirst) reject(new Error("no frames"));
      } catch (e) {
        spin.failed = true;
        publish();
        if (!gotFirst) reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
  first.catch(() => undefined);

  return {
    get: () => snapshot,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    first,
    dispose() {
      disposed = true;
      for (const f of spin.frames) if (f) URL.revokeObjectURL(f.url);
      decoded.length = 0;
    },
  };
}

/** Same parts list + box = the same turntable (also after going back and forth). */
export function partsSpin(parts: [string, LibraryPart][], width: number, height: number, accent: string): PartsSpinHandle {
  const key = partsPictureKey(parts, width, height, accent);
  const hit = cache.get(key);
  if (hit) return hit;
  const h = startSpin(parts, width, height, accent);
  cache.set(key, h);
  h.first.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
  return h;
}
