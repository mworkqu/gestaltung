// Build tiers + ideation token rules — the ONE config file (owner, 2026-10-25).
// Pure: shared by the spec route (classification + charging), the Studio chat
// (labels) and the admin cost pages.
//
// THREE COMPLEXITY TIERS, classified from the project's scope. Every number is
// tuned in this file and nowhere else (TIERS for the thresholds and the upfront
// price, IDEATION for the welcome grant and the 3D-redesign extras).
//
//   Tier 1  explorer   Basic / educational          FREE
//     one basic microcontroller, at most 2 sensors, at most 2 basic
//     motors / actuators. Free to ideate and explore.
//   Tier 2  maker      Mechatronics / multi-axis    7 tokens
//     complex kinematics (a 4-axis machine), a higher-end controller, or
//     several controllers talking over a bus (I2C, SPI, UART, CAN).
//   Tier 3  engineer   Advanced / turnkey          14 tokens
//     integrated mechanical packaging, complex power, a custom PCB,
//     production firmware architecture.
//
// WHO DECIDES WHAT: the model proposes STRUCTURE (the understanding's part
// lists plus spec.scope, both validated and clamped), and the code here maps
// that structure onto a tier and the tier onto a price. No price, token amount
// or tier ever comes from the model or from the browser.
//
// CHARGING (owner, 2026-10-23, refined 2026-10-25) — three cases, see chargePlan:
//   1. refining the SAME idea is free, however many turns it takes;
//   2. the same idea growing into a higher tier costs the DIFFERENCE, so an idea's
//      price is always its tier's price (Tier 1 → 3 and Tier 1 → 2 → 3 both cost 14);
//   3. a turn that replaces the product with a DIFFERENT product (identity.ts)
//      costs the new product's full tier price.
// Cases 2 and 3 are quoted and approved before a token moves (the route's
// checkpoint); nothing is ever deducted silently.
//
// The tier ids are also the values migration 0088 stores in idea_sessions.tier
// and accepts in idea_token_charge (explorer | maker | engineer), so they stay
// as they are; `level` is the owner's 1 / 2 / 3 numbering.

import type { BuildScope, ProductSpec } from "./schema";
import { actuatorTotals } from "./actuators";

export type TierId = "explorer" | "maker" | "engineer";

export type Tier = {
  /** Stored in idea_sessions.tier (migration 0088 accepts only these three). */
  id: TierId;
  /** The owner's numbering: Tier 1 / 2 / 3. */
  level: 1 | 2 | 3;
  /** Most sensors / movers (servos, small linear actuators, motors, pumps) / controllers / axes still inside this tier. */
  maxSensors: number;
  maxMovers: number;
  maxControllers: number;
  maxAxes: number;
  /** Tokens taken upfront for an idea at this tier. TUNE THE PRICE HERE. */
  upfront: number;
  /** Extras still charged per use (3D redesigns, see regenCost) scale with the tier. */
  multiplier: number;
  /** Bigger builds get a stronger model and a deeper electronics check on every chat turn (owner, 2026-10-18). */
  deep: boolean;
};

/** Smallest first. Tier 1's maxima ARE the thresholds; the higher tiers have none. */
export const TIERS: readonly Tier[] = [
  { id: "explorer", level: 1, maxControllers: 1, maxSensors: 2, maxMovers: 2, maxAxes: 2, upfront: 0, multiplier: 1, deep: false },
  {
    id: "maker",
    level: 2,
    maxControllers: Infinity,
    maxSensors: Infinity,
    maxMovers: Infinity,
    maxAxes: Infinity,
    upfront: 7,
    multiplier: 2,
    deep: true,
  },
  {
    id: "engineer",
    level: 3,
    maxControllers: Infinity,
    maxSensors: Infinity,
    maxMovers: Infinity,
    maxAxes: Infinity,
    upfront: 14,
    multiplier: 3,
    deep: true,
  },
];

/** The three stored ids, for zod enums and SQL guards. */
export const TIER_IDS = ["explorer", "maker", "engineer"] as const satisfies readonly TierId[];

const TIER1 = TIERS[0];
const TIER2 = TIERS[1];
const TIER3 = TIERS[2];

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
  /** 3D product designs: regenerations that are free per project (the first one), then `regenCost` (× tier) each. */
  regenFree: 1,
  regenCost: 1,
  /**
   * Chat edits are free (owner, 2026-10-23): the idea is paid for upfront at its
   * tier, and refining it never costs another token.
   */
  editCost: 0,
  /**
   * Legacy per-turn numbers. Charging no longer reads them — they are left here only
   * because /pricing and /tokens still describe the old "1 per new idea, 1 every N
   * edits" model in copy we do not own (see the strings reported with this change).
   */
  newIdeaCost: 1,
  get turnsPerToken() {
    return envInt("IDEA_TURNS_PER_TOKEN", 5, 1);
  },
};

