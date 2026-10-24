"use client";

// Step 6 · Make it. "Order the parts": every part we sell goes to the cart
// (quantity 1 / minimum order), then the cart opens. Asking us to make it is
// the Studio's one "Get it made" bar (W2, components/studio/GetItMade.tsx),
// shown under every step from the Enclosure on — not a second button here.
// The 3D view needs the 3D engine, so it shows only once the design has its CAD
// (or in the template enclosure flow); before that the chosen design's picture
// (else the parts picture) stands in, and "Share picture" uses it (owner 2026-10-11).
//
// 3c: in a CLASS project there is no checkout. "Order the parts" becomes
// "Ask your teacher to order the parts" — a plain line, not a button — because
// their teacher buys the parts for every team in one order.

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Factory, Loader2, School, ShoppingCart } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { StudioViewer } from "@/components/studio/viewer/ViewerLazy";
import { layoutComponents } from "@/lib/studio/layout";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StoreCardPart } from "@/lib/store/catalog";
import type { StudioCtx } from "../studio-ctx";
import { Problem, StepFrame } from "../ui";
import { studioKitPlan, useStudioCart } from "../use-studio-cart";
import { pictureShareSource, ShareActions, type ShareSource } from "./share";
import { PartsPicturePane } from "./PartsStep";

const accent = STEP_ACCENT.make;

function BigOption({
  icon: Icon,
  title,
  text,
  busy,
  onClick,
  primary,
}: {
  icon: typeof Factory;
  title: string;
  text: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        primary
          ? "group flex w-full items-start gap-4 rounded-[24px] bg-cobalt p-5 text-start text-white shadow-[0_12px_28px_-12px_rgba(14,89,197,0.8)] transition-[transform,background-color] hover:bg-cobalt-hover active:scale-[0.99] disabled:opacity-70 sm:p-6"
          : "group flex w-full items-start gap-4 rounded-[24px] bg-surface p-5 text-start text-heading shadow-neu-sm transition-transform hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-70 sm:p-6"
      }
    >
      <span
        className={primary ? "grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15" : "grid h-12 w-12 shrink-0 place-items-center rounded-2xl"}
        style={primary ? undefined : { background: accent.soft }}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : (
          <Icon className="h-6 w-6" strokeWidth={1.5} style={primary ? undefined : { color: accent.ink }} aria-hidden />
        )}
      </span>
      <span className="space-y-1">
        <span className="block text-lg font-extrabold tracking-tight">{title}</span>
        <span className={primary ? "block text-sm text-white/85" : "block text-sm text-body"}>{text}</span>
      </span>
    </button>
  );
}

export function MakeStep({
  ctx,
  doc,
  products,
  engine,
  pictureUrl,
  isClass = false,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  products: Map<string, StoreCardPart>;
  /** The 3D engine may load (the design has its CAD, or the template flow). */
  engine: boolean;
  /** The chosen design's picture, when there is one. */
  pictureUrl: string | null;
  /** 3c: a school class team — no checkout, their teacher orders the parts. */
  isClass?: boolean;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const tSafe = useTranslations("SchoolSafety");
  const router = useRouter();
  const cart = useStudioCart(ctx.api.mode === "live" ? ctx.projectId : null);
  const viewer = useRef<ShareSource | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // The finished product (same layout as the Enclosure step, so the case fits identically).
  const placed = useMemo(
    () =>
      doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ c, part }] : [];
      }),
    [doc.components, getPart],
  );
  const layout = useMemo(
    () =>
      doc.enclosure
        ? layoutComponents(
            placed.map(({ c, part }) => ({ instanceId: c.instanceId, part })),
            { clearance: doc.enclosure.clearance, sizeHint: doc.spec.sizeHint },
          ).layout
        : undefined,
    [placed, doc.enclosure, doc.spec.sizeHint],
  );
  const viewerComponents = useMemo(
    () => placed.map(({ c }) => ({ instanceId: c.instanceId, partId: c.partId, label: c.label })),
    [placed],
  );

  async function orderParts() {
    const ok = await cart.add(studioKitPlan(doc.components, products, getPart));
    if (ok) router.push("/store/cart");
  }

  return (
    <StepFrame step="make" n={ctx.n("make")} title={t("title_make")} headline={t("headline_make")} intro={t("intro_make")}>
      <div className="grid gap-4">
        {isClass ? (
          <div className="tile flex items-start gap-3" data-testid="studio-ask-teacher">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
              <School className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block title-card">{tSafe("askTeacher")}</span>
              <span className="mt-1 block text-sm leading-relaxed text-mutedtext">{tSafe("askTeacherNote")}</span>
            </span>
          </div>
        ) : (
          <BigOption
            icon={ShoppingCart}
            title={t("orderParts")}
            text={t("orderPartsText")}
            busy={cart.state === "adding"}
            onClick={() => void orderParts()}
          />
        )}
      </div>
      {placed.length > 0 && (
        <div className="space-y-2">
          <div
            className="relative h-[260px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[340px]"
            data-testid="studio-make-viewer"
          >
            {engine ? (
              <StudioViewer
                components={viewerComponents}
                layout={layout}
                enclosure={doc.enclosure}
                accent={accent.base}
                autoRotate
                ariaLabel={t("viewerMake")}
                onReady={(api) => {
                  viewer.current = api;
                }}
              />
            ) : pictureUrl ? (
              <PictureView
                url={pictureUrl}
                alt={t("viewerMake")}
                onSource={(src) => {
                  viewer.current = src;
                }}
              />
            ) : (
              <PartsPicturePane
                components={doc.components}
                products={products}
                selected={selected}
                onSelect={setSelected}
                picking={false}
                locale={ctx.locale}
                onPicture={(url) => {
                  viewer.current = url ? pictureShareSource(url) : null;
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 sm:justify-start">
            <ShareActions ctx={ctx} viewer={viewer} accent={accent.base} />
          </div>
        </div>
      )}
      {cart.state === "failed" && <Problem>{t("cartFailed")}</Problem>}
    </StepFrame>
  );
}

function PictureView({ url, alt, onSource }: { url: string; alt: string; onSource: (s: ShareSource) => void }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: / signed picture of the chosen design
    <img
      src={url}
      alt={alt}
      className="h-full w-full object-contain"
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}
      onLoad={() => onSource(pictureShareSource(url))}
      data-testid="studio-make-picture"
    />
  );
}
