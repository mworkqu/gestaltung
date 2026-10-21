// Fix list grouping (D1): one group per issue (Delivery date · Photo · Price ·
// Supplier) with counts, and inside Delivery date one sub-group per supplier.
// Every row says WHY in plain words (a reason code + supplier name; the page
// turns it into copy). Pure, no I/O; lib/admin/fix-data.ts loads the rows.

import type { FixIssue } from "@/lib/admin/home-tiles";
import { OWN_STOCK_SUPPLIER } from "@/lib/sourcing/lead-times";

/** Supplier code of the "Own stock in Lusail" offers (0095 seeds the row). */
export const OWN_STOCK_SUPPLIER_CODE = OWN_STOCK_SUPPLIER;

/** store_settings key: part ids the owner marked "on request" from the Fix list. */
export const ON_REQUEST_KEY = "fix_on_request";

export const ISSUE_ORDER: readonly FixIssue[] = ["delivery", "photo", "price", "supplier"];

export const SUPPLIER_BUCKETS = ["voltaat", "mouser", "digikey", "ali", "own", "other", "none"] as const;
export type SupplierBucket = (typeof SUPPLIER_BUCKETS)[number];

export type FixOffer = {
  supplierCode: string | null;
  supplierName: string | null;
  supplierActive: boolean;
  commission: number | null;
  active: boolean;
  availability: string | null;
  leadDays: number | null;
  retailPrice: number | null;
};

export type WhyCode =
  | "noOffer"
  | "offerOff"
  | "supplierOff"
  | "mirrorNoRetail"
  | "outOfStock"
  | "noLeadTime"
  | "notWorkedOut";

export type Why = { code: WhyCode; supplier: string | null };

function bucketOfCode(code: string | null | undefined): SupplierBucket | null {
  const c = String(code ?? "").toLowerCase();
  if (!c) return null;
  if (c === OWN_STOCK_SUPPLIER_CODE) return "own";
  if (c === "voltaat") return "voltaat";
  if (c === "mouser") return "mouser";
  if (c === "digikey") return "digikey";
  if (c === "alibaba" || c === "aliexpress") return "ali";
  return "other";
}

function bucketOfSku(sku: string | null | undefined): SupplierBucket | null {
  const s = String(sku ?? "").toUpperCase();
  if (s.startsWith("VLT-")) return "voltaat";
  if (s.startsWith("MS-")) return "mouser";
  if (s.startsWith("DK-")) return "digikey";
  return null;
}

/** The offer that best describes where the product comes from: active first. */
export function mainOffer(offers: FixOffer[]): FixOffer | null {
  return offers.find((o) => o.active && o.supplierActive) ?? offers.find((o) => o.active) ?? offers[0] ?? null;
}

/**
 * Supplier sub-group: own stock (shelf count or an own-stock offer) wins, then
 * the main offer's supplier, then the SKU prefix (VLT- = Voltaat), else none.
 */
export function supplierBucket(p: { sku?: string | null; inOwnStock?: boolean | null; offers: FixOffer[] }): SupplierBucket {
  if (p.inOwnStock || p.offers.some((o) => bucketOfCode(o.supplierCode) === "own")) return "own";
  const main = mainOffer(p.offers);
  return bucketOfCode(main?.supplierCode) ?? bucketOfSku(p.sku) ?? "none";
}

const OUT = new Set(["unavailable", "backorder"]);

/**
 * Why the delivery date is missing (lead_time_class is null). The date comes
 * from the preferred ACTIVE offer of an ACTIVE supplier; a mirror-priced
 * product only follows an offer with a retail price and a commission (0028).
 */
