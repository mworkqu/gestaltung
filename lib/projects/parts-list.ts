// A project's parts list, as the client sees it on the project page (P5-03,
// audit #3/#4). ONE source: the same lines the workspace bill of materials
// shows (bom.ts activeLines — one per item, removed lines left out) with the
// same store matches (/api/bom/match) and the same pack maths (lib/store/pack).
//
// Each line gets one plain status:
//   ordered    an order carries it (lines[].fulfilled, written by
//              create_part_order) and that order is not delivered
//   delivered  its order is delivered
//   in_cart    a cart line of this project holds it (cart_items.bom_lines)
//   to_buy     none of the above
//   have       already on the client's own shelf (nothing to buy)
// A cancelled order counts as never placed. A bought marker whose order can't
// be read (old rows, lookup failed) still reads "ordered".
//
// What the line is matched to is said in plain words (`source`): a store
// product, "we'll pick this part for you", "we'll source this", or made to
// order. No ids, no match scores. Pure and client-safe.

import { normaliseOrderStatus } from "@/lib/orders/status";
import { kitDiscountQar } from "@/lib/prototyping/kit-plan";
import {
  activeLines,
  buyable,
  groupOf,
  orderQty,
  packOf,
  type LineMatch,
  type ProjectBom,
  type ProjectLine,
  type ScoredCandidate,
} from "@/lib/prototyping/bom";

export type PartStatus = "to_buy" | "in_cart" | "ordered" | "delivered" | "have";

/** null = the store match has not come back yet. */
export type PartSource = "store" | "we_pick" | "we_source" | "made" | null;

export type PartsListLine = {
  lineId: string;
  /** The line's own words ("Motion sensor"). */
  name: string;
  need: number;
  status: PartStatus;
  source: PartSource;
  /** The store product, when there is one (bought lines: the one bought). */
  product: Pick<ScoredCandidate, "id" | "sku" | "name" | "name_ar" | "unit_price"> | null;
  /** Pieces per listing and listings to buy (only for a store product). */
  packSize: number;
  packs: number;
};

export type StatusInputs = {
  /** BOM line ids held by this project's cart lines (kit-plan cartLineIds). */
  inCart: ReadonlySet<string>;
  /** order id → status, for the orders the bought lines name; null when not read. */
  orderStatuses: ReadonlyMap<string, string> | null;
  /**
   * BOM line id → the product its cart line holds (cartProductsByLine). An
   * "In your cart" line names what is really in the cart, which can differ from
   * today's match (a cart filled before the matcher changed).
   */
  cartProducts?: ReadonlyMap<string, CartProduct>;
};

export type CartProduct = { id: string; sku: string; name: string; name_ar: string | null; unit_price: number };

/** The one status of a line, from its bought marker, the cart and its order. */
export function lineStatus(l: ProjectLine, m: LineMatch | undefined, { inCart, orderStatuses }: StatusInputs): PartStatus {
  const f = l.fulfilled;
  if (f) {
    const id = typeof f.orderId === "string" && f.orderId ? f.orderId : null;
    const st = id && orderStatuses ? normaliseOrderStatus(orderStatuses.get(id)) : null;
    if (st === "delivered") return "delivered";
    if (st !== "cancelled") return "ordered";
  }
  if (inCart.has(l.id)) return "in_cart";
  if (!f && m?.have) return "have";
  return "to_buy";
}

function sourceOf(l: ProjectLine, m: LineMatch | undefined): PartSource {
  if (groupOf(l) === "fabrication") return "made";
  if (l.fulfilled) return "store";
  if (!m) return null;
  if (m.have || buyable(l, m)) return "store";
  return m.status === "choose" ? "we_pick" : "we_source";
}

/** The project's parts list: every live BOM line, in the workspace's order. */
export function projectPartsList(
  bom: ProjectBom | null | undefined,
  matches: Map<string, LineMatch>,
  inputs: StatusInputs
): PartsListLine[] {
  return activeLines(bom).map((l) => {
    const m = matches.get(l.id);
    const source = sourceOf(l, m);
    const status = lineStatus(l, m, inputs);
    const inCartAs = status === "in_cart" ? inputs.cartProducts?.get(l.id) : undefined;
    const p = inCartAs ?? (source === "store" && !m?.have ? (m?.product ?? null) : null);
    return {
      lineId: l.id,
      name: l.function,
      need: Math.max(1, Math.ceil(Number(l.quantity) || 1)),
      status,
      source: inCartAs ? "store" : source,
      product: p ? { id: p.id, sku: p.sku, name: p.name, name_ar: p.name_ar, unit_price: p.unit_price } : null,
      packSize: p && !inCartAs ? packOf(p) : 1,
      packs: p && !inCartAs ? orderQty(l.quantity, p) : 0,
    };
  });
}

/** How many lines are in each status. */
export function statusCounts(list: ReadonlyArray<Pick<PartsListLine, "status">>): Record<PartStatus, number> {
  const out: Record<PartStatus, number> = { to_buy: 0, in_cart: 0, ordered: 0, delivered: 0, have: 0 };
  for (const l of list) out[l.status] += 1;
  return out;
}

/** BOM line id → the product of the cart line holding it, for one project. */
export function cartProductsByLine(
  items: ReadonlyArray<{ projectId?: string | null; bomLines?: string[]; partId: string; sku: string; name: string; nameAr: string | null; unitPrice: number }>,
  projectId: string
): Map<string, CartProduct> {
  const out = new Map<string, CartProduct>();
  for (const i of items)
    if (i.projectId === projectId)
      for (const id of i.bomLines ?? [])
        if (!out.has(id)) out.set(id, { id: i.partId, sku: i.sku, name: i.name, name_ar: i.nameAr, unit_price: i.unitPrice });
  return out;
}

type CartLike = { projectId?: string | null; kitId?: string | null; unitPrice: number; quantity: number };

/**
 * What this project's cart lines cost, priced the way the cart page prices
 * them: loose lines at unit price × quantity, each kit at its sum less the kit
 * discount. Same items, same total as the cart and checkout.
 */
export function projectCartTotal(items: ReadonlyArray<CartLike>, projectId: string, kitDiscountPct: number): number {
  const mine = items.filter((i) => i.projectId === projectId);
  const kits = new Map<string, number>();
  let loose = 0;
  for (const i of mine) {
    const v = i.unitPrice * i.quantity;
    if (i.kitId) kits.set(i.kitId, (kits.get(i.kitId) ?? 0) + v);
    else loose += v;
  }
  let total = loose;
  for (const sum of kits.values()) total += sum - kitDiscountQar(sum, kitDiscountPct);
  return Math.round(total * 100) / 100;
}
