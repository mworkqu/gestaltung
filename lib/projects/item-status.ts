// ── Where a part on a project actually is (audit #3, #47 customer side) ─────
//
// A project line is one of:
//   ordered   — a placed order carries it for this project (0025
//               part_order_items.project_id); the newest live order wins
//   delivered — every live order carrying it has been delivered
//   in_cart   — a cart line tagged with this project holds it, not yet ordered
//   to_buy    — units still missing, in no cart and no order
//               (missingQty is reported for every kind: see below)
//   yours     — every unit came off the client's own shelf; nothing to buy
//
// Ordered beats in-cart: a line bought in part and still in the cart for the
// rest has been ordered. Cancelled orders count as never placed.
//
// Pure — the caller reads the rows (RLS scopes them to the signed-in user).

// The 0053 set plus the two old values rows may still carry before 0053 runs.
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "paid"
  | "processing"
  | "sourcing"
  | "shipped"
  | "delivered"
  | "cancelled";

export type StatusItem = {
  product_id: string;
  quantity: number;
  qty_from_inventory: number;
};

export type StatusCartRow = {
  product_id: string;
  quantity: number;
};

export type StatusOrderLine = {
  part_id: string;
  quantity: number;
  /** The joined part_orders row; null when the order is not readable. */
  order: { id: string; status: OrderStatus | string; created_at?: string | null } | null;
};

export type ItemStatusKind = "ordered" | "delivered" | "in_cart" | "to_buy" | "yours";

export type ItemStatus = {
  kind: ItemStatusKind;
  orderId?: string;
  orderStatus?: string;
  /** First 8 characters of the order id, as shown to the client. */
  shortId?: string;
  /** Units on live (not cancelled) orders for this project. */
  orderedQty: number;
  /** Units in the cart for this project. */
  cartQty: number;
  /**
   * Units that came off the client's own shelf. Bought units are also written
   * to qty_from_inventory by create_part_order (0027), so they are taken out
   * here to avoid counting them twice.
   */
  shelfQty: number;
  /**
   * Units still missing: not held (shelf or bought) and not in the cart.
   * Shown as "to buy" whatever the kind — a line can be part-delivered and
   * still short.
   */
  missingQty: number;
};

export function shortOrderId(id: string): string {
  return id.slice(0, 8);
}

export function deriveItemStatus({
  item,
  cartRows,
  orderLines,
}: {
  item: StatusItem;
  cartRows: StatusCartRow[];
  orderLines: StatusOrderLine[];
}): ItemStatus {
  const live = orderLines.filter(
    (l) => l.part_id === item.product_id && l.order && l.order.status !== "cancelled"
  );
  const orderedQty = live.reduce((n, l) => n + Math.max(0, l.quantity), 0);
  const cartQty = cartRows
    .filter((r) => r.product_id === item.product_id)
    .reduce((n, r) => n + Math.max(0, r.quantity), 0);
  const shelfQty = Math.max(0, item.qty_from_inventory - orderedQty);
  const missingQty = Math.max(0, item.quantity - item.qty_from_inventory - cartQty);
  const base = { orderedQty, cartQty, shelfQty, missingQty };

  if (live.length > 0) {
    const open = live.filter((l) => l.order!.status !== "delivered");
    const pick = newest(open.length > 0 ? open : live).order!;
    return {
      ...base,
      kind: open.length > 0 ? "ordered" : "delivered",
      orderId: pick.id,
      orderStatus: pick.status,
      shortId: shortOrderId(pick.id),
    };
  }

  if (cartQty > 0) return { ...base, kind: "in_cart" };
  if (item.quantity - item.qty_from_inventory > 0) return { ...base, kind: "to_buy" };
  return { ...base, kind: "yours" };
}

function newest(lines: StatusOrderLine[]): StatusOrderLine {
  return lines.reduce((best, l) =>
    (l.order?.created_at ?? "") > (best.order?.created_at ?? "") ? l : best
  );
}

// ── Project-level summary for the /projects cards ───────────────────────────

export type ProjectStatusKind = "ordered" | "in_cart" | "planning";

/** Ordered if any live order carries the project, else in cart, else planning. */
export function deriveProjectStatus({
  hasLiveOrder,
  hasCartLine,
}: {
  hasLiveOrder: boolean;
  hasCartLine: boolean;
}): ProjectStatusKind {
  if (hasLiveOrder) return "ordered";
  if (hasCartLine) return "in_cart";
  return "planning";
}
