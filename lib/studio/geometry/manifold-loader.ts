// Lazy manifold-3d (WASM) loader for the product kernel (P5-16).
//
// manifold-3d@3.5.4 (pinned, Apache-2.0) is only ever reached through this
// dynamic import, from product-job.ts — itself loaded on demand by the geometry
// worker when the first product is built. So neither its JS nor its 540 kB
// .wasm is in any page's first-load JS. In node (vitest) the same import finds
// the .wasm next to manifold.js through import.meta.url.

import type { ManifoldToplevel } from "manifold-3d";

let ready: Promise<ManifoldToplevel> | null = null;

export function loadManifold(): Promise<ManifoldToplevel> {
  if (!ready) {
    ready = import("manifold-3d").then(async (mod) => {
      const wasm = await mod.default();
      wasm.setup();
      return wasm;
    });
    // A failed load (offline, blocked) can be retried by the next build.
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}
