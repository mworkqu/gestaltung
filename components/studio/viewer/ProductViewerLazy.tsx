"use client";

// The ONLY entry to the product viewer (P5-16): keeps three.js out of every other bundle.
// Owner 2026-10-11: the 3D engine is fetched only on the way to the CAD — after "Create
// my CAD" succeeded (or for a design already unlocked), and ahead of time only for a
// visitor who can open it (enough CAD credits / super_admin, see preloadProductViewer).

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { StudioLoader } from "../StudioLoader";
import type { ProductViewerProps } from "./ProductViewer";

export type { ProductViewerProps };

const loadProductViewer = () => import("./ProductViewer");

let preloading: Promise<unknown> | null = null;
/** Fetch the engine + viewer chunk now (same chunk as ProductViewer, fetched once). */
export function preloadProductViewer(): void {
  preloading ??= loadProductViewer().catch(() => {
    preloading = null;
  });
}

/** While the engine downloads and the model opens. */
export function ProductViewerLoading() {
  const t = useTranslations("Studio");
  const accent = STEP_ACCENT.enclosure;
  return <StudioLoader label={t("loader.cad")} accent={accent.base} ink={accent.ink} className="h-full min-h-[240px]" testId="studio-cad-loader" />;
}

export const ProductViewer = dynamic<ProductViewerProps>(loadProductViewer, {
  ssr: false,
  loading: () => <ProductViewerLoading />,
});
