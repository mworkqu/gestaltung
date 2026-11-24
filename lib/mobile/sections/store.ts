// "Store" — the catalogue as it stands: what is published, what it is worth,
// what is held in Lusail, what sells, and what people ask for and do not find.
//
// Pure: rows in, one Section out.

import {
  breakdown,
  daily,
  delta,
  int,
  inPreviousWindow,
  label,
  money,
  num,
  pct,
  sumBy,
  tally,
  toneUp,
  within,
  type Section,
  type Table,
} from "@/lib/mobile/report";

export type PartRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  store_category: string | null;
  unit_price: number | string | null;
  landed_cost_qar: number | string | null;
  lead_time_class: string | null;
  stock_status: string | null;
  is_published: boolean | null;
  merged_into: string | null;
  is_test: boolean | null;
  in_own_stock: boolean | null;
  created_at: string | null;
};

export type OwnStockRow = { part_id: string; qty: number | string | null };

export type OrderItemRow = {
  order_id: string | null;
  part_id: string | null;
  part_sku: string | null;
  part_name: string | null;
  quantity: number | null;
  line_total_qar: number | string | null;
};

export type SignalRow = {
  kind: string | null;
  part_id: string | null;
  search_term: string | null;
  source_page: string | null;
  served_at: string | null;
  created_at: string | null;
};

export type StoreInput = {
  parts: PartRow[];
  ownStock: OwnStockRow[];
  /** Order lines joined to their order's created_at, newest orders first. */
  orderItems: (OrderItemRow & { created_at: string | null })[];
  signals: SignalRow[];
  windowDays: number;
  now?: number;
};

const LOW_STOCK = 3;

