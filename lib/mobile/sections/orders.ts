// "Orders" — the money: what was ordered, what it was worth, how long each
// stage takes, and what is sitting unfinished.
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
  tally,
  toneUp,
  within,
  when,
  type DetailView,
  type Section,
  type Table,
} from "@/lib/mobile/report";
import { normaliseOrderStatus, ORDER_CHAIN, OPEN_ORDER_STATUSES } from "@/lib/orders/status";

export type OrderRow = {
  id: string;
  customer_name: string | null;
  total_qar: number | string | null;
  discount_qar: number | string | null;
  status: string | null;
  payment_method: string | null;
  delivery_area: string | null;
  shipping_tier: string | null;
  class_id: string | null;
  created_at: string | null;
  is_test: boolean | null;
};

export type StatusEventRow = {
  order_id: string | null;
  status: string | null;
  changed_at: string | null;
};

export type PaymentRow = {
  kind: string | null;
  product: string | null;
  amount_qar: number | string | null;
  method: string | null;
  status: string | null;
  is_test: boolean | null;
  created_at: string | null;
};

export type CartRow = {
  user_id: string | null;
  quantity: number | null;
  updated_at: string | null;
  /** Which product is sitting in the basket. */
  part_id?: string | null;
};

export type OrdersInput = {
  orders: OrderRow[];
  events: StatusEventRow[];
  payments: PaymentRow[];
  carts: CartRow[];
  /**
   * Who an id belongs to, and what a product is called — only for the people
   * and products that actually appear in a basket here, so the detail lists can
   * name them instead of showing a uuid. Missing names degrade to "Someone"
   * and "a product", never to an id: an id on screen is no use to the owner and
   * is more than the screen needs to show.
   */
  peopleNames?: Record<string, string>;
  partNames?: Record<string, string>;
  windowDays: number;
  now?: number;
};

const OPEN = new Set<string>(OPEN_ORDER_STATUSES);

