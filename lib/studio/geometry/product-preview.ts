// The free preview pictures, "Create my CAD" and the per-body STLs (P5-16
// Phase 2b), run INSIDE the Studio geometry worker.
//
//  productPreview: POST {apiBase}/design → for each design: solveProduct
//    (pure) → build (manifold kernel, cached by solved hash) → three 512 px views
//    in the scene → POST /check (vision) — at most 2 more loops while the score
//    is < 7 and the check changed the model; the best-scoring model wins →
//    final 3/4 picture (1024 px) → POST /preview. The page receives progress
//    ("designing" / "checking" / "polishing", never a score) and the PNG bytes.
//    NO model JSON and NO geometry ever leave the worker here.
//  productUnlocked: after "Create my CAD": GET /model (the server answers only
//    for the unlocked design) → solve → build (usually a cache hit) → meshes.
//  productStl: STL bytes per printable piece (+ one plate file) of a product
//    this worker already built for an unlocked design.
//
// Dependencies are injected (http, build, render) so the loop logic is unit-tested
// in node without WebGL or network; the e2e fixture swaps http for a mock.

import { solveProduct, type SolvedProduct } from "../product/solve";
import { clampProductModel, type Archetype, type ProductModel } from "../product/schema";
import { binarySTL, printReadyPositions } from "../product/stl";
import type { LayoutInput } from "../layout";
import type { BuiltProduct } from "./product-kernel";
import type {
  ProductEvent,
  ProductPreviewDesign,
  ProductPreviewInput,
  ProductPreviewResult,
  ProductStlFile,
  ProductStlResult,
  ProductUnlockInput,
  ProductWhy,
} from "./protocol";
import type { RenderShot, SolvedStage } from "./product-render";

/** A score at or above this is good enough (no more vision loops). */
export const GOOD_SCORE = 7;
/** Extra check loops after the first one (spec: "max 2 loops"). */
export const MAX_LOOPS = 2;
export const CHECK_SIZE = 512;
export const PICTURE_SIZE = 1024;

export type HttpReply = { status: number; data: Record<string, unknown> };
export type Http = (path: string, init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> }) => Promise<HttpReply>;

export type PreviewDeps = {
  http: Http;
  build(solved: SolvedProduct): Promise<BuiltProduct>;
  render(built: BuiltProduct, solved: SolvedStage, shots: RenderShot[]): Promise<ArrayBuffer[]>;
  canRender(): boolean;
  now(): number;
};

