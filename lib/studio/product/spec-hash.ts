// P5-16 (Phase 2b): the key of "what the product designs were made for".
// doc.product.specHash is written by the server (/api/studio/product/design,
// lib/studio/server/product.ts productSpecHash); the page computes the SAME
// value here (no server imports) so it can tell whether the stored designs still
// match the spec + parts — the W8 idea: going back and forward never redesigns.
// Keep the two rules identical (spec-hash test checks a known value).

import { stableHash } from "../cache";
import type { ProductSpec, StudioComponent } from "../schema";

/** Same spec + same parts (in any order) → same key. Labels / reasons are words only and do not count. */
export function productSpecHash(spec: ProductSpec, components: readonly Pick<StudioComponent, "partId">[]): string {
  return stableHash({ spec, parts: components.map((c) => c.partId).sort() });
}
