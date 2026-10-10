"use client";

// The ONLY entry other code imports: keeps three.js / R3F out of every other bundle.

import dynamic from "next/dynamic";
import type { ViewerProps } from "./types";
import { ViewerSkeleton } from "./ViewerSkeleton";

export { ViewerSkeleton };

export type { ViewerApi, ViewerProps, ViewerComponent, ViewerExtraObject } from "./types";

export const StudioViewer = dynamic<ViewerProps>(() => import("./Viewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});
