"use client";

// P5-16 Phase 2b: the product designs, owned by the Studio shell so they keep
// running in the background while the visitor is on another step.
//
//  * useProductPreviews: right after Parts (the shell says when) the worker
//    designs 2–3 products, checks them and sends back PICTURES only. Keyed by
//    productSpecHash(spec, parts) — the same idea as the W8 cache: going back
//    and forward never redesigns; a changed spec or parts list does. A doc that
//    already has ready designs for this key shows their stored pictures.
//  * useUnlockedProduct: after "Create my CAD" the worker hands over the meshes
//    for the interactive viewer, the Print step's STLs and "Get it made".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StudioApi } from "@/lib/studio/client/api";
import {
  loadUnlockedProduct,
  partsInput,
  productPreviewSupported,
  runProductPreviews,
  warmProductWorker,
  type ProductEvent,
  type ProductUnlockResult,
} from "@/lib/studio/client/product";
import type { ProductStage, ProductWhy } from "@/lib/studio/geometry/protocol";
import type { Archetype } from "@/lib/studio/product/schema";
import { productSpecHash } from "@/lib/studio/product/spec-hash";
import type { ProductFailure } from "@/lib/studio/product/failure";
import type { LibraryPart, StudioDoc, StudioProduct, StudioProductDesign } from "@/lib/studio/schema";

/** Where the visitor's finish for the printed bodies is kept (doc.answers). */
export const PRODUCT_FINISH_KEY = "product:finish";

export type ProductCard = {
  id: string;
  archetype: Archetype;
  why: ProductWhy;
  status: "building" | "ready" | "failed";
  /** A blob: URL (made this visit) or a stored picture's URL; null until known. */
  url: string | null;
  previewPath: string | null;
};

export type ProductPhase = "idle" | "running" | "ready" | "failed" | "unsupported" | "guest_limit" | "sign_in" | "no_tokens";

export type ProductPreviews = {
  /** The Studio has the product pipeline (api.product). */
  enabled: boolean;
  phase: ProductPhase;
  stage: ProductStage | null;
  cards: ProductCard[];
  /** productSpecHash of the doc the cards belong to. */
  key: string;
  /**
   * Three NEW designs. With `feedback` they are steered by what the visitor says is wrong (the same
   * archetypes may come back, changed); without it they use archetypes not shown yet. The shown
   * designs are never modified. The first regeneration is free, later ones cost ideation tokens.
   */
  tryAnother(feedback?: string): void;
  /** Regenerations made on this project so far (0 = the next one is free). */
  regens: number;
  /** The designs (and pictures) to keep in the doc. */
  choose(designId: string): void;
  /** F-009: why no pictures could be made (null while there is no failure). */
  failure: ProductFailure | null;
  /** F-009: draw the pictures again after a failure. */
  retry(): void;
};

type ProductUpdate = (prev: StudioProduct | undefined) => StudioProduct;

const toDocDesign = (c: ProductCard): StudioProductDesign => ({
  id: c.id,
  archetype: c.archetype,
  why: c.why,
  previewPath: c.previewPath,
  status: c.status,
});