export type PartCount = { controllers: number; sensors: number; movers: number; outputs: number };

/** Anything the classifier can read: the understanding's parts, the card's movers and the scope. */
export type SpecLike = Pick<ProductSpec, "actuators" | "understanding"> & { scope?: BuildScope };

/** Parts counted from the understanding; spec.actuators fills in when the understanding has no movers. */
export function countParts(spec: SpecLike): PartCount {
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

/**
 * Why a build left Tier 1. Reason codes, never prose: the chat modal and the admin
 * telemetry both label them (one message key per code, `Studio.tierWhy_<code>`).
 */
export const TIER_REASONS = [
  "sensors",
  "movers",
  "controllers",
  "controller_bus",
  "axes",
  "high_end_controller",
  "custom_pcb",
  "production_firmware",
  "integrated_enclosure",
  "complex_power",
] as const;
export type TierReason = (typeof TIER_REASONS)[number];

/** Controllers the build really has: the understanding knows of one board, the scope can say more. */
const controllersOf = (count: PartCount, scope?: BuildScope) => Math.max(count.controllers, scope?.controllers ?? 0);

/**
 * Tier 3: integration signals, and a single one is enough.
 *
 * Part COUNTS never reach Tier 3, however large the build (owner decision,
 * 2026-10-25: "Tier 3 is about integration (custom PCB, production firmware,
 * packaging, complex power), not part count. A 10-sensor build at Tier 2 is
 * correct."). Integration is what makes a project expensive to think about; adding a
 * tenth sensor to a breadboard is not. A big build with no integration signal is
 * therefore deliberately Tier 2 — this is settled, not an oversight, and
 * tiers.test.ts pins it.
 */
function tier3Reasons(scope?: BuildScope): TierReason[] {
  if (!scope) return [];
  const out: TierReason[] = [];
  if (scope.customPcb) out.push("custom_pcb");
  if (scope.productionFirmware) out.push("production_firmware");
  if (scope.integratedEnclosure) out.push("integrated_enclosure");
  if (scope.complexPower) out.push("complex_power");
  return out;
}

/** Tier 2: anything past Tier 1's part counts, multi-controller work or complex kinematics. */
function tier2Reasons(count: PartCount, scope?: BuildScope): TierReason[] {
  const out: TierReason[] = [];
  if (count.sensors > TIER1.maxSensors) out.push("sensors");
  if (count.movers > TIER1.maxMovers) out.push("movers");
  if (controllersOf(count, scope) > TIER1.maxControllers) out.push("controllers");
  // A bus is a Tier 2 signal only between CONTROLLERS; an I2C sensor on one board is Tier 1.
  if (scope?.controllerBus) out.push("controller_bus");
  if ((scope?.axes ?? 0) > TIER1.maxAxes) out.push("axes");
  if (scope?.highEndController) out.push("high_end_controller");
  return out;
}

/** The tier counts + scope sit in, and why it is not Tier 1. Deterministic: same input, same answer. */
export function tierFor(count: PartCount, scope?: BuildScope): { tier: Tier; reasons: TierReason[] } {
  const three = tier3Reasons(scope);
  if (three.length) return { tier: TIER3, reasons: [...three, ...tier2Reasons(count, scope)] };
  const two = tier2Reasons(count, scope);
  return two.length ? { tier: TIER2, reasons: two } : { tier: TIER1, reasons: [] };
}

/** The same for a card: its part counts plus the scope the model reported on the same turn. */
export function classify(spec: SpecLike | null | undefined): { tier: Tier; reasons: TierReason[] } {
  if (!spec) return { tier: TIER1, reasons: [] };
  return tierFor(countParts(spec), spec.scope);
}

export const tierOf = (spec: SpecLike | null | undefined): Tier => classify(spec).tier;

export const tierRank = (id: TierId) => TIERS.findIndex((t) => t.id === id);

/** A stored tier id (idea_sessions.tier) as a Tier; unknown / missing → the base tier. */
export const tierById = (id: string | null | undefined): Tier => TIERS.find((t) => t.id === id) ?? TIER1;

/**
 * The tier a chat turn is priced at (AI-06). The floor is the tier the SERVER
 * last recorded for the project (idea_sessions.tier, written only by
 * idea_token_charge from the model's own output); the card the client sends
 * can only raise it, never lower it. With no stored tier yet (a new idea) the
 * floor is the base tier, so an honest client pays exactly what it paid before:
 * the tier of the card it shows (none → Tier 1).
 */
export function chargeTier(storedTier: string | null | undefined, current: SpecLike | null): Tier {
  const stored = tierById(storedTier);
  const claimed = tierOf(current);
  return tierRank(claimed.id) > tierRank(stored.id) ? claimed : stored;
}

/**
 * Topping up from one tier to another. An idea's price is its tier's price, so an
 * escalation charges only the difference: Tier 1 → 3 costs 14, and Tier 1 → 2 → 3
 * costs 7 + 7 = 14 as well. Never negative (the floor means a tier never drops).
 */
export function escalationCost(from: TierId, to: TierId): number {
  return Math.max(0, tierById(to).upfront - tierById(from).upfront);
}

/**
 * What a turn is charged as (owner, 2026-10-25):
 *   none         a refinement of the same idea inside the stored tier — always free;
 *   new_idea     the project's first paid-for turn;
 *   escalation   the same idea grew into a higher tier (the difference is charged);
 *   new_product  the message replaced the product with a different one
 *                (lib/studio/identity.ts) — charged as a new idea, at full price.
 */
export type ChargeKind = "new_idea" | "escalation" | "new_product" | "none";

export type ChargePlan = {
  /** The tier the project is priced at after this turn. */
  tier: Tier;
  /** The tier the SERVER had stored before this turn (the floor). */
  from: Tier;
  kind: ChargeKind;
  /** Tokens to take. Derived from the tiers here, never from the browser. */
  amount: number;
  /**
   * true = pause: this turn would move the build into a higher tier or start a
   * different product, so the UI must show `amount` and get an explicit yes before
   * anything is charged or kept.
   */
  needsApproval: boolean;
  /** Why the build is above Tier 1 (reason codes for the modal and the telemetry). */
  reasons: TierReason[];
};

/**
 * What this chat turn costs, and whether it has to pause for approval first.
 *
 *  - the tier is the server's stored tier raised by the card's own tier (chargeTier);
 *  - refining the same idea inside that tier is ALWAYS free, however many turns;
 *  - the same idea growing into a higher tier costs escalationCost(stored → target);
 *  - a turn that starts a DIFFERENT product (newIdea, decided by our own code in
 *    lib/studio/identity.ts) costs the new product's full tier price;
 *  - every charge above zero needs the visitor's explicit approval first, unless
 *    they already approved at least that tier in the modal;
 *  - admins are never charged (idea_token_charge enforces that too).
 *
 * Once approved, EXACTLY `amount` is charged even if the model's own consumption
 * differs — the difference is recorded as telemetry (migration 0106), not billed.
 */
export function chargePlan(opts: {
  /** idea_sessions.tier from idea_token_status (server-written). */
  storedTier?: string | null;
  /** An idea_sessions row exists: the project has had a paid-for turn before. */
  started: boolean;
  /** The card this turn produced (or the one it kept). */
  spec: SpecLike | null;
  /** The tier the visitor approved in the modal. Can only allow, never price. */
  approved?: string | null;
  admin?: boolean;
  /**
   * This turn replaced the product with a different one (identity.ts newIdeaTurn).
   * Charged as a new idea at the new product's tier, not as a tier difference.
   */
  newIdea?: boolean;
}): ChargePlan {
  const from = tierById(opts.storedTier);
  const { tier: own, reasons } = classify(opts.spec);
  // A different product starts over, so its whole tier price is due again and it is
  // priced on its OWN tier: the stored floor exists to stop a shrunken card buying a
  // cheaper turn of the SAME idea, and a new Tier 1 idea must not inherit the old
  // idea's price. The same idea keeps the floor and only tops the difference up.
  const newProduct = Boolean(opts.newIdea) && opts.started;
  const tier = newProduct ? own : chargeTier(opts.storedTier, opts.spec);
  const up = tierRank(tier.id) > tierRank(from.id);
  const full = newProduct ? tier.upfront : up ? escalationCost(from.id, tier.id) : 0;
  const kind: ChargeKind = newProduct ? "new_product" : !opts.started ? "new_idea" : up ? "escalation" : "none";
  const amount = opts.admin ? 0 : full;
  const approvedEnough = opts.approved ? tierRank(tierById(opts.approved).id) >= tierRank(tier.id) : false;
  return { tier, from, kind, amount, needsApproval: amount > 0 && !approvedEnough, reasons };
}

/**
 * Edit turns left before the next charge. Edits are free, so this is only the
 * legacy counter the chat's balance line still reads; it never gates anything.
 */
export function turnsUntilCharge(editTurnsSoFar: number): number {
  const n = IDEATION.turnsPerToken;
  return n - (editTurnsSoFar % n);
}

/**
 * What the next "give me three new designs" costs in the 3D product step.
 * `regensSoFar` = regenerations already made on the project; the first IDEATION.regenFree are free,
 * every later one costs regenCost × tier (admins are never charged, see idea_token_charge).
 */
export function regenCost(regensSoFar: number, spec: SpecLike | null | undefined): number {
  if (regensSoFar < IDEATION.regenFree) return 0;
  return IDEATION.regenCost * tierOf(spec).multiplier;
}
