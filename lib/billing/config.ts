// Ideation token packs + the optional Maker Pass — the ONE config file
// (owner, 2026-10-18). Pure. Pay-per-use stays the default; the pass is an
// optional monthly top-up worth twice what its price buys pay-per-use.
//
// Every amount shown to users comes from here (never written into the copy).
// The SQL in migration 0089 never trusts amounts from the browser: the server
// route reads them from here when it creates a payment row, and the grant
// uses what that row recorded.

import { TIERS } from "@/lib/studio/tiers";

/** The list price of one ideation token, before any discount. */
export const TOKEN_BASE_PRICE_QAR = 10;

/** The launch discount on ideation tokens (owner, 2026-10-25). Set `active: false` to end it: every price and sentence follows. */
export const TOKEN_LAUNCH_DISCOUNT = { active: true, pct: 80 } as const;

/** The price after the discount (the base when the discount is off). Pure, so the switch-off case is testable. */
export function effectiveTokenPrice(base: number, discount: { active: boolean; pct: number }): number {
  return discount.active ? (base * (100 - discount.pct)) / 100 : base;
}

/** What one token costs a user today. Packs and the Maker Pass derive from this. */
export const TOKEN_PRICE_QAR = effectiveTokenPrice(TOKEN_BASE_PRICE_QAR, TOKEN_LAUNCH_DISCOUNT);

/**
 * Every number the token sentences interpolate, as the strings next-intl wants.
 * `promo` is "on" | "off" for an ICU select, so the "launch discount" wording
 * disappears by itself when the discount is switched off. Tier costs come from
 * lib/studio/tiers.ts, never from the copy.
 */
export function tokenCopyParams(): {
  tokenPrice: string;
  base: string;
  discount: string;
  promo: "on" | "off";
  tier2: string;
  tier3: string;
} {
  const upfront = (level: 2 | 3) => String(TIERS.find((t) => t.level === level)?.upfront ?? 0);
  return {
    tokenPrice: String(TOKEN_PRICE_QAR),
    base: String(TOKEN_BASE_PRICE_QAR),
    discount: String(TOKEN_LAUNCH_DISCOUNT.pct),
    promo: TOKEN_LAUNCH_DISCOUNT.active ? "on" : "off",
    tier2: upfront(2),
    tier3: upfront(3),
  };
}

export type TokenPack = { id: string; tokens: number; qar: number };

/** Pay-per-use packs, all at TOKEN_PRICE_QAR per token. */
export const TOKEN_PACKS: readonly TokenPack[] = [10, 25, 50].map((tokens) => ({
  id: `tokens_${tokens}`,
  tokens,
  qar: tokens * TOKEN_PRICE_QAR,
}));

const PASS_PRICE_QAR = 20;
/** Always 2× the tokens the same QAR buys pay-per-use. */
const PASS_MONTHLY_TOKENS = 2 * Math.floor(PASS_PRICE_QAR / TOKEN_PRICE_QAR);

export const MAKER_PASS = {
  id: "maker_pass",
  qar: PASS_PRICE_QAR,
  days: 30,
  monthlyTokens: PASS_MONTHLY_TOKENS,
  /** Unused pass tokens roll over one month: the pass balance never goes above this. */
  rolloverCap: 2 * PASS_MONTHLY_TOKENS,
  valueMultiple: 2,
} as const;

export type Product =
  | { kind: "tokens"; id: string; qar: number; tokens: number }
  | { kind: "pass"; id: string; qar: number; tokens: number; days: number; cap: number };

export function productById(id: string): Product | null {
  if (id === MAKER_PASS.id)
    return { kind: "pass", id, qar: MAKER_PASS.qar, tokens: MAKER_PASS.monthlyTokens, days: MAKER_PASS.days, cap: MAKER_PASS.rolloverCap };
  const pack = TOKEN_PACKS.find((p) => p.id === id);
  return pack ? { kind: "tokens", id, qar: pack.qar, tokens: pack.tokens } : null;
}

/** Automatic Fawran proof check (lib/billing/verify.ts). */
export const FAWRAN_CHECK = {
  /** A receipt older than this (or dated before the payment was started, minus a day) needs review. */
  maxAgeDays: 3,
  /** The model's confidence below this → needs review. */
  minConfidence: 0.7,
  /** What may appear as the recipient on a receipt (alias, CR number, company name). */
  recipients: ["CR-236988", "236988", "GESTALTUNG", "جستالتونج", "جشتالتونج"],
} as const;
