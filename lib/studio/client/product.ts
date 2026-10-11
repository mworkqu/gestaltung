"use client";

// Page side of the P5-16 product pipeline (Phase 2b). Tiny on purpose: it is
// imported by the Studio steps, so it must NOT pull three.js or manifold —
// everything heavy lives in the geometry worker, reached through
// geometry/transport.ts, which is itself loaded on demand.
//
// Before "Create my CAD" the page only ever receives pictures (PNG bytes),
// progress words and page-safe metadata; after it, the worker hands over meshes.

import type {
  ProductEvent,
  ProductMockOptions,
  ProductPreviewInput,
  ProductPreviewResult,
  ProductStlResult,
  ProductUnlockInput,
  ProductUnlockResult,
} from "@/lib/studio/geometry/protocol";
import type { LibraryPart, StudioDoc } from "@/lib/studio/schema";

export type { ProductEvent, ProductPreviewResult, ProductStlResult, ProductUnlockResult } from "@/lib/studio/geometry/protocol";

/**
 * Can this browser draw the preview pictures (a Worker with OffscreenCanvas)? When it
 * cannot, the Enclosure step keeps the template enclosure flow — never a blank screen.
 */
export function productPreviewSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

export function partsInput(doc: Pick<StudioDoc, "components">, getPart: (id: string) => LibraryPart | undefined): [string, LibraryPart][] {
  return doc.components.flatMap((c) => {
    const part = getPart(c.partId);
    return part ? [[c.instanceId, part] as [string, LibraryPart]] : [];
  });
}

async function transport() {
  return import("@/lib/studio/geometry/transport");
}

/** Start the worker early (e.g. while the visitor is on the Wiring step). */
export async function warmProductWorker(): Promise<void> {
  (await transport()).warmGeometryWorker();
}

/** Design → check → picture, streamed. Rejects only when the worker itself is unavailable. */
export async function runProductPreviews(input: ProductPreviewInput, onEvent: (e: ProductEvent) => void): Promise<ProductPreviewResult> {
  const { postToWorker } = await transport();
  const r = await postToWorker({ kind: "productPreview", input }, onEvent);
  if (!r.ok) throw new Error(r.error);
  if (r.kind !== "productPreview") throw new Error("unexpected reply");
  return r.result;
}

/** After "Create my CAD": the unlocked product's meshes (built in the worker, usually from its cache). */
export async function loadUnlockedProduct(input: ProductUnlockInput): Promise<ProductUnlockResult> {
  const { postToWorker } = await transport();
  const r = await postToWorker({ kind: "productUnlocked", input });
  if (!r.ok) throw new Error(r.error);
  if (r.kind !== "productUnlocked") throw new Error("unexpected reply");
  return r.result;
}

/** STL per printable piece (+ one plate file) of the unlocked product. */
export async function productStls(hash: string, name: string): Promise<ProductStlResult> {
  const { postToWorker } = await transport();
  const r = await postToWorker({ kind: "productStl", input: { hash, name } });
  if (!r.ok) throw new Error(r.error);
  if (r.kind !== "productStl") throw new Error("unexpected reply");
  return r.result;
}

/** The fixture's mock options from the URL (?score= &productlimit= &productfail=1). */
export function mockOptionsFromUrl(): ProductMockOptions {
  try {
    const q = new URLSearchParams(window.location.search);
    const score = Number(q.get("score"));
    const limit = q.get("productlimit");
    return {
      score: Number.isFinite(score) && score >= 1 && score <= 10 ? score : 8,
      guestLimitAfter: limit !== null && Number.isFinite(Number(limit)) ? Number(limit) : null,
      fail: q.get("productfail") === "1",
      remote: q.get("productremote") === "1",
    };
  } catch {
    return { score: 8, guestLimitAfter: null, fail: false };
  }
}
