// Shared constants for the Parts Store (catalog, checkout, admin).

import type { StockStatus, PartOrderStatus } from "@/lib/supabase/types";
import { ORDER_STATUSES } from "@/lib/orders/status";

export const STOCK_STATUSES: readonly StockStatus[] = [
  "in_stock",
  "low_stock",
  "out_of_stock",
] as const;

// The 0053 set (confirmed → paid → sourcing → shipped → delivered, cancelled).
// Rules and the legacy mapping live in lib/orders/status.ts.
export const PART_ORDER_STATUSES: readonly PartOrderStatus[] = ORDER_STATUSES;

// Delivery areas offered at checkout (the form select). Stored as-is in
// part_orders.delivery_area.
export const DELIVERY_AREAS = [
  "doha",
  "lusail",
  "al_wakra",
  "industrial_area",
  "other",
] as const;
export type DeliveryArea = (typeof DELIVERY_AREAS)[number];

// The storage keys now live in ./storage-keys, an import-free leaf, so code in
// the locale layout (the cart) can read them without this file's order-status
// import. Re-exported here, where they have always been read from.
export { CART_KEY, LAST_ORDER_KEY } from "./storage-keys";