export function buildOrders(input: OrdersInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  const real = input.orders.filter((o) => o.is_test !== true);
  const nowOrders = real.filter((o) => within(o.created_at, days, now));
  const beforeOrders = real.filter((o) => inPreviousWindow(o.created_at, days, now));

  const revenue = (rows: OrderRow[]) => rows.reduce((s, o) => s + num(o.total_qar), 0);
  const revenueNow = revenue(nowOrders);
  const revenueBefore = revenue(beforeOrders);

  const paidNow = nowOrders.filter((o) => normaliseOrderStatus(o.status) !== "cancelled");
  const aov = paidNow.length ? revenue(paidNow) / paidNow.length : 0;
  const aovBefore = (() => {
    const kept = beforeOrders.filter((o) => normaliseOrderStatus(o.status) !== "cancelled");
    return kept.length ? revenue(kept) / kept.length : 0;
  })();

  const open = real.filter((o) => OPEN.has(o.status ?? ""));
  const cancelled = nowOrders.filter((o) => normaliseOrderStatus(o.status) === "cancelled");
  const delivered = nowOrders.filter((o) => normaliseOrderStatus(o.status) === "delivered");
  const discounted = nowOrders.filter((o) => num(o.discount_qar) > 0);

  // How long each step takes, from the status history: median hours between
  // one status and the next for the same order.
  const timings = stageTimings(input.events);

  // Oldest unfinished order: the one most likely to be forgotten.
  const oldestOpen = [...open].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))[0];
  const openAgeDays = oldestOpen?.created_at
    ? Math.floor((now - new Date(oldestOpen.created_at).getTime()) / 86_400_000)
    : null;

  const realPayments = input.payments.filter((p) => p.is_test !== true && within(p.created_at, days, now));
  const paymentsIn = realPayments.filter((p) => p.status === "approved" || p.status === "auto_approved");
  const paymentsWaiting = input.payments.filter((p) => p.is_test !== true && (p.status === "pending" || p.status === "submitted"));

  // A cart nobody has touched for a day, whose owner has not ordered since:
  // the closest thing the site records to an abandoned basket.
  const buyersSince = new Set(
    real.filter((o) => within(o.created_at, 1, now)).map((o) => (o.customer_name ?? "").trim().toLowerCase()),
  );
  // The set above holds customer NAMES, so a cart's owner has to be turned into
  // a name before it can be looked up. Comparing the user id against it — as
  // this did until now — never matched, so every stale cart counted as
  // abandoned even when its owner had just ordered.
  const names = input.peopleNames ?? {};
  const ordered = (userId: string) => {
    const name = (names[userId] ?? "").trim().toLowerCase();
    return name ? buyersSince.has(name) : false;
  };
  const staleCarts = input.carts.filter(
    (c) => c.user_id && !within(c.updated_at, 1, now) && within(c.updated_at, days, now) && !ordered(c.user_id),
  );
  const cartOwners = new Set(staleCarts.map((c) => c.user_id)).size;

  const repeat = (() => {
    const counts = new Map<string, number>();
    for (const o of real) {
      const key = (o.customer_name ?? "").trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.values()].filter((n) => n > 1).length;
  })();

  const tiles = [
    {
      label: "Revenue (QAR)",
      value: money(revenueNow),
      delta: delta(revenueNow, revenueBefore),
      tone: toneUp(revenueNow, revenueBefore),
      hint: `last ${days} days`,
    },
    {
      label: "Orders",
      detail: "window-orders",
      value: int(nowOrders.length),
      delta: delta(nowOrders.length, beforeOrders.length),
      tone: toneUp(nowOrders.length, beforeOrders.length),
      hint: `last ${days} days`,
    },
    {
      label: "Average order (QAR)",
      value: money(aov),
      delta: delta(aov, aovBefore),
      hint: "cancelled orders left out",
    },
    {
      label: "Still open",
      detail: "open-orders",
      value: int(open.length),
      tone: open.length ? ("warn" as const) : ("good" as const),
      hint: openAgeDays === null ? undefined : `oldest ${openAgeDays} day${openAgeDays === 1 ? "" : "s"} old`,
    },
    { label: "Delivered", value: int(delivered.length), tone: "good" as const, hint: `last ${days} days`, detail: "delivered" },
    {
      label: "Cancelled",
      detail: "cancelled",
      value: int(cancelled.length),
      tone: cancelled.length ? ("bad" as const) : ("good" as const),
      hint: `last ${days} days`,
    },
    {
      label: "Payments waiting",
      detail: "payments-waiting",
      value: int(paymentsWaiting.length),
      tone: paymentsWaiting.length ? ("warn" as const) : ("good" as const),
      hint: "proof sent, not reviewed",
    },
    { label: "Repeat customers", value: int(repeat), hint: "ordered more than once" },
    {
      label: "Baskets left behind",
      detail: "baskets",
      value: int(cartOwners),
      tone: cartOwners ? ("warn" as const) : ("flat" as const),
      hint: "items in a cart, no order since",
    },
  ];

  const tables: Table[] = [
    {
      title: "Latest orders",
      columns: ["Customer", "QAR", "Status"],
      rows: [...nowOrders]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 12)
        .map((o) => [o.customer_name ?? "—", money(num(o.total_qar)), label(normaliseOrderStatus(o.status) ?? o.status)]),
      align: ["l", "r", "l"],
      empty: `No orders in the last ${days} days.`,
    },
    {
      title: "How long each step takes",
      columns: ["Step", "Median", "Orders"],
      rows: timings.map((t) => [t.step, t.medianHours === null ? "—" : `${t.medianHours} h`, int(t.count)]),
      align: ["l", "r", "r"],
      empty: "Not enough status history yet.",
    },
    breakdown("Orders by status", tally(real, (o) => label(normaliseOrderStatus(o.status) ?? o.status)), ["Status", "Orders"]),
    {
      title: "Where they go",
      columns: ["Area", "Orders", "QAR"],
      rows: tally(nowOrders, (o) => o.delivery_area)
        .slice(0, 12)
        .map(([area, n]) => [
          area,
          int(n),
          money(nowOrders.filter((o) => o.delivery_area === area).reduce((s, o) => s + num(o.total_qar), 0)),
        ]),
      align: ["l", "r", "r"],
      empty: "No delivery areas recorded.",
    },
    breakdown("How they pay", tally(nowOrders, (o) => label(o.payment_method)), ["Method", "Orders"]),
    {
      title: "Money in",
      columns: ["What", "QAR", "Status"],
      rows: [...realPayments]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 12)
        .map((p) => [label(p.product || p.kind), money(num(p.amount_qar)), label(p.status)]),
      align: ["l", "r", "l"],
      empty: `No payments in the last ${days} days.`,
    },
  ];

  const notes: string[] = [];
  if (openAgeDays !== null && openAgeDays >= 7) {
    notes.push(
      `An order has been open for ${openAgeDays} days — the oldest unfinished one. ` +
        `Tap "Open orders" to see it: that list is oldest first, so the ones worth chasing are at the top.`,
    );
  }
  if (paymentsWaiting.length) {
    notes.push(
      `${paymentsWaiting.length} payment${paymentsWaiting.length === 1 ? "" : "s"} waiting to be reviewed. ` +
        `Tap the tile to see whose, then approve or reject them on the dashboard's Payments page — until then the order cannot move on.`,
    );
  }
  if (cancelled.length && nowOrders.length) notes.push(`${cancelled.length} of ${nowOrders.length} orders in this window were cancelled.`);
  if (cartOwners) {
    notes.push(
      `${cartOwners} basket${cartOwners === 1 ? " was" : "s were"} filled and left without an order. ` +
        `Tap "Baskets" for who and what — a left basket with a phone number on the account is a call worth making.`,
    );
  }
  if (discounted.length) notes.push(`${discounted.length} order${discounted.length === 1 ? "" : "s"} carried a discount.`);
  if (paymentsIn.length) notes.push(`${money(paymentsIn.reduce((s, p) => s + num(p.amount_qar), 0))} QAR approved through the payments page.`);
  if (!notes.length) notes.push("Nothing is stuck: no old open orders, no payments waiting.");

  const details = orderDetails({
    days,
    nowOrders,
    open,
    delivered,
    cancelled,
    paymentsWaiting,
    staleCarts,
    peopleNames: names,
    partNames: input.partNames ?? {},
  });

  return {
    key: "orders",
    title: "Orders",
    symbol: "cart",
    blurb: "The money: orders, revenue, how fast each step moves.",
    tiles,
    series: [
      { title: "Revenue a day", kind: "bar", unit: "QAR", points: daily(nowOrders.map((o) => ({ at: o.created_at, weight: num(o.total_qar) })), days, now) },
      { title: "Orders a day", kind: "bar", points: daily(nowOrders.map((o) => ({ at: o.created_at })), days, now) },
    ],
    tables,
    notes,
    details,
  };
}

