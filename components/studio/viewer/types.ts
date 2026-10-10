// Public types of the Design Studio viewer. Type-only imports, so callers can
// type props without pulling three.js into their bundle.

import type * as THREE from "three";
import type { EnclosureSpec, LayoutItem } from "@/lib/studio/schema";

export type ViewerComponent = { instanceId: string; partId: string; label: string };

export type ViewerExtraObject = {
  /** Object name (used for selection / export). */
  name: string;
  /** Owned by the caller: the viewer never disposes it. */
  object: THREE.Object3D;
  /** Explode vector (mm, Z up) at explode = 1. */
  explode?: [number, number, number];
};

export type ViewerApi = {
  /** Every component, enclosure_base / enclosure_lid and extra object (name = instanceId). */
  getObjects(): THREE.Object3D[];
  /** Renders one frame and returns the canvas as a PNG (transparent background). */
  toPNG(): Promise<Blob>;
  /**
   * Share picture: one square frame (default 1080 × 1080) on an opaque branded background
   * (soft gradient, product name + small "Gestaltung360" wordmark in the bottom start corner).
   */
  toSharePNG(opts: { title: string; rtl?: boolean; size?: number; accent?: string }): Promise<Blob>;
};

export type ViewerProps = {
  components: ViewerComponent[];
  /** Absent = "plate mode" (parts float on a round plate, used on the Parts step). */
  layout?: LayoutItem[];
  enclosure?: EnclosureSpec | null;
  extraObjects?: ViewerExtraObject[];
  xray?: boolean;
  /** 0..1 (layout mode only). */
  explode?: number;
  selected?: string | null;
  onSelect?(instanceId: string | null): void;
  /** Step accent hex (highlight + plate rim). */
  accent?: string;
  className?: string;
  /** Localized description for screen readers (container has role="img"). */
  ariaLabel?: string;
  /** Slow turntable when idle (default true; always off with prefers-reduced-motion). */
  autoRotate?: boolean;
  onReady?(api: ViewerApi): void;
};