/** Same-origin JSON over fetch (the visitor's cookies go with it). Never throws. */
export function fetchHttp(apiBase: string): Http {
  return async (path, init) => {
    const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
    try {
      const res = await fetch(`${apiBase}${path}${qs}`, {
        method: init.method,
        credentials: "same-origin",
        cache: "no-store",
        headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, data };
    } catch {
      return { status: 0, data: { error: "network" } };
    }
  };
}

/** base64 of bytes, in chunks (btoa exists in workers and node ≥ 16). */
export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function whyOf(v: unknown): ProductWhy {
  const o = isObj(v) ? v : {};
  const t = (x: unknown) => (typeof x === "string" ? x.slice(0, 200) : "");
  return { en: t(o.en), ar: t(o.ar) };
}

type Candidate = { model: ProductModel; solved: SolvedProduct; built: BuiltProduct; score: number | null; loop: number };

const partsOf = (input: { parts: ProductPreviewInput["parts"] }): LayoutInput[] => input.parts.map(([instanceId, part]) => ({ instanceId, part }));

/**
 * One design: build, check (≤ 1 + MAX_LOOPS times), keep the best, render its picture, upload it.
 * Returns the picture bytes and the stored path. Throws when the design cannot be built at all.
 */
async function designOne(
  input: ProductPreviewInput,
  d: { id: string; model: unknown },
  emit: (e: ProductEvent) => void,
  deps: PreviewDeps,
  index: number,
  total: number,
): Promise<{ png: ArrayBuffer; previewPath: string | null; best: Candidate }> {
  const parts = partsOf(input);
  let model = clampProductModel(d.model);
  let best: Candidate | null = null;
  for (let loop = 0; loop <= MAX_LOOPS; loop++) {
    const solved = solveProduct(model, parts, { spec: input.spec });
    const built = await deps.build(solved);
    emit({ kind: "productProgress", stage: "checking", designId: d.id, index, total });
    const [front, side, iso] = await deps.render(built, solved, [
      { view: "front", size: CHECK_SIZE },
      { view: "side", size: CHECK_SIZE },
      { view: "iso", size: CHECK_SIZE },
    ]);
    const c = await deps.http("/check", {
      method: "POST",
      body: {
        projectId: input.projectId,
        designId: d.id,
        images: { front: bytesToBase64(front), side: bytesToBase64(side), iso: bytesToBase64(iso) },
        loop,
      },
    });
    const ok = c.status >= 200 && c.status < 300 && !c.data.error;
    const score = ok && typeof c.data.score === "number" && Number.isFinite(c.data.score) ? Math.max(1, Math.min(10, c.data.score)) : null;
    const cur: Candidate = { model, solved, built, score, loop };
    // No score (quota, no key, a failed call): keep what we have — never loop blindly.
    if (score === null) {
      best ??= cur;
      break;
    }
    if (!best || best.score === null || score > best.score) best = cur;
    if (score >= GOOD_SCORE || c.data.changed !== true || loop === MAX_LOOPS || !isObj(c.data.model)) break;
    model = clampProductModel(c.data.model);
  }
  const chosen = best as Candidate;
  emit({ kind: "productProgress", stage: "polishing", designId: d.id, index, total });
  const [png] = await deps.render(chosen.built, chosen.solved, [{ view: "iso", size: PICTURE_SIZE }]);
  // The server keeps the picture (and which loop it shows) for My projects / the quote / the admin lead.
  const pv = await deps.http("/preview", {
    method: "POST",
    body: { projectId: input.projectId, designId: d.id, png: bytesToBase64(png), loop: chosen.loop, solvedHash: chosen.solved.hash },
  });
  const previewPath = pv.status >= 200 && pv.status < 300 && typeof pv.data.previewPath === "string" ? pv.data.previewPath : null;
  return { png, previewPath, best: chosen };
}

/** The whole preview job. Never throws: failures come back as `error` / failed designs. */
export async function runProductPreview(input: ProductPreviewInput, emit: (e: ProductEvent) => void, deps: PreviewDeps): Promise<ProductPreviewResult> {
  const t0 = deps.now();
  const ms = () => Math.round(deps.now() - t0);
  if (!deps.canRender()) return { designs: [], error: "no_render", ms: ms() };
  emit({ kind: "productProgress", stage: "designing" });
  const r = await deps.http("/design", {
    method: "POST",
    body: {
      projectId: input.projectId,
      count: Math.max(1, Math.min(3, Math.round(input.count))),
      ...(input.exclude?.length ? { exclude: input.exclude } : {}),
      ...(input.feedback?.trim() ? { feedback: input.feedback.trim().slice(0, 400) } : {}),
    },
  });
  if (r.status === 429 || r.data.error === "guest_limit") return { designs: [], error: "guest_limit", ms: ms() };
  if (r.status === 401 || r.data.error === "sign_in") return { designs: [], error: "sign_in", ms: ms() };
  if (r.status === 402 || r.data.error === "no_tokens") return { designs: [], error: "no_tokens", ms: ms() };
  const regens = typeof r.data.regens === "number" ? r.data.regens : undefined;
  const raw = Array.isArray(r.data.designs) ? (r.data.designs as unknown[]).filter(isObj) : [];
  if (r.status < 200 || r.status >= 300 || raw.length === 0) return { designs: [], error: "failed", ms: ms() };

  const designs: ProductPreviewDesign[] = [];
  const list = raw.slice(0, 3);
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const id = typeof d.id === "string" ? d.id.slice(0, 64) : `d${i + 1}`;
    const archetype = (typeof d.archetype === "string" ? d.archetype : clampProductModel(d.model).archetype) as Archetype;
    const why = whyOf(d.why);
    const t = deps.now();
    try {
      const { png, previewPath, best } = await designOne(input, { id, model: d.model }, emit, deps, i, list.length);
      emit({ kind: "productPicture", designId: id, archetype: best.model.archetype, why, previewPath, png, ms: Math.round(deps.now() - t) });
      designs.push({ id, archetype: best.model.archetype, why, previewPath, status: "ready" });
    } catch (err) {
      console.warn("[studio product] design failed", id, err instanceof Error ? err.message : err);
      if (err instanceof Error && err.message === "no_render") return { designs, error: "no_render", ms: ms(), ...(regens !== undefined ? { regens } : {}) };
      designs.push({ id, archetype, why, previewPath: null, status: "failed" });
    }
  }
  return { designs, ...(designs.some((d) => d.status === "ready") ? {} : { error: "failed" as const }), ms: ms(), ...(regens !== undefined ? { regens } : {}) };
}