/** Median hours between neighbouring steps of the order chain. */
export function stageTimings(events: StatusEventRow[]): { step: string; medianHours: number | null; count: number }[] {
  const byOrder = new Map<string, { status: string; at: number }[]>();
  for (const e of events) {
    const status = normaliseOrderStatus(e.status);
    if (!e.order_id || !status || !e.changed_at) continue;
    const at = new Date(e.changed_at).getTime();
    if (!Number.isFinite(at)) continue;
    const list = byOrder.get(e.order_id) ?? [];
    list.push({ status, at });
    byOrder.set(e.order_id, list);
  }

  const gaps = new Map<string, number[]>();
  for (const list of byOrder.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i += 1) {
      const step = `${list[i - 1].status} → ${list[i].status}`;
      const hours = (list[i].at - list[i - 1].at) / 3_600_000;
      if (hours < 0) continue;
      const bucket = gaps.get(step) ?? [];
      bucket.push(hours);
      gaps.set(step, bucket);
    }
  }

  const order = (step: string) => {
    const from = step.split(" → ")[0];
    const i = (ORDER_CHAIN as readonly string[]).indexOf(from);
    return i === -1 ? 99 : i;
  };

  return [...gaps.entries()]
    .map(([step, hours]) => {
      const sorted = [...hours].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { step, medianHours: Math.round(m * 10) / 10, count: hours.length };
    })
    .sort((a, b) => order(a.step) - order(b.step));
}

