// The drawing-request tiers (P5-06), read from store_settings.service_prices.
// Never a literal in a component.

import type { ServicePrices } from "@/lib/pricing/defaults";

export const DRAWING_TIER_IDS = ["simple", "assembly", "complex"] as const;
export type DrawingTierId = (typeof DRAWING_TIER_IDS)[number];

export type DrawingTier = { id: DrawingTierId; price: number; from: boolean };

export function drawingTiers(p: Pick<ServicePrices, "drawing_simple" | "drawing_assembly" | "drawing_complex_from">): DrawingTier[] {
  return [
    { id: "simple", price: p.drawing_simple, from: false },
    { id: "assembly", price: p.drawing_assembly, from: false },
    { id: "complex", price: p.drawing_complex_from, from: true },
  ];
}
