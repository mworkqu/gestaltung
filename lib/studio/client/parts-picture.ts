"use client";

// Page side of the Parts step picture (owner 2026-10-11). Tiny on purpose: no
// three.js here. The geometry worker draws the parts on their plate and sends a
// PNG back (lib/studio/geometry/parts-render.ts); this file keeps one picture
// per parts list (same list = same picture, also after going back and forth).

import type { LibraryPart } from "@/lib/studio/schema";
import type { PartsPictureSpot } from "@/lib/studio/geometry/protocol";

export type PartsPicture = { url: string; width: number; height: number; spots: PartsPictureSpot[] };

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
const cache = new Map<string, Promise<PartsPicture>>();

export function renderPartsPicture(parts: [string, LibraryPart][], width: number, height: number, accent: string): Promise<PartsPicture> {
  const key = partsPictureKey(parts, width, height, accent);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const { postToWorker } = await import("@/lib/studio/geometry/transport");
    const r = await postToWorker({ kind: "partsPicture", input: { parts, width, height, accent } });
    if (!r.ok) throw new Error(r.error);
    if (r.kind !== "partsPicture") throw new Error("unexpected reply");
    const url = URL.createObjectURL(new Blob([r.result.png], { type: "image/png" }));
    return { url, width: r.result.width, height: r.result.height, spots: r.result.spots };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    const old = cache.get(oldest);
    cache.delete(oldest);
    void old?.then((x) => URL.revokeObjectURL(x.url)).catch(() => undefined);
  }
  return p;
}
