// Discount-leakage report (P4-07, WF-27): how much QAR the store gave away per
// calendar month, and what share of goods revenue that was. Pure: the page
// fetches rows, this buckets and sums them. Read-only over existing tables.
//
// Four leaks, per Qatar calendar month (Asia/Qatar = UTC+3, no daylight saving):
//   kit discounts      sum(part_orders.discount_qar)          (0025 / 0044)
//   credit redemptions sum(part_orders.credit_discount_qar)   (0042 redeem_credits)
//   credit grants      sum(credits_ledger.delta) where reason = 'admin_grant'
//                      and delta > 0 (0042 admin_grant), x the QAR value of one credit
//   free delivery      the carrier fee waived on orders that shipped free (0044)
// Cancelled and is_test orders never count. Free delivery is an ESTIMATE: the
// order row keeps shipping_qar (0 when waived) and shipping_tier, not the fee
// it waived, so the fee comes from the current store_settings.shipping.

import { CREDIT_QAR } from "@/lib/credits/constants";
import { parsePricingPlans } from "@/lib/pricing/plans";

/** Qatar is UTC+3 all year. */
const QATAR_OFFSET_MS = 3 * 60 * 60 * 1000;
export const REPORT_MONTHS = 6;

export type DiscountOrderRow = {
  created_at: string | null;
  status?: string | null;
  is_test?: boolean | null;
  discount_qar?: number | string | null;
  credit_discount_qar?: number | string | null;
  shipping_qar?: number | string | null;
  handling_fee_qar?: number | string | null;
  total_qar?: number | string | null;
  shipping_tier?: string | null;
  split_shipments?: boolean | null;
};

export type CreditGrantRow = {
  created_at: string | null;
  delta?: number | string | null;
  reason?: string | null;
};

export type DiscountSettings = {
  /** QAR value of one credit. */
  creditQar: number;
  /** Free-delivery rule; null = none configured. */
  freeShipping: { thresholdQar: number; tiers: string[] } | null;
  /** Normal carrier fee per tier (one shipment). */
  tierFeeQar: Record<string, number>;
};

export type MonthTotals = {
  kitQar: number;
  creditRedeemedQar: number;
  /** Credits granted by an admin (units). */
  grantedCredits: number;
  grantQar: number;
  freeDeliveryQar: number;
  totalQar: number;
  /** Goods the customers paid for: after the kit discount and any credit, before shipping and handling. */
  goodsRevenueQar: number;
  /** totalQar / goodsRevenueQar x 100, or null when there is no revenue. */
  sharePct: number | null;
};

export type MonthRow = MonthTotals & {
  /** "2026-10" in Qatar time. */
  key: string;
  year: number;
  /** 1-12 */
  month: number;
  /** The month still running ("so far"). */
  current: boolean;
};

