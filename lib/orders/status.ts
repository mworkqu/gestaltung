// Store order statuses (P2-01, migration 0053). Pure and client-safe.
//
// The chain is confirmed → paid → sourcing → shipped → delivered, plus
// cancelled. Rules (mirrored in SQL by order_status_transition_ok):
//   - any open status → cancelled;
//   - otherwise forward only, skipping allowed (cash on delivery goes
//     confirmed → sourcing without "paid");
//   - delivered and cancelled are terminal; the same status again is refused.
// Before 0053 runs the database still holds the old values: pending (= our
// confirmed) and processing (= our sourcing). normaliseOrderStatus() maps them
// so every screen reads the new set either way.

export const ORDER_CHAIN = ["confirmed", "paid", "sourcing", "shipped", "delivered"] as const;
export const ORDER_STATUSES = [...ORDER_CHAIN, "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Old (0011) values and what they mean now. */
export const LEGACY_ORDER_STATUS: Readonly<Record<string, OrderStatus>> = {
  pending: "confirmed",
  processing: "sourcing",
};

/** Statuses the old (pre-0053) check constraint accepts, for the fallback write. */
export const PRE_0053_STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"] as const;

/** Orders still in progress (not delivered, not cancelled), in both the new and the old set. */
export const OPEN_ORDER_STATUSES = ["confirmed", "paid", "sourcing", "shipped", "pending", "processing"] as const;

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);
}

/** Any stored value (new or legacy) → the new set; null for junk. */
export function normaliseOrderStatus(v: unknown): OrderStatus | null {
  if (isOrderStatus(v)) return v;
  if (typeof v === "string" && v in LEGACY_ORDER_STATUS) return LEGACY_ORDER_STATUS[v];
  return null;
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

/** May an order move from `from` to `to`? Same rule as the SQL function. */
export function canTransition(from: unknown, to: unknown): boolean {
  const f = normaliseOrderStatus(from);
  if (!f || !isOrderStatus(to) || f === to || isTerminal(f)) return false;
  if (to === "cancelled") return true;
  return ORDER_CHAIN.indexOf(to as (typeof ORDER_CHAIN)[number]) > ORDER_CHAIN.indexOf(f as (typeof ORDER_CHAIN)[number]);
}

/** The statuses an admin may pick next, in chain order (cancelled last). */
export function nextStatuses(from: unknown): OrderStatus[] {
  return ORDER_STATUSES.filter((s) => canTransition(from, s));
}

/**
 * Before 0053 the database only knows the old set. The new status the admin
 * picked, written in the old vocabulary — or null when the old set has no
 * equivalent (paid), which needs 0053.
 */
export function toPre0053Status(status: OrderStatus): (typeof PRE_0053_STATUSES)[number] | null {
  if (status === "sourcing") return "processing";
  if (status === "paid") return null;
  return status;
}

export type HistoryRow = { status: string; changed_at: string; note?: string | null };

export type TimelineStep = {
  status: OrderStatus;
  /** Reached (or passed) by the order. */
  reached: boolean;
  /** The order's status right now. */
  current: boolean;
  /** When it was reached, when the history knows. */
  at: string | null;
  note: string | null;
};

/**
 * The customer timeline: the five chain steps, each marked reached when the
 * order is at or past it, dated from order_status_history (first time it was
 * reached), falling back to created_at for "confirmed". A skipped step (e.g.
 * paid on a cash order) is reached but undated. A cancelled order ends with a
 * cancelled step after the last reached one; later chain steps are dropped.
 */
export function buildTimeline(order: { status: unknown; created_at: string }, history: readonly HistoryRow[]): TimelineStep[] {
  const current = normaliseOrderStatus(order.status) ?? "confirmed";
  const rows = history
    .map((h) => ({ status: normaliseOrderStatus(h.status), at: h.changed_at, note: h.note?.trim() || null }))
    .filter((h): h is { status: OrderStatus; at: string; note: string | null } => h.status !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const first = (s: OrderStatus) => rows.find((r) => r.status === s) ?? null;

  let reachedIdx: number;
  if (current === "cancelled") {
    reachedIdx = -1;
    for (const r of rows) {
      const i = ORDER_CHAIN.indexOf(r.status as (typeof ORDER_CHAIN)[number]);
      if (i > reachedIdx) reachedIdx = i;
    }
    reachedIdx = Math.max(reachedIdx, 0);
  } else {
    reachedIdx = ORDER_CHAIN.indexOf(current as (typeof ORDER_CHAIN)[number]);
  }

  const steps: TimelineStep[] = ORDER_CHAIN.map((s, i) => {
    const row = first(s);
    return {
      status: s,
      reached: i <= reachedIdx,
      current: current === s,
      at: row?.at ?? (s === "confirmed" ? order.created_at : null),
      note: row?.note ?? null,
    };
  });

  if (current !== "cancelled") return steps;
  const row = first("cancelled");
  return [
    ...steps.slice(0, reachedIdx + 1),
    { status: "cancelled", reached: true, current: true, at: row?.at ?? null, note: row?.note ?? null },
  ];
}

/**
 * Should the customer still see how to pay? Bank transfer / Fawran: only
 * while the order is "confirmed" (any later step means we have the money).
 * Cash on delivery: until it is delivered (the driver collects). Never for
 * cancelled or delivered orders, or without a method.
 */
export function needsPayment(status: unknown, method: string | null | undefined): boolean {
  const s = normaliseOrderStatus(status);
  if (!s || isTerminal(s) || !method) return false;
  if (method === "cash_on_delivery") return s !== "paid";
  return s === "confirmed";
}

/** The short reference customers see (first 8 characters of the id). */
export function orderShort(id: string): string {
  return id.slice(0, 8);
}
