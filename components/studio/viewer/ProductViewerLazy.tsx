"use client";

// The ONLY entry to the product viewer (P5-16): keeps three.js out of every other bundle.

import dynamic from "next/dynamic";
import type { ProductViewerProps } from "./ProductViewer";
import { ViewerSkeleton } from "./ViewerSkeleton";

export type { ProductViewerProps };

export const ProductViewer = dynamic<ProductViewerProps>(() => import("./ProductViewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});