export type DiscountReport = {
  /** Newest month first. */
  months: MonthRow[];
  totals: MonthTotals;
  creditQar: number;
  /** Free delivery is estimated from the current fees (the order keeps only the tier). */
  freeDeliveryEstimated: boolean;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A money/count value from PostgREST (number or numeric string); NULL, NaN and negatives become 0. */
function nonNeg(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Year and month (1-12) of an instant in Qatar time; null for an invalid date. */
function qatarYm(iso: string | null | undefined): { y: number; m: number } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + QATAR_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

const keyOf = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}`;

/** "2026-10" for an instant in Qatar time (null when invalid). */
export function qatarMonthKey(iso: string | Date | null | undefined): string | null {
  const ym = qatarYm(iso instanceof Date ? (Number.isFinite(iso.getTime()) ? iso.toISOString() : null) : iso);
  return ym ? keyOf(ym.y, ym.m) : null;
}

/** The last `months` Qatar calendar months ending with the current one, newest first. */
export function monthKeys(now: Date, months = REPORT_MONTHS): { key: string; year: number; month: number }[] {
  const ym = qatarYm(Number.isFinite(now.getTime()) ? now.toISOString() : null);
  if (!ym) return [];
  const out: { key: string; year: number; month: number }[] = [];
  for (let i = 0; i < months; i++) {
    const idx = ym.y * 12 + (ym.m - 1) - i;
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    out.push({ key: keyOf(year, month), year, month });
  }
  return out;
}

/** ISO instant of 00:00 Qatar time on the 1st of the oldest month in the window: the query's created_at >= bound. */
export function windowStartIso(now: Date, months = REPORT_MONTHS): string {
  const oldest = monthKeys(now, months).at(-1);
  if (!oldest) return new Date(0).toISOString();
  return new Date(Date.UTC(oldest.year, oldest.month - 1, 1) - QATAR_OFFSET_MS).toISOString();
}

function asJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * store_settings values -> what the report needs. The credit value comes from
 * pricing_plans.overage_per_credit_qar (the price of one extra credit), with
 * the code default CREDIT_QAR as fallback. Anything missing or invalid is ignored.
 */
export function parseDiscountSettings(raw: {
  pricingPlans?: unknown;
  freeShipping?: unknown;
  shipping?: unknown;
}): DiscountSettings {
  const credit = parsePricingPlans(raw.pricingPlans).overage_per_credit_qar;
  const creditQar = Number.isFinite(credit) && credit > 0 ? credit : CREDIT_QAR;

  let freeShipping: DiscountSettings["freeShipping"] = null;
  const fs = asJson(raw.freeShipping);
  if (fs && typeof fs === "object") {
    const o = fs as { threshold_qar?: unknown; tiers?: unknown };
    const threshold = Number(o.threshold_qar);
    if (Number.isFinite(threshold) && threshold > 0) {
      freeShipping = {
        thresholdQar: threshold,
        tiers: Array.isArray(o.tiers) ? o.tiers.filter((t): t is string => typeof t === "string") : [],
      };
    }
  }

  const tierFeeQar: Record<string, number> = {};
  const sh = asJson(raw.shipping);
  const tiers = sh && typeof sh === "object" ? (sh as { tiers?: unknown }).tiers : null;
  if (tiers && typeof tiers === "object") {
    for (const [tier, v] of Object.entries(tiers as Record<string, unknown>)) {
      const fee = v && typeof v === "object" ? Number((v as { carrier_cost_qar?: unknown }).carrier_cost_qar) : NaN;
      if (Number.isFinite(fee) && fee > 0) tierFeeQar[tier] = fee;
    }
  }
  return { creditQar, freeShipping, tierFeeQar };
}

/** Free-delivery fee waived on one order (0 when it paid for shipping or did not qualify). */
export function waivedShippingQar(o: DiscountOrderRow, s: DiscountSettings): number {
  const fs = s.freeShipping;
  const tier = o.shipping_tier;
  if (!fs || !tier || !fs.tiers.includes(tier)) return 0;
  if (nonNeg(o.shipping_qar) > 0) return 0;
  // Goods subtotal as 0044 defines it: after the kit discount, before shipping,
  // handling and any credit redemption.
  const goods = nonNeg(o.total_qar) - nonNeg(o.handling_fee_qar) + nonNeg(o.credit_discount_qar);
  if (goods < fs.thresholdQar) return 0;
  const fee = s.tierFeeQar[tier] ?? 0;
  return fee * (o.split_shipments ? 2 : 1);
}

const emptyTotals = (): MonthTotals => ({
  kitQar: 0,
  creditRedeemedQar: 0,
  grantedCredits: 0,
  grantQar: 0,
  freeDeliveryQar: 0,
  totalQar: 0,
  goodsRevenueQar: 0,
  sharePct: null,
});

function finish<T extends MonthTotals>(r: T): T {
  r.kitQar = round2(r.kitQar);
  r.creditRedeemedQar = round2(r.creditRedeemedQar);
  r.grantQar = round2(r.grantQar);
  r.freeDeliveryQar = round2(r.freeDeliveryQar);
  r.goodsRevenueQar = round2(r.goodsRevenueQar);
  r.totalQar = round2(r.kitQar + r.creditRedeemedQar + r.grantQar + r.freeDeliveryQar);
  r.sharePct = r.goodsRevenueQar > 0 ? round2((r.totalQar / r.goodsRevenueQar) * 100) : null;
  return r;
}

export function buildDiscountReport(input: {
  orders: readonly DiscountOrderRow[];
  grants: readonly CreditGrantRow[];
  settings: DiscountSettings;
  now: Date;
  months?: number;
}): DiscountReport {
  const { orders, grants, settings, now } = input;
  const keys = monthKeys(now, input.months ?? REPORT_MONTHS);
  const currentKey = keys[0]?.key;
  const rows = new Map<string, MonthRow>(
    keys.map((k) => [k.key, { ...k, current: k.key === currentKey, ...emptyTotals() }])
  );

  for (const o of orders) {
    if (o.status === "cancelled" || o.is_test === true) continue;
    const row = rows.get(qatarMonthKey(o.created_at) ?? "");
    if (!row) continue;
    row.kitQar += nonNeg(o.discount_qar);
    row.creditRedeemedQar += nonNeg(o.credit_discount_qar);
    row.freeDeliveryQar += waivedShippingQar(o, settings);
    row.goodsRevenueQar += Math.max(0, nonNeg(o.total_qar) - nonNeg(o.shipping_qar) - nonNeg(o.handling_fee_qar));
  }

  for (const g of grants) {
    if (g.reason !== "admin_grant") continue;
    const units = nonNeg(g.delta); // only positive deltas; negative corrections are ignored
    if (units <= 0) continue;
    const row = rows.get(qatarMonthKey(g.created_at) ?? "");
    if (!row) continue;
    row.grantedCredits += units;
    row.grantQar += units * settings.creditQar;
  }

  const months = [...rows.values()].map(finish);
  const totals = emptyTotals();
  for (const m of months) {
    totals.kitQar += m.kitQar;
    totals.creditRedeemedQar += m.creditRedeemedQar;
    totals.grantedCredits += m.grantedCredits;
    totals.grantQar += m.grantQar;
    totals.freeDeliveryQar += m.freeDeliveryQar;
    totals.goodsRevenueQar += m.goodsRevenueQar;
  }
  return { months, totals: finish(totals), creditQar: settings.creditQar, freeDeliveryEstimated: true };
}
