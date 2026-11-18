import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CC_PAYMENT_STATUSES, type CcPaymentStatus } from "../db/types";
import { InvalidPaymentTransition, allowedTransitions, assertTransition, canTransition, isTerminal, transitionErrorCode, transitionPairs } from "./state-machine";

describe("payment state machine", () => {
  it("allows the Fawran happy path and the resubmit loop", () => {
    expect(canTransition("awaiting_transfer", "proof_submitted")).toBe(true);
    expect(canTransition("proof_submitted", "paid")).toBe(true);
    expect(canTransition("proof_submitted", "rejected")).toBe(true);
    expect(canTransition("rejected", "proof_submitted")).toBe(true);
    expect(canTransition("awaiting_transfer", "expired")).toBe(true);
    expect(canTransition("awaiting_transfer", "cancelled")).toBe(true);
    expect(canTransition("paid", "refunded")).toBe(true);
  });

  it("refuses everything else and throws", () => {
    const allowed = new Set(transitionPairs().base);
    for (const from of CC_PAYMENT_STATUSES) {
      for (const to of CC_PAYMENT_STATUSES) {
        const ok = allowed.has(`${from}>${to}`);
        expect(canTransition(from, to)).toBe(ok);
        if (!ok) expect(() => assertTransition(from, to)).toThrow(InvalidPaymentTransition);
      }
    }
    // never backwards from paid, never paid twice
    expect(() => assertTransition("paid", "paid")).toThrow(/cc_invalid_transition: paid -> paid/);
    expect(() => assertTransition("paid", "awaiting_transfer")).toThrow();
    expect(() => assertTransition("expired", "proof_submitted")).toThrow();
    expect(() => assertTransition("rejected", "paid")).toThrow();
  });

  it("Fawran needs a proof before paid; SkipCash may go straight to paid", () => {
    expect(canTransition("awaiting_transfer", "paid", "fawran")).toBe(false);
    expect(canTransition("awaiting_transfer", "paid", "skipcash")).toBe(true);
    expect(allowedTransitions("awaiting_transfer", "skipcash")).toContain("paid");
  });

  it("knows the terminal statuses", () => {
    const terminal = (["refunded", "expired", "cancelled"] as CcPaymentStatus[]).every(isTerminal);
    expect(terminal).toBe(true);
    expect(isTerminal("paid")).toBe(false);
  });

  it("matches the SQL mirror in 0084 exactly", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0084_cc_payments.sql", import.meta.url)), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.cc_payment_transition_allowed"), sql.indexOf("grant execute on function public.cc_payment_transition_allowed"));
    const baseBlock = fn.slice(fn.indexOf("array["), fn.indexOf("]"));
    const skipBlock = fn.slice(fn.indexOf("'skipcash'"));
    const quoted = (s: string) => [...s.matchAll(/'([a-z_]+>[a-z_]+)'/g)].map((m) => m[1]);
    const { base, skipcash } = transitionPairs();
    expect(quoted(baseBlock).sort()).toEqual([...base].sort());
    expect(quoted(skipBlock).sort()).toEqual([...skipcash].sort());
  });

  it("maps RPC errors to short codes", () => {
    expect(transitionErrorCode("cc_invalid_transition: paid -> paid")).toBe("invalid_transition");
    expect(transitionErrorCode("cc_reason_required")).toBe("reason_required");
    expect(transitionErrorCode("cc_proof_required")).toBe("proof_required");
    expect(transitionErrorCode("cc_payment_not_found")).toBe("not_found");
    expect(transitionErrorCode("cc_plan_duration_missing")).toBe("plan_duration_missing");
    expect(transitionErrorCode("boom")).toBe("error");
  });
});
