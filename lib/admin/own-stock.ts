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

export type ShelfRow = { id: string; sku: string; name: string; qty: number };

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
};

/**
 * What setting the count to `qty` has to do besides writing the number.
 *
 * Holding units does not by itself create a supplier offer, so a product with
 * qty > 0 and no own-stock offer is still sourced from Voltaat or DigiKey.
 * Above zero we therefore add the same offer the Fix list's "Set delivery time
 * -> Own stock in Lusail" adds. Back at zero the offer is *parked*, not
 * deleted: the cost, SKU and link stay for the next delivery, and the shelf
 * only stops winning the sourcing rule.
 */
export function shelfPlan(qty: number): ShelfPlan {
  return { qty, giveOwnOffer: qty > 0, parkOwnOffer: qty === 0 };
}

const rowOf = (it: StockItem): ShelfRow => ({
  id: it.part.id,
  sku: it.part.sku,
  name: it.part.name,
  qty: it.part.ownQty,
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
