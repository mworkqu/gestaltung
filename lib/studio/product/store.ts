// How the product routes change projects.studio (P5-16 Phase 2a). Pure state
// transforms on { product (page-safe), priv (server-only) } — the routes load,
// apply one of these and save through updateProductDoc. Unit-tested.

import { PRODUCT_DESIGNS_MAX, type ProductDesign, type ProductDoc } from "../schema";
import type { DesignOut } from "./ai/design";
import { finalModel, type PrivateDesign, type ProductPrivate } from "./private";
import type { ProductModel } from "./schema";

export type ProductData = { product: ProductDoc; priv: ProductPrivate };

export const EMPTY_PRODUCT: ProductDoc = { designs: [], chosenId: null, unlockedId: null, specHash: "" };

/** Designs that must never be dropped (the client picked or paid for them). */
const kept = (p: ProductDoc) => [p.chosenId, p.unlockedId].filter((x): x is string => !!x);

/**
 * Add freshly designed products. A new spec / parts set (specHash changed) drops the
 * old designs except the chosen and the unlocked one; the list is capped at
 * PRODUCT_DESIGNS_MAX, oldest unchosen first.
 */
export function addDesigns(s: ProductData, designs: (DesignOut & { id: string })[], specHash: string): ProductData {
  const keep = kept(s.product);
  let pub = [...s.product.designs];
  let priv = [...s.priv.designs];
  if (s.product.specHash !== specHash) {
    pub = pub.filter((d) => keep.includes(d.id));
    priv = priv.filter((d) => keep.includes(d.id));
  }
  for (const d of designs) {
    pub.push({ id: d.id, archetype: d.archetype, why: d.why, previewPath: null, status: "building" });
    priv.push({ id: d.id, model: d.model, solvedHash: d.solvedHash, issues: d.issues.slice(0, 60), source: d.source });
  }
  while (pub.length > PRODUCT_DESIGNS_MAX) {
    const i = pub.findIndex((d) => !keep.includes(d.id));
    if (i < 0) break;
    const [gone] = pub.splice(i, 1);
    priv = priv.filter((d) => d.id !== gone.id);
  }
  const ids = new Set(pub.map((d) => d.id));
  return {
    product: {
      designs: pub,
      chosenId: s.product.chosenId && ids.has(s.product.chosenId) ? s.product.chosenId : null,
      unlockedId: s.product.unlockedId && ids.has(s.product.unlockedId) ? s.product.unlockedId : null,
      specHash,
      ...(s.product.regens !== undefined ? { regens: s.product.regens } : {}),
    },
    priv: { designs: priv.filter((d) => ids.has(d.id)) },
  };
}

export function findDesign(s: ProductData, id: string): { pub: ProductDesign; priv: PrivateDesign } | null {
  const pub = s.product.designs.find((d) => d.id === id);
  const priv = s.priv.designs.find((d) => d.id === id);
  return pub && priv ? { pub, priv } : null;
}

const replacePriv = (s: ProductData, d: PrivateDesign): ProductData => ({
  product: s.product,
  priv: { designs: s.priv.designs.map((x) => (x.id === d.id ? d : x)) },
});
const replacePub = (s: ProductData, d: ProductDesign): ProductData => ({
  product: { ...s.product, designs: s.product.designs.map((x) => (x.id === d.id ? d : x)) },
  priv: s.priv,
});

/**
 * Record one vision check of the CURRENT model. The score belongs to the model the
 * pictures showed; the best-scoring checked version is kept in `best`; the patched
 * model (when it changed) becomes the current one for the next round.
 */
export function applyCheck(
  s: ProductData,
  id: string,
  r: { score: number; looksLike: string; missing: string[]; loop: number; patched: ProductModel; patchedHash: string; changed: boolean; notes: unknown[] },
): ProductData {
  const f = findDesign(s, id);
  if (!f) return s;
  const d = f.priv;
  const best = !d.best || r.score > d.best.score ? { model: d.model, score: r.score } : d.best;
  const next: PrivateDesign = {
    ...d,
    best,
    score: best.score,
    loops: Math.max(d.loops ?? 0, r.loop + 1),
    looksLike: r.looksLike,
    missing: r.missing,
    issues: [...(d.issues ?? []), ...r.notes].slice(-60),
    ...(r.changed ? { model: r.patched, solvedHash: r.patchedHash } : {}),
  };
  return replacePriv(s, next);
}

/** The final picture is in: the design is ready and its model is the best checked version. */
export function applyPreview(s: ProductData, id: string, previewPath: string): ProductData {
  const f = findDesign(s, id);
  if (!f) return s;
  const withPub = replacePub(s, { ...f.pub, previewPath, status: "ready" });
  return replacePriv(withPub, { ...f.priv, model: finalModel(f.priv) });
}

export function applyChoose(s: ProductData, id: string): ProductData {
  return { product: { ...s.product, chosenId: id }, priv: s.priv };
}

export function applyUnlock(s: ProductData, id: string): ProductData {
  return { product: { ...s.product, chosenId: id, unlockedId: id }, priv: s.priv };
}

/** One more regeneration was made (the first one is free, see regenCost in lib/studio/tiers.ts). */
export function applyRegen(s: ProductData): ProductData {
  return { product: { ...s.product, regens: (s.product.regens ?? 0) + 1 }, priv: s.priv };
}
