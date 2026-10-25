// The stored shape of projects.bom (migrations 0023, 0025). A leaf module:
// lib/supabase/types.ts and lib/prototyping/electronics-rules.ts import these
// types here instead of from bom.ts, which imports both (import cycles).
// bom.ts re-exports everything below for older import paths.

import type { BomKind, BomLine, LevelFlag } from "./analysis";

export type LineOrigin = "analysis" | "electronics" | "rule";

export type Fulfilled = { orderId: string; at: string; productId: string; sku: string; quantity: number };

export type ProjectLine = BomLine & {
  choice?: string | null;
  origin?: LineOrigin;
  /** Why a rule added this line ("current limit for LED1"). */
  reason?: string;
  fulfilled?: Fulfilled | null;
};

/** projects.bom (migrations 0023, 0025). */
export type ProjectBom = {
  lines: ProjectLine[];
  analysedAt: string;
  /** Line ids the client removed; rules and re-analysis never add them back. */
  dismissed?: string[];
  electronicsBuiltAt?: string;
  /** The build route the electronics lines were built for. */
  route?: "prototype" | "custom_pcb";
  /** From our rules at build time: logic-level crossings, and assumptions made. */
  levelFlags?: LevelFlag[];
  assumptions?: string[];
};

/** Which tree node a line's rows appear under. (Here, not in bom.ts, so tree.ts need not import bom.ts: import cycle via supabase/types.) */
export const bomNode = (kind: BomKind) =>
  kind === "electronics" ? "electronics.components" : kind === "mechanical" ? "mechanical.parts" : "bom";

/** How a line stands against the store and the client's inventory. */
export type LineStatus = "matched" | "choose" | "not_stocked" | "have" | "fabrication" | "fulfilled";