/** After "Create my CAD": the unlocked model from the server, solved and built (geometry stays for the caller to pack). */
export async function loadUnlockedProduct(
  input: ProductUnlockInput,
  deps: Pick<PreviewDeps, "http" | "build">,
): Promise<{ solved: SolvedProduct; built: BuiltProduct }> {
  const r = await deps.http("/model", { method: "GET", query: { projectId: input.projectId, designId: input.designId } });
  if (r.status < 200 || r.status >= 300 || !isObj(r.data.model)) {
    throw new Error(typeof r.data.error === "string" ? r.data.error : `model_${r.status}`);
  }
  const solved = solveProduct(clampProductModel(r.data.model), partsOf(input), { spec: input.spec });
  const built = await deps.build(solved);
  return { solved, built };
}

const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "part";

/** STL per printable piece (print pose, on the bed) + one plate file with every piece side by side. */
export function productStlFiles(built: BuiltProduct, name: string): ProductStlResult {
  const base = fileSafe(name);
  const printable = built.pieces.filter((p) => p.printable);
  const files: ProductStlFile[] = printable.map((p) => {
    const positions = printReadyPositions(p.positions, p.print.matrix);
    return {
      id: p.id,
      bodyId: p.bodyId,
      piece: p.piece,
      role: p.role,
      material: p.material,
      grams: p.grams,
      name: `${base}-${fileSafe(p.id)}.stl`,
      data: binarySTL({ positions, indices: p.indices }, p.id),
    };
  });
  if (!printable.length) return { files, combined: null };
  // Plate: every piece in its print pose, left to right with a 10 mm gap.
  const parts = printable.map((p) => printReadyPositions(p.positions, p.print.matrix));
  let total = 0;
  let tris = 0;
  for (let i = 0; i < parts.length; i++) {
    total += parts[i].length;
    tris += printable[i].indices.length;
  }
  const positions = new Float32Array(total);
  const indices = new Uint32Array(tris);
  let x = 0;
  let vo = 0;
  let io = 0;
  for (let i = 0; i < parts.length; i++) {
    const pos = parts[i];
    let minX = Infinity;
    let maxX = -Infinity;
    for (let k = 0; k < pos.length; k += 3) {
      if (pos[k] < minX) minX = pos[k];
      if (pos[k] > maxX) maxX = pos[k];
    }
    const shift = x - minX;
    for (let k = 0; k < pos.length; k += 3) {
      positions[vo + k] = pos[k] + shift;
      positions[vo + k + 1] = pos[k + 1];
      positions[vo + k + 2] = pos[k + 2];
    }
    const idx = printable[i].indices;
    const vBase = vo / 3;
    for (let k = 0; k < idx.length; k++) indices[io + k] = idx[k] + vBase;
    vo += pos.length;
    io += idx.length;
    x += maxX - minX + 10;
  }
  return { files, combined: { name: `${base}-all-parts.stl`, data: binarySTL({ positions, indices }, "all-parts") } };
}
