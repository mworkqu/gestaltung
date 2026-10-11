"use client";

// The ONLY entry other code imports: keeps three.js / R3F out of every other bundle.

import dynamic from "next/dynamic";
import type { ViewerProps } from "./types";
import { ViewerSkeleton } from "./ViewerSkeleton";

export { ViewerSkeleton };

export type { ViewerApi, ViewerProps, ViewerComponent, ViewerExtraObject } from "./types";

const loadViewer = () => import("./Viewer");

// Owner 2026-10-11: never preloaded. The Parts step shows a worker-drawn picture; this
// viewer (three.js + R3F) is only rendered by the template enclosure fallback and the
// Make step of a design that has its CAD.

export const StudioViewer = dynamic<ViewerProps>(loadViewer, {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});