/**
 * The lists behind the tiles. Extracted from `buildOrders` only to keep that
 * function readable — it decides nothing of its own.
 */
function orderDetails({
  days,
  nowOrders,
  open,
  delivered,
  cancelled,
  paymentsWaiting,
  staleCarts,
  peopleNames,
  partNames,
}: {
  days: number;
  nowOrders: OrderRow[];
  open: OrderRow[];
  delivered: OrderRow[];
  cancelled: OrderRow[];
  paymentsWaiting: PaymentRow[];
  staleCarts: CartRow[];
  peopleNames: Record<string, string>;
  partNames: Record<string, string>;
}): DetailView[] {
  // What is behind the tiles. Each list is capped, newest or most urgent first,
  // and names a person rather than an id.
  const DETAIL_ROWS = 100;
  const orderRow = (o: OrderRow) => [
    o.customer_name?.trim() || "\u2014",
    when(o.created_at),
    money(num(o.total_qar)),
    label(normaliseOrderStatus(o.status) ?? o.status),
  ];
  const byNewest = (a: OrderRow, b: OrderRow) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
  const ORDER_COLUMNS = ["Customer", "When", "QAR", "Status"];
  const ORDER_ALIGN: ("l" | "r")[] = ["l", "l", "r", "l"];

  return [
    {
      key: "window-orders",
      title: "Orders",
      blurb: `Every order in the last ${days} days, newest first.`,
      columns: ORDER_COLUMNS,
      rows: [...nowOrders].sort(byNewest).slice(0, DETAIL_ROWS).map(orderRow),
      align: ORDER_ALIGN,
      empty: `No orders in the last ${days} days.`,
    },
    {
      key: "open-orders",
      title: "Still open",
      blurb: "Orders that have not been delivered or cancelled — oldest first, so the one to chase is at the top.",
      columns: ORDER_COLUMNS,
      // Oldest first: this is a list to work through, not to read.
      rows: [...open]
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        .slice(0, DETAIL_ROWS)
        .map(orderRow),
      align: ORDER_ALIGN,
      empty: "Nothing is open.",
    },
    {
      key: "delivered",
      title: "Delivered",
      blurb: `Orders delivered in the last ${days} days.`,
      columns: ORDER_COLUMNS,
      rows: [...delivered].sort(byNewest).slice(0, DETAIL_ROWS).map(orderRow),
      align: ORDER_ALIGN,
      empty: `Nothing was delivered in the last ${days} days.`,
    },
    {
      key: "cancelled",
      title: "Cancelled",
      blurb: `Orders cancelled in the last ${days} days.`,
      columns: ORDER_COLUMNS,
      rows: [...cancelled].sort(byNewest).slice(0, DETAIL_ROWS).map(orderRow),
      align: ORDER_ALIGN,
      empty: `Nothing was cancelled in the last ${days} days.`,
    },
    {
      key: "payments-waiting",
      title: "Payments waiting",
      blurb: "Proof of payment has been sent and nobody has reviewed it yet.",
      columns: ["What", "When", "QAR", "How"],
      rows: [...paymentsWaiting]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, DETAIL_ROWS)
        .map((p) => [
          p.product?.trim() || label(p.kind),
          when(p.created_at),
          money(num(p.amount_qar)),
          label(p.method),
        ]),
      align: ["l", "l", "r", "l"],
      empty: "No payment is waiting.",
    },
    {
      key: "baskets",
      title: "Baskets left behind",
      blurb: "One line per product sitting in a basket: who filled it, what is in it, and when they last touched it.",
      columns: ["Who", "Item", "Qty", "Last touched"],
      rows: [...staleCarts]
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, DETAIL_ROWS)
        .map((c) => [
          (c.user_id && peopleNames[c.user_id]?.trim()) || "Someone",
          (c.part_id && partNames[c.part_id]?.trim()) || "a product",
          int(c.quantity ?? 0),
          when(c.updated_at),
        ]),
      align: ["l", "l", "r", "l"],
      empty: "No basket was left behind.",
    },
  ];
}
