// SkipCash adapter against mocks (never calls SkipCash) + signature test vectors.
import { describe, expect, it, vi } from "vitest";

import {
  CREATE_SIGNATURE_FIELDS,
  buildCreateBody,
  combinedData,
  createSkipCashPayment,
  decideWebhook,
  formatAmount,
  getSkipCashPayment,
  hmacBase64,
  isSkipCashEnabled,
  mapStatusId,
  parseSkipCashWebhook,
  safeEqual,
  signCreateRequest,
  verifyWebhookSignature,
  webhookSignatureString,
} from "./skipcash";
import type { PaymentDraft } from "./provider";

const ENV = {
  SKIPCASH_ENABLED: "true",
  SKIPCASH_BASE_URL: "https://skipcashtest.azurewebsites.net",
  SKIPCASH_CLIENT_ID: "client-1",
  SKIPCASH_KEY_ID: "key-123",
  SKIPCASH_KEY_SECRET: "test-secret",
  SKIPCASH_WEBHOOK_KEY: "wh-key",
};

const PAYMENT_ID = "00000000-0000-4000-8000-0000000000c1";

const draft: PaymentDraft = {
  paymentId: PAYMENT_ID,
  referenceCode: "CAD-7K3P",
  amountQar: 1250,
  description: "CAD Champions - Online training",
  customer: { firstName: "Sara", lastName: "Al-Kuwari", email: "sara@example.com", phone: null },
  returnUrl: "https://gestaltung360.com/cad-champions/en/training/join/return?payment=x",
  webhookUrl: "https://gestaltung360.com/api/cad-champions/payments/skipcash/webhook",
};

describe("signing", () => {
  it("builds the create string in the documented order, skipping absent fields", () => {
    const body = buildCreateBody(draft, { keyId: "key-123" }, "4f3c2b1a-0000-4000-8000-000000000001");
    expect(combinedData(body, CREATE_SIGNATURE_FIELDS)).toBe(
      "Uid=4f3c2b1a-0000-4000-8000-000000000001,KeyId=key-123,Amount=1250.00,FirstName=Sara,LastName=Al-Kuwari,Email=sara@example.com,TransactionId=CAD-7K3P,Custom1=00000000-0000-4000-8000-0000000000c1",
    );
    // test vector: HMAC-SHA256(secret "test-secret") -> Base64
    expect(signCreateRequest(body, "test-secret")).toBe("wF1oZe+2LugF0m0jU1bpkL4i3rQeRjmIOtyAJ0Bxz4o=");
  });

  it("puts the phone in its slot with a + prefix", () => {
    const body = buildCreateBody({ ...draft, customer: { ...draft.customer, phone: "0097466567410" } }, { keyId: "k" }, "u");
    expect(body.Phone).toBe("+97466567410");
    expect(combinedData(body, CREATE_SIGNATURE_FIELDS)).toContain("LastName=Al-Kuwari,Phone=+97466567410,Email=");
  });

  it("verifies a webhook with the documented field order (test vector)", () => {
    const payload = { PaymentId: "pay-1", Amount: "1250.00", StatusId: 2, TransactionId: "CAD-7K3P", Custom1: PAYMENT_ID, VisaId: "visa-9", CardType: "Apple Pay" };
    expect(webhookSignatureString(payload)).toBe("PaymentId=pay-1,Amount=1250.00,StatusId=2,TransactionId=CAD-7K3P,Custom1=00000000-0000-4000-8000-0000000000c1,VisaId=visa-9");
    const sig = "HTdoiqU+inp2XS6ULrcAtZAA2EYwE00YQjFF184h1lQ=";
    expect(hmacBase64(webhookSignatureString(payload), "wh-key")).toBe(sig);
    expect(verifyWebhookSignature(payload, sig, "wh-key")).toBe(true);
    expect(verifyWebhookSignature(payload, sig, "other-key")).toBe(false);
    expect(verifyWebhookSignature({ ...payload, Amount: "1.00" }, sig, "wh-key")).toBe(false);
    expect(verifyWebhookSignature(payload, sig, "")).toBe(false);
    expect(verifyWebhookSignature(payload, null, "wh-key")).toBe(false);
  });

  it("keeps required webhook fields even when empty, drops optional ones", () => {
    expect(webhookSignatureString({ PaymentId: "p", Amount: "1.00", StatusId: 2, VisaId: "" })).toBe("PaymentId=p,Amount=1.00,StatusId=2,VisaId=");
  });

  it("compares in constant time and handles length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("formats amounts with a dot and 2 decimals", () => {
    expect(formatAmount(1250)).toBe("1250.00");
    expect(formatAmount(99.999)).toBe("100.00");
  });
});

describe("enabled flag", () => {
  it("is off unless switched on AND fully configured", () => {
    expect(isSkipCashEnabled({})).toBe(false);
    expect(isSkipCashEnabled({ ...ENV, SKIPCASH_ENABLED: "false" })).toBe(false);
    expect(isSkipCashEnabled({ ...ENV, SKIPCASH_WEBHOOK_KEY: "" })).toBe(false);
    expect(isSkipCashEnabled(ENV)).toBe(true);
  });
});

