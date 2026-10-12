// Design Studio geometry worker: enclosure CSG + printed parts off the main
// thread (a mid phone spends 1–5 s here). Bundled by webpack from
// `new Worker(new URL("./studio-geometry.worker.ts", import.meta.url))` in
// client.ts, so three-bvh-csg / three-mesh-bvh live in this chunk only.
//
// P5-16: "product" requests (the real product model) are handled by
// product-job.ts, imported on the first such request, which in turn loads
// manifold-3d (WASM) lazily — workers that only build enclosures never fetch it.

import { handleRequest } from "./job";
import type { GeometryRequest, WorkerMessage } from "./protocol";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<GeometryRequest>) => void) | null;
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  // (The bracketed tag also lets scripts/studio-bundle-size.mjs find this chunk.)
  if (!e.data || typeof e.data.id !== "number") {
    console.warn("[studio-geometry-worker] ignored a message without an id");
    return;
  }
  const req = e.data;
  if (req.kind === "product") {
    import("./product-job")
      .then((m) => m.handleProductRequest(req))
      .then(({ reply, transfer }) => ctx.postMessage(reply, transfer))
      .catch((err: unknown) => ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    return;
  }
  if (req.kind === "productPreview" || req.kind === "productUnlocked" || req.kind === "productStl") {
    // P5-16 Phase 2b: preview pictures (streamed), unlocked meshes, STLs. Same lazy chunk.
    import("./product-job")
      .then((m) => m.handleProductJob(req, (msg, transfer) => ctx.postMessage(msg, transfer)))
      .catch((err: unknown) => ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    return;
  }
  if (req.kind === "partsPicture") {
    // The Parts step turntable (three.js + the library part models, its own lazy chunk).
    // Frames are streamed as events (frame 0 first); the reply only closes the request.
    const t0 = performance.now();
    import("./parts-render")
      .then((m) => m.renderPartsTurntable(req.input, (frame) => ctx.postMessage({ id: req.id, event: frame }, [frame.bytes])))
      .then((result) => ctx.postMessage({ id: req.id, ok: true, kind: "partsPicture", result, ms: Math.round(performance.now() - t0) }))
      .catch((err: unknown) => ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    return;
  }
  const { reply, transfer } = handleRequest(req);
  ctx.postMessage(reply, transfer);
};