export function buildStore(input: StoreInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  // A merged product is a duplicate that now points at its survivor: it is not
  // a product any more, so it is left out of every figure here.
  const live = input.parts.filter((p) => !p.merged_into && p.is_test !== true);
  const published = live.filter((p) => p.is_published);
  const onRequest = published.filter((p) => !p.lead_time_class);

  const stock = new Map(input.ownStock.map((s) => [s.part_id, num(s.qty)]));
  const held = published.filter((p) => (stock.get(p.id) ?? 0) > 0);
  const low = published
    .filter((p) => p.in_own_stock && (stock.get(p.id) ?? 0) <= LOW_STOCK)
    .sort((a, b) => (stock.get(a.id) ?? 0) - (stock.get(b.id) ?? 0));

  const stockValue = held.reduce((sum, p) => sum + (stock.get(p.id) ?? 0) * num(p.landed_cost_qar), 0);
  const retailValue = held.reduce((sum, p) => sum + (stock.get(p.id) ?? 0) * num(p.unit_price), 0);

  // Margin: only products with both numbers can say anything.
  const priced = published.filter((p) => num(p.unit_price) > 0 && num(p.landed_cost_qar) > 0);
  const margins = priced.map((p) => (num(p.unit_price) - num(p.landed_cost_qar)) / num(p.unit_price));
  const medianMargin = median(margins);

  const soldNow = input.orderItems.filter((l) => within(l.created_at, days, now));
  const soldBefore = input.orderItems.filter((l) => inPreviousWindow(l.created_at, days, now));
  const unitsNow = soldNow.reduce((s, l) => s + (l.quantity ?? 0), 0);
  const unitsBefore = soldBefore.reduce((s, l) => s + (l.quantity ?? 0), 0);

  const bestSellers = sumBy(soldNow, (l) => l.part_name || l.part_sku || null, (l) => l.quantity ?? 0).slice(0, 10);
  const bestRevenue = sumBy(soldNow, (l) => l.part_name || l.part_sku || null, (l) => num(l.line_total_qar)).slice(0, 10);

  const searches = tally(
    input.signals.filter((s) => s.kind === "search" && within(s.created_at, days, now)),
    (s) => (s.search_term ?? "").trim().toLowerCase() || null,
  ).slice(0, 10);
  const unservedRequests = input.signals.filter((s) => s.kind === "request" && !s.served_at);

  const neverSold = (() => {
    const sold = new Set(input.orderItems.map((l) => l.part_id).filter(Boolean) as string[]);
    return published.filter((p) => !sold.has(p.id));
  })();

  // Every product as a plain list — the catalogue itself, not a top-ten of it.
  // Sorted by category so the grouping reads down the column without needing a
  // break, then by name. Capped because the app draws a table as one stack of
  // rows with no paging: past a hundred the section stops being readable, and
  // the count in the note says what is not shown.
  const CATALOGUE_ROWS = 100;
  const catalogue = [...live].sort(
    (a, b) =>
      (a.store_category || a.category || "~").localeCompare(b.store_category || b.category || "~") ||
      (a.name || a.sku || "").localeCompare(b.name || b.sku || ""),
  );

  const tiles = [
    { label: "Published products", value: int(published.length), hint: `${int(live.length)} in the catalogue in all` },
    {
      label: "Units sold",
      value: int(unitsNow),
      delta: delta(unitsNow, unitsBefore),
      tone: toneUp(unitsNow, unitsBefore),
      hint: `last ${days} days`,
    },
    { label: "Held in Lusail", value: int(held.length), hint: `${int(Math.round(stockValue))} QAR at cost` },
    {
      label: "Low stock",
      value: int(low.length),
      tone: low.length ? ("warn" as const) : ("good" as const),
      hint: `${LOW_STOCK} or fewer left`,
    },
    {
      label: "Median margin",
      value: medianMargin === null ? "—" : `${Math.round(medianMargin * 100)}%`,
      hint: `${int(priced.length)} product${priced.length === 1 ? "" : "s"} priced from cost`,
    },
    {
      label: "On request",
      value: int(onRequest.length),
      tone: onRequest.length > published.length / 2 ? ("warn" as const) : ("flat" as const),
      hint: "no delivery class yet",
    },
    { label: "Never ordered", value: int(neverSold.length), hint: "published, never in an order" },
    {
      label: "Unserved requests",
      value: int(unservedRequests.length),
      tone: unservedRequests.length ? ("warn" as const) : ("good" as const),
      hint: "someone asked, nothing sent",
    },
  ];

  const tables: Table[] = [
    {
      title: "Every product",
      columns: ["Product", "Category", "Price", "Cost", "Stock", "Status"],
      rows: catalogue.slice(0, CATALOGUE_ROWS).map((p) => [
        p.name || p.sku || p.id,
        p.store_category || p.category || "\u2014",
        num(p.unit_price) > 0 ? money(num(p.unit_price)) : "\u2014",
        num(p.landed_cost_qar) > 0 ? money(num(p.landed_cost_qar)) : "\u2014",
        p.in_own_stock ? int(stock.get(p.id) ?? 0) : "\u2014",
        p.is_published ? label(p.stock_status) : "draft",
      ]),
      align: ["l", "l", "r", "r", "r", "l"],
      empty: "There are no products in the catalogue.",
    },
    {
      title: "Best sellers by units",
      columns: ["Product", "Units"],
      rows: bestSellers.map(([name, n]) => [name, int(n)]),
      align: ["l", "r"],
      empty: `Nothing sold in the last ${days} days.`,
    },
    {
      title: "Best sellers by revenue",
      columns: ["Product", "QAR"],
      rows: bestRevenue.map(([name, n]) => [name, money(n)]),
      align: ["l", "r"],
      empty: `Nothing sold in the last ${days} days.`,
    },
    {
      title: "Running out",
      columns: ["Product", "Left"],
      rows: low.slice(0, 15).map((p) => [p.name || p.sku || p.id, int(stock.get(p.id) ?? 0)]),
      align: ["l", "r"],
      empty: "Nothing is low.",
    },
    {
      title: "What people searched for",
      columns: ["Term", "Times"],
      rows: searches.map(([term, n]) => [term, int(n)]),
      align: ["l", "r"],
      empty: "No searches recorded in this window.",
    },
    breakdown("By category", tally(published, (p) => p.store_category || p.category).slice(0, 12), ["Category", "Products"]),
    breakdown("Stock status", tally(published, (p) => label(p.stock_status)), ["Status", "Products"]),
  ];

  const notes: string[] = [];
  if (low.length) notes.push(`${low.length} product${low.length === 1 ? "" : "s"} in Lusail ${low.length === 1 ? "is" : "are"} down to ${LOW_STOCK} or fewer.`);
  if (unservedRequests.length) notes.push(`${unservedRequests.length} request${unservedRequests.length === 1 ? "" : "s"} still waiting to be served.`);
  if (onRequest.length) notes.push(`${onRequest.length} published product${onRequest.length === 1 ? " has" : "s have"} no delivery class, so the store shows them as "on request".`);
  if (neverSold.length && published.length) notes.push(`${pct(neverSold.length, published.length)} of the catalogue has never been ordered.`);
  if (retailValue > 0) notes.push(`Stock on hand: ${money(stockValue)} QAR at cost, ${money(retailValue)} QAR at shelf price.`);
  if (catalogue.length > CATALOGUE_ROWS) {
    notes.push(`The product list shows the first ${int(CATALOGUE_ROWS)} of ${int(catalogue.length)} items, by category.`);
  }
  if (!notes.length) notes.push("Nothing needs attention in the catalogue.");

  return {
    key: "store",
    title: "Store",
    symbol: "shippingbox",
    blurb: "The catalogue: what is published, what it is worth, what sells.",
    tiles,
    series: [
      { title: "Units sold a day", kind: "bar", points: daily(soldNow.map((l) => ({ at: l.created_at, weight: l.quantity ?? 0 })), days, now) },
      {
        title: "Store revenue a day",
        kind: "bar",
        unit: "QAR",
        points: daily(soldNow.map((l) => ({ at: l.created_at, weight: num(l.line_total_qar) })), days, now),
      },
      { title: "Products added a day", kind: "bar", points: daily(live.map((p) => ({ at: p.created_at })), days, now) },
    ],
    tables,
    notes,
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