describe("create + status against a mocked SkipCash", () => {
  it("refuses when disabled (no network call)", async () => {
    const fetchMock = vi.fn();
    const res = await createSkipCashPayment(draft, { env: { ...ENV, SKIPCASH_ENABLED: "" }, fetch: fetchMock });
    expect(res).toEqual({ ok: false, method: "skipcash", error: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the payment and returns the hosted page URL", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ resultObj: { id: "sc-1", payUrl: "https://skipcashtest.azurewebsites.net/pay/sc-1", status: "new", statusId: 0 }, returnCode: 200, hasError: false }), { status: 200 }),
    );
    const res = await createSkipCashPayment(draft, { env: ENV, fetch: fetchMock, uid: () => "4f3c2b1a-0000-4000-8000-000000000001" });
    expect(res).toMatchObject({ ok: true, method: "skipcash", redirectUrl: "https://skipcashtest.azurewebsites.net/pay/sc-1", providerPaymentId: "sc-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://skipcashtest.azurewebsites.net/api/v1/payments");
    expect((init.headers as Record<string, string>).Authorization).toBe("wF1oZe+2LugF0m0jU1bpkL4i3rQeRjmIOtyAJ0Bxz4o=");
    expect(JSON.parse(String(init.body))).toMatchObject({ Amount: "1250.00", TransactionId: "CAD-7K3P", Custom1: PAYMENT_ID });
  });

  it("reports a provider error on hasError or a non-https payUrl", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ hasError: true, errorMessage: "x" }), { status: 400 }));
    expect(await createSkipCashPayment(draft, { env: ENV, fetch: bad })).toMatchObject({ ok: false, error: "provider_error" });
    const http = vi.fn(async () => new Response(JSON.stringify({ resultObj: { id: "1", payUrl: "http://evil" } }), { status: 200 }));
    expect(await createSkipCashPayment(draft, { env: ENV, fetch: http })).toMatchObject({ ok: false, error: "provider_error" });
  });

  it("reads the payment status with the client id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resultObj: { id: "sc-1", statusId: 2, amount: 1250, currency: "QAR", custom1: PAYMENT_ID } }), { status: 200 }));
    const st = await getSkipCashPayment("sc-1", { env: ENV, fetch: fetchMock });
    expect(st).toMatchObject({ providerPaymentId: "sc-1", state: "paid", amount: 1250, currency: "QAR", ourPaymentId: PAYMENT_ID });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://skipcashtest.azurewebsites.net/api/v1/payments/sc-1");
    expect((init.headers as Record<string, string>).Authorization).toBe("client-1");
  });

  it("maps status ids", () => {
    expect(mapStatusId(2)).toBe("paid");
    expect(mapStatusId(1)).toBe("pending");
    expect(mapStatusId(12)).toBe("pending");
    expect(mapStatusId(4)).toBe("failed");
    expect(mapStatusId(3)).toBe("cancelled");
    expect(mapStatusId(6)).toBe("refunded");
    expect(mapStatusId(99)).toBe("unknown");
  });
});

describe("webhook", () => {
  const payload = { PaymentId: "pay-1", Amount: "1250.00", StatusId: 2, TransactionId: "CAD-7K3P", Custom1: PAYMENT_ID, VisaId: "visa-9" };
  const sig = "HTdoiqU+inp2XS6ULrcAtZAA2EYwE00YQjFF184h1lQ=";
  const req = (body: unknown, auth?: string) =>
    new Request("https://x/api/cad-champions/payments/skipcash/webhook", { method: "POST", body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} });

  it("rejects when no webhook key is configured", async () => {
    expect(await parseSkipCashWebhook(req(payload, sig), { ...ENV, SKIPCASH_WEBHOOK_KEY: "" })).toEqual({ ok: false, status: 503, error: "webhook_key_unset" });
  });
  it("rejects a bad or missing signature", async () => {
    expect(await parseSkipCashWebhook(req(payload, "nope"), ENV)).toMatchObject({ ok: false, status: 401 });
    expect(await parseSkipCashWebhook(req(payload), ENV)).toMatchObject({ ok: false, status: 401 });
  });
  it("rejects bad JSON", async () => {
    const r = new Request("https://x", { method: "POST", body: "{", headers: { authorization: sig } });
    expect(await parseSkipCashWebhook(r, ENV)).toMatchObject({ ok: false, status: 400 });
  });
  it("accepts a valid one", async () => {
    const res = await parseSkipCashWebhook(req(payload, sig), ENV);
    expect(res).toMatchObject({ ok: true, event: { providerPaymentId: "pay-1", ourPaymentId: PAYMENT_ID, referenceCode: "CAD-7K3P", statusId: 2 } });
  });

  it("decides: only a confirmed paid with the exact QAR amount marks ours paid", () => {
    const open = { status: "awaiting_transfer", amount_qar: 1250 };
    expect(decideWebhook(open, { state: "paid", amount: 1250, currency: "QAR" })).toEqual({ action: "mark_paid" });
    expect(decideWebhook(open, { state: "paid", amount: 1249.99, currency: "QAR" })).toEqual({ action: "review", reason: "amount_mismatch" });
    expect(decideWebhook(open, { state: "paid", amount: 1250, currency: "USD" })).toEqual({ action: "review", reason: "currency_mismatch" });
    expect(decideWebhook(open, { state: "pending", amount: 1250, currency: "QAR" })).toEqual({ action: "ignore", reason: "not_paid_status" });
    expect(decideWebhook(open, null)).toEqual({ action: "review", reason: "status_unconfirmed" });
    expect(decideWebhook({ status: "expired", amount_qar: 1250 }, { state: "paid", amount: 1250, currency: "QAR" })).toEqual({ action: "review", reason: "late_paid" });
  });

  it("never moves a paid payment backwards (replayed / late pending, failed)", () => {
    const paid = { status: "paid", amount_qar: 1250 };
    for (const state of ["pending", "failed", "cancelled", "paid"] as const) {
      expect(decideWebhook(paid, { state, amount: 1250, currency: "QAR" })).toEqual({ action: "ignore", reason: "already_paid" });
    }
  });
});
