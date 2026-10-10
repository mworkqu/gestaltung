"use client";

import { createContext, useContext } from "react";
import type * as THREE from "three";

export type ViewerCtx = {
  selected: string | null;
  onSelect(id: string | null): void;
  accent: THREE.Color;
  reducedMotion: boolean;
  /** Ask the explode controller to re-apply positions (new object / new rest). */
  markDirty(): void;
};

export const ViewerContext = createContext<ViewerCtx | null>(null);

export function useViewerCtx(): ViewerCtx {
  const c = useContext(ViewerContext);
  if (!c) throw new Error("useViewerCtx outside <ViewerContext>");
  return c;
}