export function useProductPreviews({
  api,
  doc,
  getPart,
  active,
  onProduct,
}: {
  api: StudioApi;
  doc: StudioDoc | null;
  getPart: (id: string) => LibraryPart | undefined;
  /** The visitor has moved past Parts (the shell decides). */
  active: boolean;
  onProduct: (update: ProductUpdate) => void;
}): ProductPreviews {
  const product = api.product;
  const enabled = !!product;
  const key = useMemo(() => (doc && doc.components.length ? productSpecHash(doc.spec, doc.components) : ""), [doc]);
  const [phase, setPhase] = useState<ProductPhase>("idle");
  const [stage, setStage] = useState<ProductStage | null>(null);
  const [cards, setCards] = useState<ProductCard[]>([]);
  const [cardsKey, setCardsKey] = useState("");
  const [failure, setFailure] = useState<ProductFailure | null>(null);
  const runId = useRef(0);
  const startedKey = useRef<string | null>(null);
  const [regensSeen, setRegensSeen] = useState(0);
  const excluded = useRef<Set<Archetype>>(new Set());
  const blobs = useRef<string[]>([]);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(
    () => () => {
      for (const u of blobs.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const run = useCallback(
    async (exclude: Archetype[], previous: ProductCard[] = [], feedback = "") => {
      const d = docRef.current;
      if (!product || !d || !d.components.length) return;
      const id = ++runId.current;
      const runKey = productSpecHash(d.spec, d.components);
      const live = () => runId.current === id;
      setPhase("running");
      setFailure(null);
      setStage("designing");
      setCards([]);
      setCardsKey(runKey);
      const got: ProductCard[] = [];
      const onEvent = (e: ProductEvent) => {
        if (!live()) return;
        if (e.kind === "productProgress") {
          setStage(e.stage);
          return;
        }
        const url = URL.createObjectURL(new Blob([e.png], { type: "image/png" }));
        blobs.current.push(url);
        const card: ProductCard = { id: e.designId, archetype: e.archetype, why: e.why, status: "ready", url, previewPath: e.previewPath };
        got.push(card);
        setCards((prev) => [...prev.filter((c) => c.id !== card.id), card]);
      };
      try {
        const result = await runProductPreviews(
          {
            projectId: api.projectId,
            count: 3,
            ...(exclude.length ? { exclude } : {}),
            ...(feedback ? { feedback } : {}),
            spec: d.spec,
            parts: partsInput(d, getPart),
            apiBase: product.base,
            mock: product.mock,
          },
          onEvent,
        );
        if (!live()) return;
        setStage(null);
        if (typeof result.regens === "number") setRegensSeen((n) => Math.max(n, result.regens as number));
        const ready = result.designs.filter((x) => x.status === "ready");
        if (!ready.length && previous.length) {
          // "Try another" found nothing new (all archetypes shown, limit, an outage): keep the pictures shown.
          setCards(previous);
          setPhase(result.error === "guest_limit" ? "guest_limit" : result.error === "sign_in" ? "sign_in" : result.error === "no_tokens" ? "no_tokens" : "ready");
          return;
        }
        if (result.error === "no_render") {
          setPhase(got.length ? "ready" : "unsupported");
          if (!got.length) setFailure("browser");
        }
        else if (result.error === "guest_limit") setPhase("guest_limit");
        else if (result.error === "sign_in") setPhase("sign_in");
        else if (result.error === "no_tokens") setPhase("no_tokens");
        else {
          setPhase(ready.length ? "ready" : "failed");
          if (!ready.length) setFailure(result.reason ?? "service");
        }
        if (!ready.length) return;
        // Keep the page-safe part in the doc (pictures, why, status). The first design is chosen.
        const byId = new Map(got.map((c) => [c.id, c]));
        const designs: StudioProductDesign[] = result.designs.map((x) => toDocDesign(byId.get(x.id) ?? { ...x, url: null }));
        const stored = docRef.current?.product;
        const keep = stored && stored.specHash === runKey ? stored : undefined;
        const chosen = keep?.chosenId && designs.some((x) => x.id === keep.chosenId) ? keep.chosenId : ready[0].id;
        onProduct((prev) => {
          const kept = prev && prev.specHash === runKey ? prev : undefined;
          return {
            designs,
            chosenId: chosen,
            unlockedId: kept?.unlockedId ?? null,
            specHash: runKey,
            ...(prev?.regens !== undefined ? { regens: prev.regens } : {}),
          };
        });
        void product.choose(chosen).catch(() => undefined);
      } catch {
        // No worker at all: the Enclosure step keeps the template flow (or the pictures already shown).
        if (live()) {
          setStage(null);
          if (previous.length) {
            setCards(previous);
            setPhase("ready");
          } else {
            setPhase("unsupported");
            setFailure("worker");
          }
        }
      }
    },
    [api.projectId, getPart, onProduct, product],
  );

  // Start in the background once the visitor has left Parts; once per spec + parts.
  useEffect(() => {
    if (!enabled || !active || !key || startedKey.current === key) return;
    if (!productPreviewSupported()) {
      startedKey.current = key;
      setPhase("unsupported");
      setFailure("browser");
      return;
    }
    startedKey.current = key;
    excluded.current = new Set();
    const stored = docRef.current?.product;
    // A paid design is never redesigned in the background (changes after "Create my CAD" are not automatic).
    if (stored?.unlockedId) {
      setCards(stored.designs.filter((x) => x.status === "ready").map((x) => ({ ...x, url: null })));
      setCardsKey(key);
      setPhase("ready");
      return;
    }
    if (stored && stored.specHash === key && stored.designs.some((x) => x.status === "ready")) {
      // Already designed for this spec (a reload, another device): show the stored pictures.
      const list: ProductCard[] = stored.designs.filter((x) => x.status === "ready").map((x) => ({ ...x, url: null }));
      setCards(list);
      setCardsKey(key);
      setPhase("ready");
      for (const x of list) excluded.current.add(x.archetype);
      void (async () => {
        const urls = await Promise.all(list.map((x) => (x.previewPath ? product!.previewUrl(x.previewPath).catch(() => null) : Promise.resolve(null))));
        if (startedKey.current !== key) return;
        if (urls.every((u) => !u)) {
          // Pictures not reachable (no storage URL): draw them again — same models, worker cache.
          void run([]);
          return;
        }
        setCards((prev) => prev.map((c, i) => ({ ...c, url: urls[i] ?? c.url })));
      })();
      return;
    }
    void warmProductWorker().catch(() => undefined);
    void run([]);
  }, [enabled, active, key, run, product]);

  const tryAnother = useCallback(
    (feedback?: string) => {
      if (phase === "running") return;
      const text = feedback?.trim() ?? "";
      if (text) {
        // Feedback steers a fresh set (the same archetypes, changed); the shown designs stay as they are.
        void run([], cards, text);
        return;
      }
      for (const c of cards) excluded.current.add(c.archetype);
      // Every archetype seen: start again from the best ones.
      if (excluded.current.size >= 11) excluded.current = new Set(cards.map((c) => c.archetype));
      void run([...excluded.current], cards);
    },
    [cards, phase, run],
  );

  const retry = useCallback(() => {
    if (phase === "running") return;
    void run([]);
  }, [phase, run]);

  const choose = useCallback(
    (designId: string) => {
      onProduct((prev) => ({
        designs: prev?.designs ?? cards.map(toDocDesign),
        chosenId: designId,
        unlockedId: prev?.unlockedId ?? null,
        specHash: prev?.specHash ?? key,
        ...(prev?.regens !== undefined ? { regens: prev.regens } : {}),
      }));
      void product?.choose(designId).catch(() => undefined);
    },
    [cards, key, onProduct, product],
  );

  return {
    enabled,
    phase,
    stage,
    cards: cardsKey === key ? cards : [],
    key,
    regens: Math.max(regensSeen, doc?.product?.regens ?? 0),
    tryAnother,
    choose,
    failure,
    retry,
  };
}

// ---------------------------------------------------------------------------
// After "Create my CAD"
// ---------------------------------------------------------------------------

export type UnlockedProduct = { status: "idle" | "loading" | "ready" | "failed"; data: ProductUnlockResult | null };

const unlockedCache = new Map<string, Promise<ProductUnlockResult>>();

export function useUnlockedProduct({
  api,
  doc,
  getPart,
  active,
}: {
  api: StudioApi;
  doc: StudioDoc | null;
  getPart: (id: string) => LibraryPart | undefined;
  active: boolean;
}): UnlockedProduct {
  const product = api.product;
  const designId = doc?.product?.unlockedId ?? null;
  const specHash = doc?.product?.specHash ?? "";
  const cacheKey = designId ? `${api.projectId}:${specHash}:${designId}` : "";
  const [state, setState] = useState<{ key: string; value: UnlockedProduct }>({ key: "", value: { status: "idle", data: null } });
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!product || !cacheKey || !designId || !active) return;
    const d = docRef.current;
    if (!d) return;
    let alive = true;
    let p = unlockedCache.get(cacheKey);
    if (!p) {
      p = loadUnlockedProduct({
        projectId: api.projectId,
        designId,
        spec: d.spec,
        parts: partsInput(d, getPart),
        apiBase: product.base,
        mock: product.mock,
      });
      unlockedCache.set(cacheKey, p);
      p.catch(() => unlockedCache.delete(cacheKey));
    }
    setState((s) => (s.key === cacheKey && s.value.status === "ready" ? s : { key: cacheKey, value: { status: "loading", data: null } }));
    p.then(
      (data) => alive && setState({ key: cacheKey, value: { status: "ready", data } }),
      () => alive && setState({ key: cacheKey, value: { status: "failed", data: null } }),
    );
    return () => {
      alive = false;
    };
  }, [active, api.projectId, cacheKey, designId, getPart, product]);

  return state.key === cacheKey && cacheKey ? state.value : { status: designId ? "loading" : "idle", data: null };
}
