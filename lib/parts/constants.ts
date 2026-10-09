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

// localStorage key for the guest cart.
export const CART_KEY = "gestaltung:cart";

// sessionStorage key holding a snapshot of the just-placed order, so the
// (guest-safe) success page can render a summary without reading it back from
// the DB — RLS hides a guest's own order rows.
export const LAST_ORDER_KEY = "gestaltung:last-order";
