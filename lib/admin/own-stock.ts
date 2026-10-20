// "Units on the shelf" on /dashboard/store/stock: the pure half of setting
// own_stock.qty by hand (a stock take, a loss, a correction).
//
// The page already loads every published product with its shelf count, so the
// panel neither queries nor searches again: it filters those rows with the
// same matcher the other dashboard lists use (matchesQuery, D2).

import { matchesQuery } from "@/lib/admin/pagination";
import type { StockItem, StockLists } from "@/lib/admin/stock-lists";

/** A shelf count is a hand-typed number; more than this is a typo, not stock. */
export const SHELF_QTY_MAX = 1_000_000;

/** Rows a search shows at once (a stock take is done product by product). */
export const SHELF_SEARCH_LIMIT = 20;

export type ShelfRow = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  /** Shop price today, so the panel can say what it will be fixed at. */
  price: number;
  /** The price follows the supplier's retail price (parts.pricing_mode = 'mirror'). */
  mirror: boolean;
};

/** A 'mirror' product follows its supplier's retail price. */
export function isMirror(pricingMode: string | null | undefined): boolean {
  return String(pricingMode ?? "").toLowerCase() === "mirror";
}

/**
 * A hand-typed shelf count: a whole number from 0 to SHELF_QTY_MAX.
 * Anything else (blank, text, negative, a fraction of a unit) is null — a
 * typo must never be read as "empty the shelf".
 */
export function parseShelfQty(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n > SHELF_QTY_MAX) return null;
  return n;
}

export type ShelfPlan = {
  qty: number;
  /** Above zero: give the product the own-stock offer at 1 day. */
  giveOwnOffer: boolean;
  /** Back to zero: park the own-stock offer (never delete it). */
  parkOwnOffer: boolean;
  /**
   * Above zero on a mirror product: switch it to 'markup' first, or the
   * own-stock offer can never win (see below). The shop price does not move —
   * refresh_part_sourcing writes unit_price back unchanged in markup mode — it
   * simply stops following the supplier from that moment.
   */
  fixPrice: boolean;
};

/**
 * What setting the count to `qty` has to do besides writing the number.
 *
 * 1. Holding units does not by itself create a supplier offer, so a product
 *    with qty > 0 and no own-stock offer is still sourced from Voltaat or
 *    DigiKey. Above zero we add the same offer the Fix list's "Set delivery
 *    time -> Own stock in Lusail" adds.
 * 2. That offer still loses on a MIRROR product: 0095 only lets an offer with
 *    a retail price whose supplier has a commission win for a mirror product,
 *    and the own-stock supplier is created with no commission (0095 seeds it
 *    the same way). The whole Voltaat catalogue is mirror, so without this the
 *    offer would be written and silently ignored. Holding our own stock means
 *    we set the price rather than following Voltaat, so the product moves to
 *    'markup'. It is NOT moved back at zero: that would start the price
 *    following Voltaat again behind the owner's back.
 * 3. Back at zero the offer is *parked*, not deleted: the cost, SKU and link
 *    stay for the next delivery, and the shelf only stops winning.
 */
export function shelfPlan(qty: number, opts: { mirror?: boolean } = {}): ShelfPlan {
  const on = qty > 0;
  return { qty, giveOwnOffer: on, parkOwnOffer: qty === 0, fixPrice: on && opts.mirror === true };
}

const rowOf = (it: StockItem): ShelfRow => ({
  id: it.part.id,
  sku: it.part.sku,
  name: it.part.name,
  qty: it.part.ownQty,
  price: it.part.price,
  mirror: isMirror(it.part.pricingMode),
});

/** Every product the page loaded, by name — what the panel searches. */
export function allShelfRows(lists: StockLists): ShelfRow[] {
  return [...lists.buy, ...lists.watch, ...lists.dont].map(rowOf).sort((a, b) => a.name.localeCompare(b.name));
}

/** The products we actually hold — shown without searching, for a stock take. */
export function onShelfRows(lists: StockLists): ShelfRow[] {
  return allShelfRows(lists).filter((r) => r.qty > 0);
}

/** Search hits by name or SKU (blank query = no hits; the shelf list shows instead). */
export function searchShelfRows(rows: readonly ShelfRow[], q: string, limit: number = SHELF_SEARCH_LIMIT): ShelfRow[] {
  if (!q.trim()) return [];
  return rows.filter((r) => matchesQuery(q, [r.name, r.sku])).slice(0, Math.max(0, limit));
}
