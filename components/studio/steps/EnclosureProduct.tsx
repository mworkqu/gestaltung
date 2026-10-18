"use client";

// Step 4 · Your product (P5-16 Phase 2b). The Studio designs the real product
// (stake, head, light ring, tank…) instead of a box:
//
//  * The designs start by themselves in the background right after Parts
//    (components/studio/use-product.ts); this step shows 2–3 PICTURES of the
//    real model in its scene, each with "Why this design". Tap one to choose
//    it; "Try another" asks for different designs. While they are made the
//    only words are "Designing… / Checking… / Polishing…" — never a score.
//  * Before "Create my CAD" the page has pictures only: no 3D view, no model,
//    no STL. "Create my CAD (1 credit)" spends the CAD credit exactly like the
//    enclosure did (sign in / out of credits → the usual AccessNote); then the
//    interactive viewer opens in the same scene, with "Take it apart" (bodies +
//    electronics), the finishes and "Share a picture".
//  * Guests: after today's free designs, "Sign in to see more designs" (W1
//    return path). super_admin also gets the Engineer view.
//  * The 3D engine (three + R3F + the viewer) downloads only after "Create my CAD"
//    succeeded (owner 2026-10-11). A visitor who CAN open it (enough CAD credits,
//    or super_admin) gets it prefetched while the browser is idle on this step;
//    no credits / not signed in = never fetched. The animated loader covers the
//    pictures being made and the engine + model opening.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { cadCost, studioCadTier } from "@/lib/credits/cad-cost";
import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { ProductViewer, ProductViewerLoading, preloadProductViewer } from "@/components/studio/viewer/ProductViewerLazy";
import type { ViewerApi } from "@/components/studio/viewer/types";
import { track } from "@/lib/analytics";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { FINISHES, type Finish, type StudioDoc, type StudioProduct } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import { useStudioLibrary } from "../StudioLibraryProvider";
import type { StudioCtx } from "../StudioShell";
import { PRODUCT_FINISH_KEY, type ProductCard, type ProductPreviews, type UnlockedProduct } from "../use-product";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";
import { ShareActions } from "./share";
import { accessReason, problemKey } from "./problem";
import { ProductEngineer } from "./ProductEngineer";
import { StudioLoader } from "../StudioLoader";

const accent = STEP_ACCENT.enclosure;
/** "Take it apart" opens this far at once (the slider then goes 0–1). */
const APART_DEFAULT = 0.7;

