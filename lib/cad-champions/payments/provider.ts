// One interface for every payment method (Prompt 10 Step C). Fawran (manual
// proof + admin approval) is active; SkipCash (hosted card page) is built and
// switched off until SKIPCASH_ENABLED=true. Server code picks a provider with
// getProvider(method) and never handles card data.

import type { CcPaymentMethod } from "../db/types";

export interface PaymentDraft {
  paymentId: string;
  referenceCode: string;
  amountQar: number;
  /** Shown on the hosted page, e.g. "CAD Champions - Online training". */
  description: string;
  customer: { firstName: string; lastName: string; email: string; phone?: string | null };
  /** Absolute URL the hosted page returns to. */
  returnUrl: string;
  /** Absolute URL of our webhook. */
  webhookUrl: string;
}

export interface FawranInstructions {
  alias: string;
  mobile: string | null;
  iban: string;
  accountName: string;
  bankName: string;
  amountQar: number;
  referenceCode: string;
}

export type CreatePaymentResult =
  | { ok: true; method: "fawran"; instructions: FawranInstructions }
  | { ok: true; method: "skipcash"; redirectUrl: string; providerPaymentId: string; raw: unknown }
  | { ok: false; method: CcPaymentMethod; error: "disabled" | "not_configured" | "provider_error" };

/** A provider status normalised to what our state machine needs. */
export type ProviderPaymentState = "pending" | "paid" | "failed" | "cancelled" | "refunded" | "unknown";

export interface ProviderStatus {
  providerPaymentId: string;
  state: ProviderPaymentState;
  /** Raw numeric / text status from the provider. */
  providerStatus: string;
  amount: number | null;
  currency: string | null;
  /** Our payment id when the provider echoes it back (SkipCash Custom1). */
  ourPaymentId: string | null;
  raw: unknown;
}

export interface WebhookEvent {
  providerPaymentId: string;
  ourPaymentId: string | null;
  referenceCode: string | null;
  statusId: number;
  amount: string;
  raw: Record<string, unknown>;
}

export type WebhookResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; status: 400 | 401 | 404 | 503; error: string };

export interface PaymentProvider {
  readonly method: CcPaymentMethod;
  enabled(): boolean;
  createPayment(draft: PaymentDraft): Promise<CreatePaymentResult>;
  /** Null when the provider has no status API (Fawran: an admin confirms). */
  getStatus(providerPaymentId: string): Promise<ProviderStatus | null>;
  /** Verifies and parses a webhook (SkipCash only). */
  handleWebhook?(req: Request): Promise<WebhookResult>;
}
