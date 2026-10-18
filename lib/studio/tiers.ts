// Build tiers + ideation token rules — the ONE config file (owner, 2026-10-18).
// Pure: shared by the spec route (charging), the Studio chat (labels) and the
// admin cost pages.
//
// Pay per use, no subscription. Generous now, tighten later by editing the
// numbers here (welcomeTokens is mirrored in migration 0088's
// idea_welcome_tokens(); change both).
//
// Tier = how big the build is, counted from the agent's understanding:
//   Explorers  1 controller, up to 3 sensors, up to 2 servos / small actuators
//   Makers     up to 6 sensors, up to 4 movers           (tokens ×2)
//   Engineers  anything bigger                           (tokens ×3)
// Every ideation charge (a new idea, each N-th edit turn) is multiplied by the
// tier's multiplier. LEDs, buzzers and screens do not count toward the tier.

import type { ProductSpec } from "./schema";
import { actuatorTotals } from "./actuators";

export type TierId = "explorer" | "maker" | "engineer";

export type Tier = {
  id: TierId;
  /** Most sensors / movers (servos, small linear actuators, motors, pumps) for this tier. */
  maxSensors: number;
  maxMovers: number;
  maxControllers: number;
  multiplier: number;
  /** Bigger builds get a stronger model and a deeper electronics check on every chat turn (owner, 2026-10-18). */
  deep: boolean;
};

/** Smallest first. The last tier has no limits. */
export const TIERS: readonly Tier[] = [
  { id: "explorer", maxControllers: 1, maxSensors: 3, maxMovers: 2, multiplier: 1, deep: false },
  { id: "maker", maxControllers: 1, maxSensors: 6, maxMovers: 4, multiplier: 2, deep: true },
  { id: "engineer", maxControllers: Infinity, maxSensors: Infinity, maxMovers: Infinity, multiplier: 3, deep: true },
];

/**
 * The model a tier's chat turns use. Explorers: the default (GEMINI_MODEL). Makers and
 * Engineers: a stronger one — TIER_MODEL_MAKER / TIER_MODEL_ENGINEER, else
 * GEMINI_FALLBACK_MODEL's default "gemini-3.5-flash". Server-only (reads env).
 */
export function tierModel(tier: Tier): string | undefined {
  if (!tier.deep) return undefined;
  const env = tier.id === "engineer" ? process.env.TIER_MODEL_ENGINEER : process.env.TIER_MODEL_MAKER;
  return env?.trim() || process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash";
}

const envInt = (name: string, fallback: number, min: number) => {
  const n = Number(process.env[name]?.trim());
  return Number.isInteger(n) && n >= min ? n : fallback;
};

export const IDEATION = {
  /** Granted once per account (mirror of idea_welcome_tokens() in 0088). */
  welcomeTokens: 5,
  /** A new idea (the first model turn on a project). */
  newIdeaCost: 1,
  /** Edits: 1 token (× tier) every N chat turns on an existing understanding. IDEA_TURNS_PER_TOKEN overrides. */
  get turnsPerToken() {
    return envInt("IDEA_TURNS_PER_TOKEN", 5, 1);
  },
};

export type PartCount = { controllers: number; sensors: number; movers: number; outputs: number };

/** Parts counted from the understanding; spec.actuators fills in when the understanding has no movers. */
export function countParts(spec: Pick<ProductSpec, "actuators" | "understanding">): PartCount {
  const u = spec.understanding;
  const sum = (xs: { count?: number }[] | undefined) => (xs ?? []).reduce((s, x) => s + Math.max(1, x.count ?? 1), 0);
  const fromSpec = actuatorTotals(spec as ProductSpec).reduce((s, t) => s + t.count, 0);
  return {
    controllers: u?.controller ? 1 : 0,
    sensors: sum(u?.sensors),
    movers: Math.max(sum(u?.actuators), fromSpec),
    outputs: sum(u?.outputs),
  };
}

export function tierFor(count: PartCount): Tier {
  return (
    TIERS.find((t) => count.controllers <= t.maxControllers && count.sensors <= t.maxSensors && count.movers <= t.maxMovers) ??
    TIERS[TIERS.length - 1]
  );
}

export const tierOf = (spec: Pick<ProductSpec, "actuators" | "understanding"> | null | undefined): Tier =>
  spec ? tierFor(countParts(spec)) : TIERS[0];

export const tierRank = (id: TierId) => TIERS.findIndex((t) => t.id === id);

/**
 * What this chat turn costs before the model is called.
 *  - the project's first model turn = a new idea: newIdeaCost × tier (tier of the card, if any);
 *  - an edit turn: every N-th edit turn costs 1 × tier, the others are free.
 */
export function turnCost(opts: { started: boolean; editTurnsSoFar: number; current: ProductSpec | null }): {
  amount: number;
  edit: boolean;
  tier: Tier;
} {
  const tier = tierOf(opts.current);
  if (!opts.started) return { amount: IDEATION.newIdeaCost * tier.multiplier, edit: Boolean(opts.current), tier };
  if (!opts.current) return { amount: 0, edit: false, tier }; // still answering the first questions of the paid idea
  const n = IDEATION.turnsPerToken;
  const turn = opts.editTurnsSoFar + 1;
  return { amount: turn % n === 0 ? tier.multiplier : 0, edit: true, tier };
}

/** Edit turns left before the next charge (for the balance line). */
export function turnsUntilCharge(editTurnsSoFar: number): number {
  const n = IDEATION.turnsPerToken;
  return n - (editTurnsSoFar % n);
}
