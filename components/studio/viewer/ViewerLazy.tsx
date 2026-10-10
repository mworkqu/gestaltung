"use client";

// The ONLY entry other code imports: keeps three.js / R3F out of every other bundle.

import dynamic from "next/dynamic";
import type { ViewerProps } from "./types";

export type { ViewerApi, ViewerProps, ViewerComponent, ViewerExtraObject } from "./types";

function ViewerSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-full min-h-[240px] w-full motion-safe:animate-pulse"
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}
    />
  );
}

export const StudioViewer = dynamic<ViewerProps>(() => import("./Viewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});
