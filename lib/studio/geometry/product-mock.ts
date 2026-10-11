// TEST-ONLY (e2e fixture, E2E_FIXTURES): the six /api/studio/product/* endpoints
// answered INSIDE the worker, with no network, no AI, no DB and no credit — the
// same idea as lib/studio/client/mock.ts for the rest of the Studio. Designs are
// the archetype defaults (defaultProductFor / productVariants: a different
// archetype each, never a colour change), the vision check returns a fixed score.
// Loaded by the worker only when the page asks for the mock (fixture pages only).

import { defaultProductFor, rankArchetypes } from "../product/archetypes";
import { clampProductModel, type Archetype, type ProductModel } from "../product/schema";
import type { LayoutInput } from "../layout";
import type { ProductMockOptions, ProductPreviewInput } from "./protocol";
import type { Http } from "./product-preview";

type Design = { id: string; archetype: Archetype; model: ProductModel; score?: number; loops?: number };

/** Per worker: designs by project (lives as long as the worker / the tab). */
const store = new Map<string, Map<string, Design>>();
let builds = 0;

/** Forget everything (tests). */
export function resetProductMock() {
  store.clear();
  builds = 0;
}

export function mockProductHttp(input: Pick<ProductPreviewInput, "projectId" | "spec" | "parts">, opts: ProductMockOptions): Http {
  const parts: LayoutInput[] = input.parts.map(([instanceId, part]) => ({ instanceId, part }));
  const designs = store.get(input.projectId) ?? new Map<string, Design>();
  store.set(input.projectId, designs);
  return async (path, init) => {
    const body = (init.body ?? {}) as Record<string, unknown>;
    switch (path) {
      case "/design": {
        // ?productfail=1: the design call fails (the page falls back to the template enclosure).
        if (opts.fail) return { status: 500, data: { error: "failed" } };
        const count = Math.max(1, Math.min(3, Number(body.count) || 3));
        if (opts.guestLimitAfter != null && builds + count > opts.guestLimitAfter) return { status: 429, data: { error: "guest_limit" } };
        builds += count;
        const exclude = new Set(Array.isArray(body.exclude) ? (body.exclude as string[]) : []);
        const picked = rankArchetypes(input.spec)
          .map((r) => r.archetype)
          .filter((a) => !exclude.has(a))
          .slice(0, count);
        const out = picked.map((archetype) => {
          // Same shape as the server's ids (d_ + 6–16 base-36 chars).
          const id = `d_${`mk${archetype.replace(/_/g, "")}`.slice(0, 16)}`;
          const model = defaultProductFor(input.spec, parts, { archetype });
          designs.set(id, { id, archetype, model });
          // Empty why → the page shows Studio.product.why_<archetype> (EN + AR).
          return { id, archetype, model, why: { en: "", ar: "" } };
        });
        return { status: 200, data: { designs: out } };
      }
      case "/check": {
        const d = designs.get(String(body.designId));
        if (!d) return { status: 404, data: { error: "not_found" } };
        d.score = opts.score ?? 8;
        d.loops = Number(body.loop) || 0;
        return { status: 200, data: { score: d.score, looksLike: d.archetype.replace(/_/g, " "), missing: [], model: d.model, changed: false } };
      }
      case "/preview": {
        const id = String(body.designId);
        if (!designs.has(id)) return { status: 404, data: { error: "not_found" } };
        return { status: 200, data: { previewPath: `mock/studio-previews/${input.projectId}/${id}.png` } };
      }
      case "/model": {
        const d = designs.get(String(init.query?.designId));
        if (!d) return { status: 404, data: { error: "not_found" } };
        return { status: 200, data: { model: clampProductModel(d.model) } };
      }
      default:
        return { status: 404, data: { error: "not_found" } };
    }
  };
}