export function EnclosureProduct({
  ctx,
  doc,
  previews,
  unlocked,
  beforeServer,
  onProduct,
  onFinish,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  previews: ProductPreviews;
  unlocked: UnlockedProduct;
  beforeServer: () => Promise<void>;
  onProduct: (update: (prev: StudioProduct | undefined) => StudioProduct) => void;
  onFinish: (finish: Finish) => void;
  onNext: () => void;
}) {
  const t = useTranslations("Studio");
  const { getPart } = useStudioLibrary();
  const { locale } = ctx;
  const access = useCanUse("cad", ctx.api.mode === "live" ? ctx.projectId : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [apart, setApart] = useState(false);
  const [explode, setExplode] = useState(0);
  const viewer = useRef<ViewerApi | null>(null);

  const product = doc.product;
  const unlockedId = product?.unlockedId ?? null;
  const cards = previews.cards;
  const ready = cards.filter((c) => c.status === "ready");
  const chosenId = product?.chosenId && cards.some((c) => c.id === product.chosenId) ? product.chosenId : (ready[0]?.id ?? null);
  const running = previews.phase === "running" || previews.phase === "idle";
  const finish = (doc.answers?.[PRODUCT_FINISH_KEY] as Finish | undefined) ?? null;

  // Smart prefetch: only for someone the unlock will let through (the credits hook the
  // step already reads; no extra request). Idle time, so the pictures come first.
  const canOpen = !!ctx.isAdmin || access?.allowed === true;
  useEffect(() => {
    if (unlockedId || !canOpen || !chosenId) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadProductViewer, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preloadProductViewer, 1500);
    return () => window.clearTimeout(id);
  }, [unlockedId, canOpen, chosenId]);

  const nameOf = (c: Pick<ProductCard, "archetype">) => t(`product.name_${c.archetype}`);
  const whyOf = (c: Pick<ProductCard, "archetype" | "why">) => c.why[locale]?.trim() || t(`product.why_${c.archetype}`);

  async function createCad() {
    setProblem(null);
    setBlocked(null);
    const api = ctx.api.product;
    if (!api || !chosenId) return;
    if (access && !access.allowed && access.reason) {
      setBlocked(access.reason);
      return;
    }
    setBusy(true);
    await beforeServer();
    const r = await api.unlock(chosenId);
    setBusy(false);
    if (!r.ok) {
      const reason = accessReason(r);
      if (reason) setBlocked(reason);
      else setProblem(t(problemKey(r)));
      return;
    }
    track("cad_generated");
    creditsChanged();
    onProduct((prev) => ({
      designs: prev?.designs ?? [],
      specHash: prev?.specHash ?? previews.key,
      chosenId,
      unlockedId: r.data.unlockedId || chosenId,
    }));
  }

  function toggleApart() {
    const next = !apart;
    setApart(next);
    setExplode(next ? APART_DEFAULT : 0);
  }

  const createLabel =
    access?.cost === "none"
      ? t("product.createCadNoCost")
      : access?.cost === "included"
        ? t("product.createCadIncluded")
        : t("product.createCad", { n: cadCost(studioCadTier(doc.components.length)) });
  const progress = previews.stage ? t(`product.progress_${previews.stage}`) : running ? t("product.progress_designing") : "";

  // ── After "Create my CAD": the product in 3D ─────────────────────────────
  if (unlockedId) {
    const data = unlocked.data;
    return (
      <StepFrame
        step="enclosure"
        n={ctx.n("enclosure")}
        title={t("title_enclosure")}
        headline={t("product.headlineOpen")}
        intro={t("product.introOpen")}
        footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
        secondary={<ShareActions ctx={ctx} viewer={viewer} accent={accent.base} disabled={unlocked.status !== "ready"} />}
      >
        <div className="relative h-[340px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[460px]" data-testid="studio-product-viewer">
          {data ? (
            <ProductViewer
              product={data}
              getPart={getPart}
              explode={apart ? explode : 0}
              finish={finish}
              ariaLabel={t("product.viewerLabel")}
              onReady={(api) => {
                viewer.current = api;
              }}
            />
          ) : unlocked.status === "failed" ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <Problem>{t("failed")}</Problem>
            </div>
          ) : (
            <ProductViewerLoading />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="studio-explode">
          <button
            type="button"
            onClick={toggleApart}
            aria-pressed={apart}
            disabled={!data}
            data-testid="studio-take-apart"
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60",
              apart ? "text-white" : "bg-panel text-heading shadow-neu-sm hover:bg-white",
            )}
            style={apart ? { background: accent.ink } : undefined}
          >
            <Layers className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("takeApart")}
          </button>
          {apart && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
              aria-label={t("shape.apartAmount")}
              className="h-11 min-w-0 flex-1 basis-40 cursor-pointer"
              style={{ accentColor: accent.ink }}
            />
          )}
          {apart && <p className="w-full text-xs text-mutedtext">{t("product.apartNote")}</p>}
        </div>

        {product && <ChosenWhy card={product.designs.find((d) => d.id === unlockedId) ?? null} nameOf={nameOf} whyOf={whyOf} label={t("product.whyLabel")} />}

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-heading">{t("finish")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("finish")}>
            {FINISHES.map((f) => {
              const on = finish === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onFinish(f)}
                  className={cn("min-h-11 rounded-full px-4 text-sm font-semibold transition-colors", on ? "text-white" : "bg-panel text-heading hover:bg-white")}
                  style={on ? { background: accent.ink } : undefined}
                >
                  {t(`finish_${f}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {ctx.isAdmin && <ProductEngineer ctx={ctx} doc={doc} />}
      </StepFrame>
    );
  }

  // ── Before payment: pictures only ────────────────────────────────────────
  const placeholders = running ? Math.max(0, 3 - cards.length) : 0;
  const limit = previews.phase === "guest_limit";
  return (
    <StepFrame
      step="enclosure"
      n={ctx.n("enclosure")}
      title={t("title_enclosure")}
      headline={t("product.headline")}
      intro={t("product.intro")}
      footer={
        <MainButton onClick={() => void createCad()} disabled={busy || !chosenId} data-testid="studio-create-cad">
          {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          {busy ? t("product.opening") : createLabel}
        </MainButton>
      }
      secondary={
        cards.length > 0 || !running ? (
          <button type="button" className={linkCls} onClick={previews.tryAnother} disabled={running || busy || limit} data-testid="studio-try-another">
            <RefreshCw className={cn("h-4 w-4", running && "motion-safe:animate-spin")} strokeWidth={1.75} aria-hidden />
            {t("product.tryAnother")}
          </button>
        ) : null
      }
    >
      <p
        role="status"
        aria-live="polite"
        className={cn("min-h-6 text-sm font-semibold", !running && "sr-only")}
        style={{ color: accent.ink }}
        data-testid="studio-product-progress"
        data-stage={previews.stage ?? ""}
      >
        {running ? progress : ""}
      </p>

      {busy ? (
        <div className="grid min-h-[260px] place-items-center rounded-[24px] shadow-neu-inset">
          <StudioLoader label={t("loader.cad")} accent={accent.base} ink={accent.ink} testId="studio-cad-loader" />
        </div>
      ) : running && cards.length === 0 ? (
        <div className="grid min-h-[260px] place-items-center rounded-[24px] shadow-neu-inset" data-testid="studio-product-loading">
          <StudioLoader label={t("loader.pictures")} accent={accent.base} ink={accent.ink} status={false} />
        </div>
      ) : null}

      <div
        hidden={busy || (running && cards.length === 0)}
        role="radiogroup"
        aria-label={t("product.picturesLabel")}
        data-testid="studio-product-pictures"
        data-phase={previews.phase}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 max-sm:-mx-5 max-sm:px-5 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0"
      >
        {cards.map((c, i) => (
          <PictureCard
            key={c.id}
            card={c}
            n={i + 1}
            on={c.id === chosenId}
            name={nameOf(c)}
            why={whyOf(c)}
            whyLabel={t("product.whyLabel")}
            alt={t("product.pictureAlt", { name: nameOf(c), n: String(i + 1) })}
            onChoose={() => previews.choose(c.id)}
          />
        ))}
        {Array.from({ length: placeholders }, (_, i) => (
          <div key={`ph${i}`} aria-hidden className="w-[78%] shrink-0 snap-start space-y-2 sm:w-auto" data-testid="studio-product-placeholder">
            <Bar className="aspect-square h-auto w-full rounded-2xl" />
            <Bar className="h-3.5 w-1/2" />
            <Bar className="h-3 w-5/6" />
          </div>
        ))}
      </div>

      {limit && (
        <div className="tile flex flex-wrap items-center justify-between gap-2 p-4" data-testid="studio-product-limit">
          <p className="text-sm text-body">{t("product.guestLimitText")}</p>
          <AuthReturnLink className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt hover:text-cobalt-hover">
            {t("product.guestLimit")}
          </AuthReturnLink>
        </div>
      )}
      {previews.phase === "sign_in" && <AccessNote reason="sign_in" step="cad" projectName={ctx.projectName} />}
      {problem && <Problem>{problem}</Problem>}
      {blocked && <AccessNote reason={blocked} step="cad" projectName={ctx.projectName} />}
      {ctx.isAdmin && <ProductEngineer ctx={ctx} doc={doc} />}
    </StepFrame>
  );
}

function PictureCard({
  card,
  n,
  on,
  name,
  why,
  whyLabel,
  alt,
  onChoose,
}: {
  card: ProductCard;
  n: number;
  on: boolean;
  name: string;
  why: string;
  whyLabel: string;
  alt: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onChoose}
      data-testid="studio-product-card"
      data-archetype={card.archetype}
      data-design={card.id}
      className={cn(
        "group w-[78%] shrink-0 snap-start rounded-[22px] bg-panel p-2.5 text-start transition-[box-shadow,transform] active:scale-[0.99] motion-reduce:active:scale-100 sm:w-auto",
        on ? "shadow-neu-sm" : "hover:shadow-neu-sm",
      )}
      style={on ? { boxShadow: `0 0 0 3px #eef2f7, 0 0 0 5px ${accent.base}` } : undefined}
    >
      <span className="relative block aspect-square overflow-hidden rounded-2xl" style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}>
        {card.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: / signed picture made in the worker
          <img src={card.url} alt={alt} width={512} height={512} className="h-full w-full object-cover" data-testid="studio-product-picture" />
        ) : (
          <Bar className="h-full w-full rounded-2xl" />
        )}
        <span className="absolute start-2 top-2 rounded-full bg-white/85 px-2.5 py-1 text-xs font-bold text-heading backdrop-blur">
          <bdi dir="ltr">{n}</bdi>
        </span>
      </span>
      <span className="mt-2.5 block px-1 text-sm font-bold text-heading">{name}</span>
      <span className="mt-1 block px-1 pb-1 text-xs leading-relaxed text-body">
        <span className="font-bold text-heading">{whyLabel}</span> {why}
      </span>
    </button>
  );
}

function ChosenWhy({
  card,
  nameOf,
  whyOf,
  label,
}: {
  card: StudioProduct["designs"][number] | null;
  nameOf: (c: Pick<ProductCard, "archetype">) => string;
  whyOf: (c: Pick<ProductCard, "archetype" | "why">) => string;
  label: string;
}) {
  if (!card) return null;
  return (
    <p className="text-sm text-body" data-testid="studio-product-why" data-archetype={card.archetype}>
      <span className="font-bold text-heading">{nameOf(card)} · {label}</span> {whyOf(card)}
    </p>
  );
}
