// P5-16 server-only product data: projects.studio.productPrivate.
//
// Owner rule: before "Create my CAD" the page gets pictures only. So the
// ProductModels (and the vision scores, issues, loops for the Engineer view)
// live under the `productPrivate` key of projects.studio, which:
//   * is NOT in StudioDocSchema → every doc parse (page props, /api/studio/doc,
//     conflict answers, server updates) drops it;
//   * is MERGED back by the server on every doc save (mergeServerOwned), so a
//     page save can neither erase nor forge it. The page-safe `product` field
//     is server-owned the same way (unlockedId gates GET /model).
// Only app/api/studio/product/* reads or writes it (lib/studio/server/doc.ts
// loadDocPrivate / updateProductDoc). Pure helpers here (unit-tested).

import { ProductDocSchema, type ProductDoc, type StudioDoc } from "../schema";
import { clampProductModel, type ProductModel } from "./schema";

export type PrivateDesign = {
  id: string;
  /** The current model (after the solver's homes; after a vision patch until the next check). */
  model: ProductModel;
  solvedHash?: string;
  /** Vision score (1–10) of the best checked version, Engineer view only. */
  score?: number;
  loops?: number;
  looksLike?: string;
  missing?: string[];
  /** Solver / clamp / patch notes (Engineer view). */
  issues?: unknown[];
  source: "ai" | "default";
  /** The best-scoring checked version; the final picture and the CAD use it. */
  best?: { model: ProductModel; score: number };
};

export type ProductPrivate = { designs: PrivateDesign[] };

/** Cap of the private part (the page doc keeps its own 256 kB cap). */
export const PRIVATE_MAX_BYTES = 192 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseDesign(v: unknown): PrivateDesign | null {
  if (!isObj(v) || typeof v.id !== "string" || !isObj(v.model)) return null;
  const out: PrivateDesign = {
    id: v.id,
    model: clampProductModel(v.model),
    source: v.source === "ai" ? "ai" : "default",
  };
  if (typeof v.solvedHash === "string") out.solvedHash = v.solvedHash;
  const score = num(v.score);
  if (score !== undefined) out.score = score;
  const loops = num(v.loops);
  if (loops !== undefined) out.loops = loops;
  if (typeof v.looksLike === "string") out.looksLike = v.looksLike.slice(0, 200);
  if (Array.isArray(v.missing)) out.missing = v.missing.filter((m): m is string => typeof m === "string").slice(0, 12);
  if (Array.isArray(v.issues)) out.issues = v.issues.slice(0, 60);
  if (isObj(v.best) && isObj(v.best.model) && num(v.best.score) !== undefined) {
    out.best = { model: clampProductModel(v.best.model), score: num(v.best.score)! };
  }
  return out;
}

/** A stored productPrivate value → a valid one (unreadable designs dropped); null when absent. */
export function parseProductPrivate(v: unknown): ProductPrivate | null {
  if (!isObj(v) || !Array.isArray(v.designs)) return null;
  return { designs: v.designs.map(parseDesign).filter((d): d is PrivateDesign => d !== null) };
}

/** A stored product value → the page-safe ProductDoc, or null. */
export function parseProductDoc(v: unknown): ProductDoc | null {
  const r = ProductDocSchema.safeParse(v);
  return r.success ? r.data : null;
}

export type ServerOwned = { product: ProductDoc | null; productPrivate: ProductPrivate | null };

/** The server-owned keys of a stored projects.studio value. */
export function serverOwnedOf(stored: unknown): ServerOwned {
  const o = isObj(stored) ? stored : {};
  return { product: parseProductDoc(o.product), productPrivate: parseProductPrivate(o.productPrivate) };
}

/**
 * What a doc save writes: the page's doc with the server-owned keys replaced by
 * the stored ones (a page can't erase, forge or unlock anything). Any
 * `productPrivate` / `product` the page sent is ignored.
 */
export function mergeServerOwned(doc: StudioDoc, owned: ServerOwned): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  delete out.product;
  delete out.productPrivate;
  if (owned.product) out.product = owned.product;
  if (owned.productPrivate) out.productPrivate = trimPrivate(owned.productPrivate);
  return out;
}

/** The page-safe view of a stored studio value (what a response may carry). */
export function stripServerOnly<T extends Record<string, unknown>>(stored: T): Omit<T, "productPrivate"> {
  const rest: Record<string, unknown> = { ...stored };
  delete rest.productPrivate;
  return rest as Omit<T, "productPrivate">;
}

/** Drop the oldest designs until the private part fits PRIVATE_MAX_BYTES. */
export function trimPrivate(p: ProductPrivate, keep: readonly string[] = []): ProductPrivate {
  const designs = [...p.designs];
  const size = () => Buffer.byteLength(JSON.stringify({ designs }), "utf8");
  while (designs.length > 1 && size() > PRIVATE_MAX_BYTES) {
    const i = designs.findIndex((d) => !keep.includes(d.id));
    if (i < 0) break;
    designs.splice(i, 1);
  }
  return { designs };
}

/** The model the picture / CAD use: the best checked version, else the current one. */
export const finalModel = (d: PrivateDesign): ProductModel => d.best?.model ?? d.model;