export function deliveryWhy(p: { pricingMode?: string | null; offers: FixOffer[] }): Why {
  const offers = p.offers;
  if (offers.length === 0) return { code: "noOffer", supplier: null };
  const active = offers.filter((o) => o.active);
  if (active.length === 0) {
    const o = offers[0];
    return { code: OUT.has(String(o.availability)) ? "outOfStock" : "offerOff", supplier: o.supplierName };
  }
  const usable = active.filter((o) => o.supplierActive);
  if (usable.length === 0) return { code: "supplierOff", supplier: active[0].supplierName };
  const mirror = p.pricingMode === "mirror";
  const eligible = mirror ? usable.filter((o) => o.retailPrice !== null && o.commission !== null) : usable;
  if (eligible.length === 0) return { code: "mirrorNoRetail", supplier: usable[0].supplierName };
  const first = eligible[0];
  if (eligible.every((o) => OUT.has(String(o.availability)))) return { code: "outOfStock", supplier: first.supplierName };
  if (eligible.every((o) => o.leadDays === null)) return { code: "noLeadTime", supplier: first.supplierName };
  return { code: "notWorkedOut", supplier: first.supplierName };
}

/**
 * Out of stock at the supplier is NOT a gap for the owner to fix (owner,
 * 2026-10-19): the product is simply "available on request" until the
 * supplier has it again, and nagging about it every day is noise. These
 * products leave the Fix list on their own and stay in the "available on
 * request" count on the admin overview, exactly as if they had been marked
 * on request by hand.
 */
export function isAutoOnRequest(why: Why | null | undefined): boolean {
  return why?.code === "outOfStock";
}

export type FixRow = {
  id: string;
  name: string;
  sku: string | null;
  issues: FixIssue[];
  bucket: SupplierBucket;
  /** Only when "delivery" is one of the issues. */
  why: Why | null;
};

export type FixSubGroup = { bucket: SupplierBucket; rows: FixRow[] };
export type FixGroup = { issue: FixIssue; count: number; rows: FixRow[]; subGroups: FixSubGroup[] | null };

/** Groups in ISSUE_ORDER (empty ones dropped); Delivery date split by supplier. A row with two issues is in two groups. */
export function groupFixRows(rows: FixRow[]): FixGroup[] {
  const out: FixGroup[] = [];
  for (const issue of ISSUE_ORDER) {
    const inGroup = rows.filter((r) => r.issues.includes(issue));
    if (inGroup.length === 0) continue;
    let subGroups: FixSubGroup[] | null = null;
    if (issue === "delivery") {
      subGroups = SUPPLIER_BUCKETS.map((bucket) => ({ bucket, rows: inGroup.filter((r) => r.bucket === bucket) })).filter(
        (g) => g.rows.length > 0
      );
    }
    out.push({ issue, count: inGroup.length, rows: inGroup, subGroups });
  }
  return out;
}

/** Part ids from store_settings[ON_REQUEST_KEY] ({ids: string[]}); junk → empty. */
export function parseOnRequest(value: unknown): Set<string> {
  const ids = value && typeof value === "object" ? (value as { ids?: unknown }).ids : null;
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64));
}

export type BulkItemResult = { id: string; name: string; ok: boolean; reason?: string };
export type BulkSummary = { fixed: number; failed: { id: string; name: string; reason: string }[] };

/** "23 fixed, 2 failed" + the failures with their reason. Later results for the same id win. */
export function summariseBulk(results: BulkItemResult[]): BulkSummary {
  const byId = new Map<string, BulkItemResult>();
  for (const r of results) byId.set(r.id, r);
  const all = [...byId.values()];
  return {
    fixed: all.filter((r) => r.ok).length,
    failed: all.filter((r) => !r.ok).map((r) => ({ id: r.id, name: r.name, reason: r.reason ?? "unknown" })),
  };
}

/** Split ids into chunks (the client sends bulk actions in small batches). */
export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.trunc(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** The row after `id` in display order (wraps to the one before when it was last), for focus after a fix. */
export function nextRowId(order: string[], id: string): string | null {
  const i = order.indexOf(id);
  if (i < 0) return order[0] ?? null;
  const rest = order.filter((x, j) => j !== i && x !== id);
  if (rest.length === 0) return null;
  return order.slice(i + 1).find((x) => x !== id) ?? rest[rest.length - 1];
}
