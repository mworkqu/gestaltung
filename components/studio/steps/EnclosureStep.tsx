"use client";

// Step 4 · The Enclosure step decides between:
//  * the real product (P5-16, EnclosureProduct.tsx): pictures of 2–3 designs made
//    in the background after Parts, "Create my CAD", the 3D product in its scene;
//  * the template enclosure (W6, EnclosureTemplate.tsx) as the fallback: a project
//    that already has its case, a Studio without the product pipeline (the e2e
//    fixture by default), a browser that cannot draw the pictures, or a pipeline
//    that failed — never a blank screen.

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import type { EnclosureSpec, Finish, StudioDoc, StudioProduct } from "@/lib/studio/schema";
import type { StudioCtx } from "../StudioShell";
import type { ProductPreviews, UnlockedProduct } from "../use-product";
import { Bar } from "../ui";

// Each flow is its own chunk (only one is ever shown): the Studio's first-load JS does not grow.
function StepLoading() {
  return (
    <div className="neu space-y-4 p-5 sm:p-8" role="status" aria-busy="true">
      <Bar className="h-3 w-32" />
      <Bar className="h-7 w-2/3" />
      <Bar className="h-[320px] w-full rounded-[24px] sm:h-[420px]" />
    </div>
  );
}
const EnclosureProduct = dynamic(() => import("./EnclosureProduct").then((m) => m.EnclosureProduct), { loading: StepLoading });
const EnclosureTemplateFlow = dynamic(() => import("./EnclosureTemplate").then((m) => m.EnclosureTemplateFlow), { loading: StepLoading });

export function productFlowOf(doc: StudioDoc, previews: ProductPreviews): "product" | "template" | "fallback" {
  if (!previews.enabled) return "template";
  if (doc.product?.unlockedId) return "product";
  // An existing case stays a case (no surprise redesign of a project already drawn).
  if (doc.enclosure && !doc.product) return "template";
  if (previews.phase === "unsupported") return "fallback";
  if (previews.phase === "failed" && previews.cards.length === 0) return "fallback";
  return "product";
}

export function EnclosureStep({
  ctx,
  doc,
  previews,
  unlocked,
  beforeServer,
  onEnclosure,
  onProduct,
  onFinish,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  previews: ProductPreviews;
  unlocked: UnlockedProduct;
  beforeServer: () => Promise<void>;
  onEnclosure: (
    enclosure: EnclosureSpec,
    opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"]; reshape?: boolean },
  ) => void;
  onProduct: (update: (prev: StudioProduct | undefined) => StudioProduct) => void;
  onFinish: (finish: Finish) => void;
  onNext: () => void;
}) {
  const t = useTranslations("Studio");
  const flow = productFlowOf(doc, previews);
  if (flow === "product") {
    return (
      <EnclosureProduct
        ctx={ctx}
        doc={doc}
        previews={previews}
        unlocked={unlocked}
        beforeServer={beforeServer}
        onProduct={onProduct}
        onFinish={onFinish}
        onNext={onNext}
      />
    );
  }
  return (
    <EnclosureTemplateFlow
      ctx={ctx}
      doc={doc}
      beforeServer={beforeServer}
      onEnclosure={onEnclosure}
      onNext={onNext}
      note={
        flow === "fallback" ? (
          <p className="text-sm text-mutedtext" data-testid="studio-product-fallback">
            {t("product.fallbackNote")}
          </p>
        ) : null
      }
    />
  );
}
