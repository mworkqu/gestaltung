// "What should I buy?" in three plain lists (owner, 2026-10-10, P5-12).
//   Buy now    asked for, or added to a cart, in the last 30 days AND we have none.
//   Watch      some interest (views, older signals) or we have some already.
//   Do not buy no interest at all.
// Pure: no I/O. The page loads signals + products and calls classifyStock();
// the draft order reuses lib/store/restock.ts (orderQty, estimatedUnits,
// groupDraft, draftCsv) so quantities, supplier minimums and the CSV match the
// detailed restock table.

import { isTestRow } from "@/lib/admin/test-data";
import {
  draftCsv,
  estimatedUnits,
  groupDraft,
  orderQty,
  type DraftGroup,
  type RestockRow,
  type SignalCounts,
} from "@/lib/store/restock";

export const BUY_WINDOW_DAYS = 30;

export type SignalKind = "view" | "add_to_cart" | "request";

export type StockSignal = {
  partId: string;
  kind: SignalKind;
  quantity?: number | null;
  userId?: string | null;
  createdAt: string;
};

export type StockPart = {
  id: string;
  sku: string;
  name: string;
  isTest?: boolean | null;
  photo: string | null;
  price: number;
  landedCost: number | null;
  supplier: { id: string; name: string; minOrderValue: number | null } | null;
  supplierSku: string | null;
  supplierUrl: string | null;
  moq: number;
  leadTimeClass: string | null;
  /** Units we hold ourselves (Lusail). 0 when none. */
  ownQty: number;
};

export type StockBucket = "buy" | "watch" | "dont";

export type Interest = {
  /** Distinct people (signed-in or guest sessions) who added it to a cart, last 30 days. */
  cartPeople: number;
  /** Distinct people who asked for it, last 30 days. */
  requestPeople: number;
  /** Units asked for in those requests. */
  requestedQty: number;
  /** Cart adds + requests older than the window (still open). */
  olderSignals: number;
  views: number;
};

export type StockItem = {
  part: StockPart;
  bucket: StockBucket;
  interest: Interest;
  /** Suggested quantity to order (>= supplier minimum quantity, >= 1). */
  qty: number;
};

export type StockLists = { buy: StockItem[]; watch: StockItem[]; dont: StockItem[] };

const DAY_MS = 864e5;

/** People behind a set of signals: distinct user ids, plus one per signal with no user. */
export function peopleCount(signals: Pick<StockSignal, "userId">[]): number {
  const users = new Set<string>();
  let anonymous = 0;
  for (const s of signals) {
    if (s.userId) users.add(s.userId);
    else anonymous++;
  }
  return users.size + anonymous;
}

export function emptyInterest(): Interest {
  return { cartPeople: 0, requestPeople: 0, requestedQty: 0, olderSignals: 0, views: 0 };
}

/** Interest of one product from its (open) signals. */
export function interestOf(signals: StockSignal[], now: number, windowDays = BUY_WINDOW_DAYS): Interest {
  const cutoff = now - windowDays * DAY_MS;
  const recentCarts: StockSignal[] = [];
  const recentRequests: StockSignal[] = [];
  const out = emptyInterest();
  for (const s of signals) {
    const at = Date.parse(s.createdAt);
    const recent = Number.isFinite(at) && at >= cutoff;
    if (s.kind === "view") out.views++;
    else if (!recent) out.olderSignals++;
    else if (s.kind === "add_to_cart") recentCarts.push(s);
    else {
      recentRequests.push(s);
      out.requestedQty += Math.max(1, Math.trunc(Number(s.quantity) || 1));
    }
  }
  out.cartPeople = peopleCount(recentCarts);
  out.requestPeople = peopleCount(recentRequests);
  return out;
}

export function hasRecentDemand(i: Interest): boolean {
  return i.cartPeople + i.requestPeople > 0;
}

export function hasAnyInterest(i: Interest): boolean {
  return hasRecentDemand(i) || i.olderSignals > 0 || i.views > 0;
}

/** Counts in the shape lib/store/restock.ts wants. */
export function signalCounts(i: Interest): SignalCounts {
  return { views: i.views, carts: i.cartPeople, requests: i.requestPeople, requestedQty: i.requestedQty };
}

