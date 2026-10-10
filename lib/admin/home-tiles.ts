// The four numbers on the owner's dashboard home (P5-12): Reply, Confirm, Buy, Fix.
// Pure counting rules; the page loads rows and passes them in. Test data
// (is_test, TEST in the text, ids on docs/TEST_DATA_CLEANUP.md) never counts.

import { isTestRow } from "@/lib/admin/test-data";

/**
 * Order statuses that wait for the owner (lib/orders/status.ts chain:
 * confirmed -> paid -> sourcing -> shipped -> delivered). "pending" is the
 * pre-0053 name of "confirmed". Once an order is in sourcing or shipped the
 * owner has already handled it, so it is not on the Confirm tile.
 */
export const ORDER_STATUSES_TO_HANDLE: readonly string[] = ["pending", "confirmed", "paid"];

export type LeadRow = {
  id?: string | null;
  status?: string | null;
  name?: string | null;
  message?: string | null;
  is_test?: boolean | null;
};

/** Reply: new messages (inquiries with status "new") that are not test rows. */
export function countReply(leads: LeadRow[]): number {
  return leads.filter(
    (l) => l.status === "new" && !isTestRow({ id: l.id, is_test: l.is_test, texts: [l.name, l.message] })
  ).length;
}

export type OrderRow = {
  id?: string | null;
  status?: string | null;
  customer_name?: string | null;
  is_test?: boolean | null;
};

/** Confirm: orders that need the owner (see ORDER_STATUSES_TO_HANDLE), not test rows. */
export function countConfirm(orders: OrderRow[]): number {
  return orders.filter(
    (o) =>
      ORDER_STATUSES_TO_HANDLE.includes(String(o.status ?? "")) &&
      !isTestRow({ id: o.id, is_test: o.is_test, texts: [o.customer_name] })
  ).length;
}

export type FixIssue = "photo" | "price" | "supplier" | "delivery";

export type FixPart = {
  id?: string | null;
  sku?: string | null;
  name?: string | null;
  is_test?: boolean | null;
  is_published?: boolean | null;
  merged_into?: string | null;
  unit_price?: number | string | null;
  image_url?: string | null;
  images?: unknown;
  lead_time_class?: string | null;
  /** True when the product has at least one supplier offer (active or not). */
  hasSupplier: boolean;
};

function hasPhoto(p: FixPart): boolean {
  if (typeof p.image_url === "string" && /^https?:\/\//i.test(p.image_url.trim())) return true;
  return Array.isArray(p.images) && p.images.some((im) => !!im && typeof im === "object" && !!(im as { web?: unknown }).web);
}

/** What is missing on a published product. Empty list = nothing to fix. */
export function fixIssues(p: FixPart): FixIssue[] {
  const issues: FixIssue[] = [];
  if (!hasPhoto(p)) issues.push("photo");
  const price = Number(p.unit_price);
  if (!Number.isFinite(price) || price <= 0) issues.push("price");
  if (!p.hasSupplier) issues.push("supplier");
  if (!p.lead_time_class) issues.push("delivery");
  return issues;
}

/** Published, not merged away, not test. */
export function isLiveProduct(p: FixPart): boolean {
  if (p.is_published !== true || p.merged_into) return false;
  return !isTestRow({ id: p.id, is_test: p.is_test, texts: [p.name, p.sku] });
}

/** Fix: published products missing a photo, price, supplier or delivery date. */
export function countFix(parts: FixPart[]): number {
  return parts.filter((p) => isLiveProduct(p) && fixIssues(p).length > 0).length;
}

export type TileKey = "reply" | "confirm" | "buy" | "fix";

export type HomeTile = { key: TileKey; count: number; href: string };

/** The four tiles in the order they are shown. */
export function buildTiles(counts: Record<TileKey, number>): HomeTile[] {
  return [
    { key: "reply", count: counts.reply, href: "/dashboard/leads" },
    { key: "confirm", count: counts.confirm, href: "/dashboard/store/orders" },
    { key: "buy", count: counts.buy, href: "/dashboard/store/stock" },
    { key: "fix", count: counts.fix, href: "/dashboard/store/fix" },
  ];
}
