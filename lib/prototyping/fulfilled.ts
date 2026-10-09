// How a BOM line fulfilled by an order is labelled (SITE_AUDIT #3).
//
// create_part_order writes lines[].fulfilled = {orderId, at, productId, sku,
// quantity} (0025 onward). The BOM shows which order and where it stands:
//   ordered    "Ordered #1a2b3c4d · Shipped" — the order's current status
//   delivered  "Delivered"
//   bought     the plain label: a marker without an order id, or the order's
//              status could not be read (the lookup failed or the order is
//              not visible to this user)
//
// Pure and client-safe.

import type { PartOrderStatus } from "@/lib/supabase/types";
import { normaliseOrderStatus } from "@/lib/orders/status";
import type { Fulfilled } from "./bom";

export type FulfilledLabel =
  | { kind: "bought" }
  | { kind: "delivered"; ref: string }
  | { kind: "ordered"; ref: string; status: PartOrderStatus };

/** The short order reference customers see elsewhere (checkout success, admin): first 8 characters. */
export function orderRef(orderId: string): string {
  return orderId.slice(0, 8);
}

/** Distinct order ids among fulfilled lines, in first-seen order. */
export function fulfilledOrderIds(lines: ReadonlyArray<{ fulfilled?: Partial<Fulfilled> | null }>): string[] {
  const ids: string[] = [];
  for (const l of lines) {
    const id = l.fulfilled?.orderId;
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The label for a fulfilled line. `statuses` maps order id → status; null when
 * the lookup failed (or has not run), which falls back to the plain label.
 */
export function fulfilledLabel(
  f: Partial<Fulfilled> | null | undefined,
  statuses: ReadonlyMap<string, string> | null
): FulfilledLabel | null {
  if (!f) return null;
  const id = typeof f.orderId === "string" && f.orderId ? f.orderId : null;
  if (!id || !statuses) return { kind: "bought" };
  // Old (pre-0053) values map onto the new set: pending → confirmed, processing → sourcing.
  const status = normaliseOrderStatus(statuses.get(id));
  if (!status) return { kind: "bought" };
  if (status === "delivered") return { kind: "delivered", ref: orderRef(id) };
  return { kind: "ordered", ref: orderRef(id), status: status as PartOrderStatus };
}