/** Units to order: what people want (requested units + one per cart) minus what we hold, never below the supplier minimum. */
export function suggestedQty(part: Pick<StockPart, "moq" | "ownQty">, i: Interest): number {
  const wanted = estimatedUnits(signalCounts(i));
  const units = Math.max(0, wanted - Math.max(0, part.ownQty));
  return orderQty({ units, moq: part.moq });
}

export function bucketOf(part: Pick<StockPart, "ownQty">, i: Interest): StockBucket {
  const have = part.ownQty > 0;
  if (hasRecentDemand(i) && !have) return "buy";
  if (hasAnyInterest(i) || have) return "watch";
  return "dont";
}

/** Strength used to order a list: people who asked count most, then cart adds, then the rest. */
function weight(i: Interest): number {
  return i.requestPeople * 10 + i.cartPeople * 5 + i.olderSignals * 2 + i.views;
}

/**
 * Sorts every product into Buy now / Watch / Do not buy. Test products
 * (is_test, TEST in the name or SKU, ids on the cleanup list) are left out.
 */
export function classifyStock(
  parts: StockPart[],
  signals: StockSignal[],
  opts: { now?: number; windowDays?: number } = {}
): StockLists {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? BUY_WINDOW_DAYS;
  const byPart = new Map<string, StockSignal[]>();
  for (const s of signals) {
    const list = byPart.get(s.partId);
    if (list) list.push(s);
    else byPart.set(s.partId, [s]);
  }

  const lists: StockLists = { buy: [], watch: [], dont: [] };
  for (const part of parts) {
    if (isTestRow({ id: part.id, is_test: part.isTest, texts: [part.name, part.sku] })) continue;
    const interest = interestOf(byPart.get(part.id) ?? [], now, windowDays);
    const bucket = bucketOf(part, interest);
    lists[bucket].push({ part, bucket, interest, qty: suggestedQty(part, interest) });
  }
  const strongest = (a: StockItem, b: StockItem) =>
    weight(b.interest) - weight(a.interest) || a.part.name.localeCompare(b.part.name);
  lists.buy.sort(strongest);
  lists.watch.sort(strongest);
  lists.dont.sort((a, b) => a.part.name.localeCompare(b.part.name));
  return lists;
}

/** A stock item as the restock draft-order helpers expect it. */
export function toRestockRow(item: StockItem): RestockRow {
  const { part, interest } = item;
  const counts = signalCounts(interest);
  const units = estimatedUnits(counts);
  return {
    partId: part.id,
    sku: part.sku,
    name: part.name,
    counts,
    score: 0,
    price: part.price,
    landedCost: part.landedCost,
    income: null,
    incomePct: null,
    leadTimeClass: part.leadTimeClass,
    supplier: part.supplier,
    supplierSku: part.supplierSku,
    supplierUrl: part.supplierUrl,
    moq: part.moq,
    units,
    estRevenue: Math.round(units * part.price * 100) / 100,
  };
}

/** Chosen items (id -> quantity) grouped per supplier, ready for the WhatsApp text and the CSV. */
export function buildOrderGroups(items: StockItem[], picked: Record<string, number>): DraftGroup[] {
  const lines = items
    .filter((it) => picked[it.part.id] !== undefined)
    .map((it) => ({ row: toRestockRow(it), qty: Math.max(1, Math.trunc(picked[it.part.id]) || 1) }));
  return groupDraft(lines);
}

export function groupsCsv(groups: DraftGroup[]): string {
  return draftCsv(groups);
}

/**
 * Plain text for WhatsApp, one block per supplier:
 *
 *   Voltaat
 *   4 x Arduino Uno R3 (VLT-1)
 *   2 x Relay module
 *
 * No prices, scores or margins: the supplier gets what to send, nothing else.
 */
export function whatsappText(groups: DraftGroup[], heading?: string): string {
  const blocks: string[] = [];
  for (const g of groups) {
    const lines = g.lines.map((l) => {
      const code = l.row.supplierSku ? ` (${l.row.supplierSku})` : "";
      return `${l.qty} x ${l.row.name}${code}`;
    });
    blocks.push([g.supplierName || "-", ...lines].join("\n"));
  }
  const body = blocks.join("\n\n");
  return heading ? `${heading}\n\n${body}` : body;
}
