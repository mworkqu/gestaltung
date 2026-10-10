// Studio colours. Enclosure colours are names in the schema (COLOURS); hex here.
// Step accents: one per step, tested against the light neu canvas (#eef2f7) and
// the dark ink band for ≥ 3:1 as UI accents. Brand cobalt stays for buttons.

import type { Colour, Finish, Look } from "./schema";

// Tuned 2026-10-11 under the studio lighting (ACES, exposure 0.92): coral, sage, sun and
// clay were a touch deeper so they don't wash out to pastel; chalk stays below clipping
// and graphite keeps detail in its shadow side.
export const COLOUR_HEX: Record<Colour, string> = {
  chalk: "#f2f0eb",
  graphite: "#3a3f47",
  sand: "#d9c7a7",
  sage: "#93ab8d",
  coral: "#e46a55",
  ocean: "#3f7fa6",
  sun: "#efb935",
  cobalt: "#0e59c5",
  mist: "#c9d3df",
  clay: "#b06a4c",
};

export const STEP_IDS = ["idea", "parts", "wiring", "enclosure", "print", "code", "make"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Accent per step (text-safe on #eef2f7, contrast ≥ 4.5:1 for the darker shade). */
export const STEP_ACCENT: Record<StepId, { base: string; ink: string; soft: string }> = {
  idea: { base: "#8b5cf6", ink: "#6d28d9", soft: "#ede9fe" },
  parts: { base: "#0ea5a4", ink: "#0f766e", soft: "#ccfbf1" },
  wiring: { base: "#f59e0b", ink: "#b45309", soft: "#fef3c7" },
  enclosure: { base: "#ec4899", ink: "#be185d", soft: "#fce7f3" },
  print: { base: "#22c55e", ink: "#15803d", soft: "#dcfce7" },
  code: { base: "#6366f1", ink: "#4338ca", soft: "#e0e7ff" },
  make: { base: "#0e59c5", ink: "#0c4eb0", soft: "#dbeafe" },
};

/** PBR settings per finish (viewer). Base roughness/metalness are the owner's values (P5-13 brief); clearcoat/sheen/brushed are the Phase 3 polish. */
export type FinishPbr = {
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Soft velvet rim (soft_touch). */
  sheen?: number;
  sheenRoughness?: number;
  /** Fine brushed streaks: ± share of roughness varied along one axis (anodized). */
  brushed?: number;
};

export const FINISH_PBR: Record<Finish, FinishPbr> = {
  matte_plastic: { roughness: 0.7, metalness: 0 },
  glossy_plastic: { roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 },
  soft_touch: { roughness: 0.9, metalness: 0, sheen: 0.3, sheenRoughness: 0.8 },
  anodized_aluminium: { roughness: 0.35, metalness: 0.6, brushed: 0.25 },
  wood_look: { roughness: 0.58, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45 },
};

/** Base colours for component bodies. */
export const LOOK_HEX: Record<Look, string> = {
  pcb_green: "#1f6b3a",
  pcb_black: "#1b1d22",
  pcb_blue: "#1f4f9c",
  metal: "#b8bec7",
  plastic_black: "#26282c",
  plastic_white: "#eceae4",
  battery_wrap: "#2f6fd6",
};

/** Net colours for the schematic (power/ground fixed, signals cycle). */
export const NET_COLOURS = {
  power: "#dc2626",
  ground: "#1c2434",
  signals: ["#0e59c5", "#0ea5a4", "#f59e0b", "#8b5cf6", "#ec4899", "#22c55e", "#6366f1", "#b45309"],
};
