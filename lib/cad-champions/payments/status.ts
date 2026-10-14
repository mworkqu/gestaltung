// How a payment status is shown (status page Stepper, chips, admin queue). PURE, tested.

import type { CcPaymentStatus } from "../db/types";

export type PaymentStepId = "reserved" | "transfer" | "review" | "active";
export type StepState = "done" | "current" | "upcoming" | "locked";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const PAYMENT_STEP_IDS: readonly PaymentStepId[] = ["reserved", "transfer", "review", "active"];

/** Stepper states for the four steps of a payment. */
export function paymentSteps(status: CcPaymentStatus): Record<PaymentStepId, StepState> {
  switch (status) {
    case "awaiting_transfer":
    case "rejected":
      return { reserved: "done", transfer: "current", review: "upcoming", active: "upcoming" };
    case "proof_submitted":
      return { reserved: "done", transfer: "done", review: "current", active: "upcoming" };
    case "paid":
    case "refunded":
      return { reserved: "done", transfer: "done", review: "done", active: "done" };
    case "expired":
    case "cancelled":
      return { reserved: "done", transfer: "locked", review: "locked", active: "locked" };
  }
}

export function statusTone(status: CcPaymentStatus): Tone {
  switch (status) {
    case "paid":
      return "success";
    case "proof_submitted":
      return "info";
    case "awaiting_transfer":
    case "rejected":
      return "warning";
    case "refunded":
    case "expired":
    case "cancelled":
      return "neutral";
  }
}

/** Admin queue order: proof_submitted first, then awaiting, rejected, the rest. */
export function adminQueueRank(status: CcPaymentStatus): number {
  return status === "proof_submitted" ? 0 : status === "awaiting_transfer" ? 1 : status === "rejected" ? 2 : 3;
}

export function sortAdminQueue<T extends { status: CcPaymentStatus; created_at: string; proof_submitted_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const r = adminQueueRank(a.status) - adminQueueRank(b.status);
    if (r !== 0) return r;
    if (a.status === "proof_submitted") {
      // oldest proof first: the student who has waited longest
      return (a.proof_submitted_at ?? a.created_at).localeCompare(b.proof_submitted_at ?? b.created_at);
    }
    return b.created_at.localeCompare(a.created_at);
  });
}
