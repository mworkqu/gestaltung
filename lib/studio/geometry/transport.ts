// The ONE Studio geometry worker and its message transport (no three.js here,
// so the product preview client can talk to the worker without loading it on
// the main thread). geometry/client.ts builds its caches on top of this.
//
// Requests are matched by id. A long request (P5-16 productPreview) may stream
// events ({ id, event }) before its one reply; the caller's onEvent gets them.

import { isGeometryEvent, type GeometryEvent, type GeometryReply, type GeometryRequest, type ProductEvent, type WorkerMessage } from "./protocol";

type Pending = { resolve: (r: GeometryReply) => void; reject: (e: Error) => void; onEvent?: (e: never) => void };
export type Job = GeometryRequest extends infer R ? (R extends GeometryRequest ? Omit<R, "id"> : never) : never;

let worker: Worker | null | undefined; // undefined = not tried yet, null = unavailable
let nextId = 1;
const pending = new Map<number, Pending>();

/** Where the last job ran ("worker" / "main"); read by tests and the perf probe. */
export const geometryStats = { worker: 0, main: 0, lastMs: 0, persisted: 0 };

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

export function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return (worker = null);
  try {
    const w = new Worker(new URL("./studio-geometry.worker.ts", import.meta.url), { type: "module", name: "studio-geometry" });
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      const p = pending.get(data?.id);
      if (!p) return;
      if (isGeometryEvent(data)) {
        (p.onEvent as ((e: GeometryEvent["event"]) => void) | undefined)?.(data.event);
        return;
      }
      pending.delete(data.id);
      p.resolve(data);
    };
    const broken = (e: Event) => {
      // Failed to load (CSP, old browser) or crashed: everything waiting falls back.
      e.preventDefault?.();
      if (worker === w) worker = null;
      w.terminate();
      failAll(new Error("geometry worker stopped"));
    };
    w.onerror = broken;
    w.onmessageerror = broken;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Start the worker (and its scripts) before the first build, e.g. when the Enclosure step opens. */
export function warmGeometryWorker(): void {
  getWorker();
}

/** Post a job to the worker. Rejects when there is no worker or it stopped (callers fall back). */
export function postToWorker<E = ProductEvent>(job: Job, onEvent?: (e: E) => void): Promise<GeometryReply> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("no worker"));
  const id = nextId++;
  return new Promise<GeometryReply>((resolve, reject) => {
    pending.set(id, { resolve, reject, onEvent: onEvent as ((e: never) => void) | undefined });
    w.postMessage({ ...job, id } as GeometryRequest);
  }).then((r) => {
    geometryStats.worker += 1;
    return r;
  });
}

/** Test hook: forget the worker. */
export function resetTransportForTests() {
  worker?.terminate();
  worker = undefined;
  failAll(new Error("reset"));
}
