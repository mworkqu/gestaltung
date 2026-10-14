// Fawran (Prompt 10 Step D): instant bank transfer to our alias / mobile /
// IBAN. No public API or webhook, so the "provider" only returns the
// instructions; the student uploads proof and an admin approves.
// Our details come from env (FAWRAN_*) with lib/company.ts PAYMENT_DETAILS as
// the fallback. IBAN rule (site-wide): never on a public page; only on the
// signed-in Pay step and in the email. Pure apart from reading env.

import { PAYMENT_DETAILS } from "@/lib/company";

import type { FawranInstructions, PaymentDraft, PaymentProvider } from "./provider";

export interface FawranDetails {
  alias: string;
  mobile: string | null;
  iban: string;
  accountName: string;
  bankName: string;
}

type Env = Record<string, string | undefined>;

function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

export function getFawranDetails(env: Env = process.env): FawranDetails {
  return {
    alias: clean(env.FAWRAN_ALIAS) ?? PAYMENT_DETAILS.fawranAlias,
    mobile: clean(env.FAWRAN_MOBILE),
    iban: clean(env.FAWRAN_IBAN) ?? PAYMENT_DETAILS.iban,
    accountName: clean(env.FAWRAN_ACCOUNT_NAME) ?? PAYMENT_DETAILS.accountName,
    bankName: clean(env.FAWRAN_BANK_NAME) ?? PAYMENT_DETAILS.bank,
  };
}

export function fawranInstructions(draft: Pick<PaymentDraft, "amountQar" | "referenceCode">, env: Env = process.env): FawranInstructions {
  return { ...getFawranDetails(env), amountQar: draft.amountQar, referenceCode: draft.referenceCode };
}

export { QATAR_BANKS, isQatarBank, type QatarBank } from "./banks";

/** The 8 numbered steps on the Pay step (texts in payments.json pay.steps.1..8). */
export const FAWRAN_STEP_COUNT = 8;

export const fawranProvider: PaymentProvider = {
  method: "fawran",
  enabled: () => true,
  async createPayment(draft) {
    return { ok: true, method: "fawran", instructions: fawranInstructions(draft) };
  },
  async getStatus() {
    return null;
  },
};
