// The CAD Champions payment state machine (Prompt 10 Step C). PURE, tested in
// state-machine.test.ts. The SAME rules live in SQL
// (public.cc_payment_transition_allowed in 0084_cc_payments.sql) and a test
// checks both lists match, so the server RPC refuses what this module refuses.
//
//   awaiting_transfer -> proof_submitted -> paid | rejected
//   rejected          -> proof_submitted          (student uploads new proof)
//   awaiting_transfer -> expired | cancelled      (48 h job / new checkout)
//   paid              -> refunded
//   SkipCash only: awaiting_transfer -> paid      (confirmed webhook)
// Everything else throws InvalidPaymentTransition.

import type { CcPaymentMethod, CcPaymentStatus } from "../db/types";

export const PAYMENT_TRANSITIONS: Readonly<Record<CcPaymentStatus, readonly CcPaymentStatus[]>> = {
  awaiting_transfer: ["proof_submitted", "expired", "cancelled"],
  proof_submitted: ["paid", "rejected"],
  rejected: ["proof_submitted"],
  paid: ["refunded"],
  refunded: [],
  expired: [],
  cancelled: [],
};

/** Extra transitions per method (hosted card payments have no proof step). */
export const METHOD_TRANSITIONS: Readonly<Record<CcPaymentMethod, readonly (readonly [CcPaymentStatus, CcPaymentStatus])[]>> = {
  fawran: [],
  skipcash: [["awaiting_transfer", "paid"]],
};

export class InvalidPaymentTransition extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`cc_invalid_transition: ${from} -> ${to}`);
    this.name = "InvalidPaymentTransition";
  }
}

export function allowedTransitions(from: CcPaymentStatus, method: CcPaymentMethod = "fawran"): CcPaymentStatus[] {
  const base = PAYMENT_TRANSITIONS[from] ?? [];
  const extra = (METHOD_TRANSITIONS[method] ?? []).filter(([f]) => f === from).map(([, t]) => t);
  return [...base, ...extra];
}

export function canTransition(from: CcPaymentStatus, to: CcPaymentStatus, method: CcPaymentMethod = "fawran"): boolean {
  return allowedTransitions(from, method).includes(to);
}

/** Throws InvalidPaymentTransition when `from -> to` is not allowed. */
export function assertTransition(from: CcPaymentStatus, to: CcPaymentStatus, method: CcPaymentMethod = "fawran"): void {
  if (!canTransition(from, to, method)) throw new InvalidPaymentTransition(from, to);
}

/** No way out (refunded, expired, cancelled). */
export function isTerminal(status: CcPaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}

/** Statuses the student can still act on. */
export const OPEN_STATUSES: readonly CcPaymentStatus[] = ["awaiting_transfer", "proof_submitted", "rejected"];

/** "from>to" pairs, the exact strings used in the SQL mirror (for the parity test). */
export function transitionPairs(): { base: string[]; skipcash: string[] } {
  const base = (Object.keys(PAYMENT_TRANSITIONS) as CcPaymentStatus[]).flatMap((f) => PAYMENT_TRANSITIONS[f].map((t) => `${f}>${t}`));
  const skipcash = METHOD_TRANSITIONS.skipcash.map(([f, t]) => `${f}>${t}`);
  return { base, skipcash };
}

export type TransitionErrorCode = "invalid_transition" | "not_found" | "reason_required" | "proof_required" | "plan_duration_missing" | "error";

/** Postgres error text from cc_payment_transition -> a short code. */
export function transitionErrorCode(message: string | undefined | null): TransitionErrorCode {
  const m = message ?? "";
  if (m.includes("cc_invalid_transition")) return "invalid_transition";
  if (m.includes("cc_payment_not_found")) return "not_found";
  if (m.includes("cc_reason_required")) return "reason_required";
  if (m.includes("cc_proof_required")) return "proof_required";
  if (m.includes("cc_plan_duration_missing")) return "plan_duration_missing";
  return "error";
}
