// Design Studio geometry worker: enclosure CSG + printed parts off the main
// thread (a mid phone spends 1–5 s here). Bundled by webpack from
// `new Worker(new URL("./studio-geometry.worker.ts", import.meta.url))` in
// client.ts, so three-bvh-csg / three-mesh-bvh live in this chunk only.

import { handleRequest } from "./job";
import type { GeometryReply, GeometryRequest } from "./protocol";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<GeometryRequest>) => void) | null;
  postMessage(message: GeometryReply, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  // (The bracketed tag also lets scripts/studio-bundle-size.mjs find this chunk.)
  if (!e.data || typeof e.data.id !== "number") {
    console.warn("[studio-geometry-worker] ignored a message without an id");
    return;
  }
  const { reply, transfer } = handleRequest(e.data);
  ctx.postMessage(reply, transfer);
};
