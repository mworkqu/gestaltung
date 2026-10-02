"use client";

// Browser-side CAD rendering: OpenSCAD code → binary STL, in a Web Worker so
// the page never freezes. Nothing loads until the first render (a generated
// or re-opened model). The engine comes from a public CDN pinned to an exact
// npm version (zero hosting cost; see render.worker.ts); unpkg is the
// fallback if jsDelivr cannot be reached. One render at a time; a render
// that takes over 60 s is stopped and the worker replaced.

import type { WorkerReply } from "./render.worker";

/** openscad-wasm-prebuilt 1.2.0 = OpenSCAD 2025.01.19 with the manifold backend, GPL-2.0+. */
export const OPENSCAD_URLS = [
  "https://cdn.jsdelivr.net/npm/openscad-wasm-prebuilt@1.2.0/dist/openscad.js",
  "https://unpkg.com/openscad-wasm-prebuilt@1.2.0/dist/openscad.js",
];
export const RENDER_TIMEOUT_MS = 60_000;

export type RenderResult =
  | { ok: true; stl: ArrayBuffer; log: string }
  | { ok: false; error: "load" | "render" | "timeout"; log: string };

let worker: Worker | null = null;
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
  worker ??= new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function runOnce(scad: string, timeoutMs: number): Promise<RenderResult> {
  return new Promise((resolve) => {
    const id = nextId++;
    const w = getWorker();
    const done = (r: RenderResult) => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      resolve(r);
    };
    const reset = () => {
      w.terminate();
      if (worker === w) worker = null;
    };
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.id !== id) return;
      done(e.data.ok ? { ok: true, stl: e.data.stl, log: e.data.log } : { ok: false, error: e.data.error, log: e.data.log });
    };
    const onError = (e: ErrorEvent) => {
      reset();
      done({ ok: false, error: "load", log: e.message || "the 3D engine stopped" });
    };
    const timer = setTimeout(() => {
      reset();
      done({ ok: false, error: "timeout", log: `OpenSCAD did not finish within ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, scad, urls: OPENSCAD_URLS });
  });
}

/** Render OpenSCAD code to a binary STL in the browser. Never throws. */
export function renderScad(scad: string, timeoutMs = RENDER_TIMEOUT_MS): Promise<RenderResult> {
  const run = queue.then(() => runOnce(scad, timeoutMs));
  queue = run.catch(() => undefined);
  return run.catch((e) => ({ ok: false as const, error: "load" as const, log: String(e) }));
}

/** Bounding box and triangle count of a binary STL. */
export function stlStats(stl: ArrayBuffer): { triangles: number; size: [number, number, number] } | null {
  if (stl.byteLength < 84) return null;
  const dv = new DataView(stl);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 > stl.byteLength) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let v = 0; v < 3; v++)
      for (let a = 0; a < 3; a++) {
        const x = dv.getFloat32(84 + i * 50 + 12 + v * 12 + a * 4, true);
        if (x < min[a]) min[a] = x;
        if (x > max[a]) max[a] = x;
      }
  if (!n) return { triangles: 0, size: [0, 0, 0] };
  return { triangles: n, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
