// Owner-side order rules (D3). Pure and client-safe: the next-step button, the
// test/cancel guards, the default list filter and "promised vs today".

import { canTransition, normaliseOrderStatus, type OrderStatus } from "@/lib/orders/status";

// ── Next step ───────────────────────────────────────────────────────────────

export type NextStepKey = "mark_paid" | "start_sourcing" | "mark_shipped" | "mark_delivered";

export type NextStep = {
  /** The status the button moves the order to. */
  to: OrderStatus;
  /** Which label to show (messages OrdersAdmin.next_<key>). */
  key: NextStepKey;
};

/**
 * The one obvious next action for an order, or null when there is none
 * (delivered / cancelled / unknown). confirmed -> paid, except cash on
 * delivery, where the money comes at the door and the order goes straight to
 * sourcing (the chain allows skipping "paid"). Always allowed by canTransition.
 */
export function nextStepFor(status: unknown, paymentMethod?: string | null): NextStep | null {
  const s = normaliseOrderStatus(status);
  if (!s) return null;
  let step: NextStep | null = null;
  switch (s) {
    case "confirmed":
      step =
        paymentMethod === "cash_on_delivery"
          ? { to: "sourcing", key: "start_sourcing" }
          : { to: "paid", key: "mark_paid" };
      break;
    case "paid":
      step = { to: "sourcing", key: "start_sourcing" };
      break;
    case "sourcing":
      step = { to: "shipped", key: "mark_shipped" };
      break;
    case "shipped":
      step = { to: "delivered", key: "mark_delivered" };
      break;
    default:
      step = null;
  }
  return step && canTransition(s, step.to) ? step : null;
}

/** "Voltaat", "Voltaat and Mouser", "3 suppliers": the supplier part of the sourcing label. */
export type SupplierSummary = { kind: "none" } | { kind: "names"; names: string[] } | { kind: "many"; count: number };

export function summariseSuppliers(names: readonly string[]): SupplierSummary {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (uniq.length === 0) return { kind: "none" };
  if (uniq.length <= 2) return { kind: "names", names: uniq };
  return { kind: "many", count: uniq.length };
}

export type NextStepLabel = { key: string; values: { a?: string; b?: string; count?: number } };

/**
 * The message key (OrdersAdmin.next_<key>) and values for a next-step button.
 * Only "start sourcing" names the suppliers of the order's lines:
 * "Start sourcing from Voltaat" / "… from Voltaat and Mouser" / "… from 3 suppliers".
 */
export function nextStepLabel(step: NextStep, supplierNames: readonly string[]): NextStepLabel {
  if (step.key !== "start_sourcing") return { key: step.key, values: {} };
  const s = summariseSuppliers(supplierNames);
  if (s.kind === "none") return { key: "start_sourcing", values: {} };
  if (s.kind === "many") return { key: "start_sourcing_many", values: { count: s.count } };
  return s.names.length === 1
    ? { key: "start_sourcing_one", values: { a: s.names[0] } }
    : { key: "start_sourcing_two", values: { a: s.names[0], b: s.names[1] } };
}

// ── Test and cancel ─────────────────────────────────────────────────────────

/**
 * "Mark as test" is refused once money may have been received: paid and
 * everything after it. Confirmed (and cancelled, which keeps no money) can be
 * marked. Legacy "pending" reads as confirmed, "processing" as sourcing.
 */
export function canMarkTest(status: unknown): boolean {
  const s = normaliseOrderStatus(status);
  return s === "confirmed" || s === "cancelled";
}

/** Cancel is the normal transition rule: any open order. */
export function canCancel(status: unknown): boolean {
  return canTransition(status, "cancelled");
}

// ── List filter ─────────────────────────────────────────────────────────────

/** Test and cancelled orders are hidden from the list unless the owner asks. */
export function isHiddenByDefault(order: { is_test?: boolean | null; status?: unknown }): boolean {
  return order.is_test === true || normaliseOrderStatus(order.status) === "cancelled";
}

/** `?show=all` shows hidden orders; anything else (or nothing) hides them. */
export function parseShowHidden(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "all";
}

export function filterVisible<T extends { is_test?: boolean | null; status?: unknown }>(orders: readonly T[], showHidden: boolean): T[] {
  return showHidden ? [...orders] : orders.filter((o) => !isHiddenByDefault(o));
}

// ── Promised delivery vs today ──────────────────────────────────────────────

export type PromiseState =
  | { kind: "none" }
  /** Delivered or cancelled: the date no longer matters. */
  | { kind: "closed" }
  | { kind: "later"; days: number }
  | { kind: "today" }
  | { kind: "late"; days: number };

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** `promised` and `today` are "YYYY-MM-DD" (today = the Qatar date). */
export function promiseState(promised: string | null | undefined, today: string, status: unknown): PromiseState {
  const s = normaliseOrderStatus(status);
  if (s === "delivered" || s === "cancelled") return { kind: "closed" };
  if (!promised) return { kind: "none" };
  const p = dayNumber(promised);
  const t = dayNumber(today);
  if (p === null || t === null) return { kind: "none" };
  const diff = p - t;
  if (diff > 0) return { kind: "later", days: diff };
  if (diff === 0) return { kind: "today" };
  return { kind: "late", days: -diff };
}
