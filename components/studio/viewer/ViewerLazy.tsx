"use client";

// The ONLY entry other code imports: keeps three.js / R3F out of every other bundle.

import dynamic from "next/dynamic";
import type { ViewerProps } from "./types";
import { ViewerSkeleton } from "./ViewerSkeleton";

export { ViewerSkeleton };

export type { ViewerApi, ViewerProps, ViewerComponent, ViewerExtraObject } from "./types";

const loadViewer = () => import("./Viewer");

let preloading: Promise<unknown> | null = null;
/**
 * Start fetching the 3D viewer chunk (three.js + R3F) ahead of the Parts step, e.g. while
 * the idea chat waits for its answer. Same chunk as StudioViewer, fetched once.
 */
export function preloadStudioViewer(): void {
  preloading ??= loadViewer().catch(() => {
    preloading = null;
  });
}

export const StudioViewer = dynamic<ViewerProps>(loadViewer, {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});
