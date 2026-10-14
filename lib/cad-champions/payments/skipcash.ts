// SkipCash (Prompt 10 Step E): hosted card / Apple Pay page. BUILT, DISABLED
// until SKIPCASH_ENABLED=true and every key is set. We never touch card data:
// the server creates the payment and redirects to SkipCash's payUrl.
//
// Read from dev.skipcash.app on 2026-10-14 (API integration, Node.js example,
// Webhooks, Get Transaction Details):
//   - Sandbox https://skipcashtest.azurewebsites.net, production https://api.skipcash.app
//   - POST /api/v1/payments, JSON body with PascalCase fields; header
//     Authorization = Base64(HMAC-SHA256(KeyId secret, combinedData)) where
//     combinedData = "Uid=..,KeyId=..,Amount=..,FirstName=..,LastName=..,
//     Phone=..,Email=..,Street=..,City=..,State=..,Country=..,PostalCode=..,
//     TransactionId=..,Custom1=.." in THAT order; a field left out of the
//     request is left out of combinedData too. Amount = string, dot, max 2 decimals.
//   - Response: resultObj { id, payUrl, status, statusId, ... }.
//   - GET /api/v1/payments/{id}; "sending the Client ID of the merchant is sufficient".
//   - Webhook: JSON body, header Authorization = Base64(HMAC-SHA256(webhook
//     key, "PaymentId=..,Amount=..,StatusId=..,TransactionId=..,Custom1=..,VisaId=..")),
//     TransactionId and Custom1 only when used. StatusId 0 new, 1 pending, 2 paid,
//     3 canceled, 4 failed, 5 rejected, 6 refunded, 7 pending refund, 8 refund
//     failed, 12 started. Webhooks may arrive out of order: never overwrite paid.
//     SkipCash retries up to 3 times and only checks for HTTP 200.
// [TODO-MO: verify SkipCash field order/endpoints against dev.skipcash.app]
//   — the GET header name/format for the Client ID is not spelled out
//   ("Authorization: <client id>" used here) and the exact text of Amount in
//   the webhook signature (we sign the value exactly as received).
//
// SERVER ONLY (node:crypto).

import { createHmac, timingSafeEqual } from "node:crypto";

import type { CreatePaymentResult, PaymentDraft, PaymentProvider, ProviderPaymentState, ProviderStatus, WebhookResult } from "./provider";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/payments/skipcash.ts is server-only");

export const SKIPCASH_SANDBOX_URL = "https://skipcashtest.azurewebsites.net";
export const SKIPCASH_PRODUCTION_URL = "https://api.skipcash.app";

export const CREATE_SIGNATURE_FIELDS = [
  "Uid",
  "KeyId",
  "Amount",
  "FirstName",
  "LastName",
  "Phone",
  "Email",
  "Street",
  "City",
  "State",
  "Country",
  "PostalCode",
  "TransactionId",
  "Custom1",
] as const;

export const WEBHOOK_SIGNATURE_FIELDS = ["PaymentId", "Amount", "StatusId", "TransactionId", "Custom1", "VisaId"] as const;
/** Always part of the webhook string (TransactionId / Custom1 only when present). */
const WEBHOOK_REQUIRED = new Set(["PaymentId", "Amount", "StatusId", "VisaId"]);

export const SKIPCASH_STATUS: Record<number, string> = {
  0: "new",
  1: "pending",
  2: "paid",
  3: "canceled",
  4: "failed",
  5: "rejected",
  6: "refunded",
  7: "pending_refund",
  8: "refund_failed",
  12: "started",
};

export interface SkipCashConfig {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  keyId: string;
  keySecret: string;
  webhookKey: string;
}

type Env = Record<string, string | undefined>;

export function getSkipCashConfig(env: Env = process.env): SkipCashConfig {
  return {
    enabled: (env.SKIPCASH_ENABLED ?? "").trim().toLowerCase() === "true",
    baseUrl: ((env.SKIPCASH_BASE_URL ?? "").trim() || SKIPCASH_SANDBOX_URL).replace(/\/+$/, ""),
    clientId: (env.SKIPCASH_CLIENT_ID ?? "").trim(),
    keyId: (env.SKIPCASH_KEY_ID ?? "").trim(),
    keySecret: (env.SKIPCASH_KEY_SECRET ?? "").trim(),
    webhookKey: (env.SKIPCASH_WEBHOOK_KEY ?? "").trim(),
  };
}

/** Shown and usable only when switched on AND fully configured (incl. the webhook key). */
export function isSkipCashEnabled(env: Env = process.env): boolean {
  const c = getSkipCashConfig(env);
  return c.enabled && !!c.clientId && !!c.keyId && !!c.keySecret && !!c.webhookKey;
}

/** "Key=value,Key=value" over `order`, skipping fields that are absent or empty (unless required). */
export function combinedData(fields: Record<string, unknown>, order: readonly string[], required: ReadonlySet<string> = new Set()): string {
  const parts: string[] = [];
  for (const k of order) {
    const v = fields[k];
    const present = v !== undefined && v !== null && String(v) !== "";
    if (!present && !required.has(k)) continue;
    parts.push(`${k}=${present ? String(v) : ""}`);
  }
  return parts.join(",");
}

export function hmacBase64(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("base64");
}

/** Constant-time compare of two signature strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) {
    // still spend comparable time, then fail
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

export function formatAmount(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function signCreateRequest(body: Record<string, unknown>, secret: string): string {
  return hmacBase64(combinedData(body, CREATE_SIGNATURE_FIELDS), secret);
}

export function webhookSignatureString(payload: Record<string, unknown>): string {
  return combinedData(payload, WEBHOOK_SIGNATURE_FIELDS, WEBHOOK_REQUIRED);
}

export function verifyWebhookSignature(payload: Record<string, unknown>, header: string | null | undefined, webhookKey: string): boolean {
  if (!webhookKey || !header) return false;
  const expected = hmacBase64(webhookSignatureString(payload), webhookKey);
  return safeEqual(expected, header.trim());
}

export function mapStatusId(statusId: number): ProviderPaymentState {
  switch (statusId) {
    case 2:
      return "paid";
    case 3:
      return "cancelled";
    case 4:
    case 5:
      return "failed";
    case 6:
      return "refunded";
    case 0:
    case 1:
    case 7:
    case 8:
    case 12:
      return "pending";
    default:
      return "unknown";
  }
}

function clip(s: string | null | undefined, n: number): string {
  return (s ?? "").trim().slice(0, n);
}

/** The JSON body for POST /api/v1/payments (PascalCase, as in the docs' example). */
export function buildCreateBody(draft: PaymentDraft, cfg: Pick<SkipCashConfig, "keyId">, uid: string): Record<string, string> {
  const body: Record<string, string> = {
    Uid: uid,
    KeyId: cfg.keyId,
    Amount: formatAmount(draft.amountQar),
    FirstName: clip(draft.customer.firstName, 60) || "Student",
    LastName: clip(draft.customer.lastName, 60) || "-",
    Email: clip(draft.customer.email, 255),
    TransactionId: clip(draft.referenceCode, 40),
    Custom1: draft.paymentId,
  };
  const phone = clip(draft.customer.phone, 15);
  if (phone) body.Phone = phone.startsWith("00") ? `+${phone.slice(2)}` : phone;
  // Not part of the signature string (per the docs' field list):
  body.Subject = clip(draft.description, 100);
  body.Description = clip(draft.description, 300);
  body.ReturnUrl = draft.returnUrl;
  body.WebhookUrl = draft.webhookUrl;
  return body;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SkipCashDeps {
  fetch?: FetchLike;
  env?: Env;
  uid?: () => string;
}

export async function createSkipCashPayment(draft: PaymentDraft, deps: SkipCashDeps = {}): Promise<CreatePaymentResult> {
  const env = deps.env ?? process.env;
  if (!isSkipCashEnabled(env)) {
    return { ok: false, method: "skipcash", error: getSkipCashConfig(env).enabled ? "not_configured" : "disabled" };
  }
  const cfg = getSkipCashConfig(env);
  const doFetch = deps.fetch ?? fetch;
  const uid = (deps.uid ?? (() => globalThis.crypto.randomUUID()))();
  const body = buildCreateBody(draft, cfg, uid);
  try {
    const res = await doFetch(`${cfg.baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: { Authorization: signCreateRequest(body, cfg.keySecret), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { resultObj?: { id?: string; payUrl?: string }; hasError?: boolean; errorMessage?: string } | null;
    const id = json?.resultObj?.id;
    const payUrl = json?.resultObj?.payUrl;
    if (!res.ok || json?.hasError || !id || !payUrl || !/^https:\/\//.test(payUrl)) {
      console.error("[cc-skipcash] create failed:", res.status, (json?.errorMessage ?? "").slice(0, 200));
      return { ok: false, method: "skipcash", error: "provider_error" };
    }
    return { ok: true, method: "skipcash", redirectUrl: payUrl, providerPaymentId: String(id), raw: json };
  } catch (e) {
    console.error("[cc-skipcash] create failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, method: "skipcash", error: "provider_error" };
  }
}

export async function getSkipCashPayment(providerPaymentId: string, deps: SkipCashDeps = {}): Promise<ProviderStatus | null> {
  const env = deps.env ?? process.env;
  const cfg = getSkipCashConfig(env);
  if (!cfg.clientId || !providerPaymentId) return null;
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`${cfg.baseUrl}/api/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: "GET",
      headers: { Authorization: cfg.clientId },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[cc-skipcash] status failed:", res.status);
      return null;
    }
    const json = (await res.json().catch(() => null)) as { resultObj?: Record<string, unknown> } & Record<string, unknown> | null;
    const r = (json?.resultObj ?? json ?? {}) as Record<string, unknown>;
    const statusId = Number(r.statusId);
    const amount = Number(r.amount);
    return {
      providerPaymentId: String(r.id ?? providerPaymentId),
      state: Number.isFinite(statusId) ? mapStatusId(statusId) : "unknown",
      providerStatus: Number.isFinite(statusId) ? String(statusId) : String(r.status ?? ""),
      amount: Number.isFinite(amount) ? amount : null,
      currency: typeof r.currency === "string" ? r.currency : null,
      ourPaymentId: typeof r.custom1 === "string" ? r.custom1 : null,
      raw: json,
    };
  } catch (e) {
    console.error("[cc-skipcash] status failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

/** Verifies and parses a webhook request. Rejects when no webhook key is configured. */
export async function parseSkipCashWebhook(req: Request, env: Env = process.env): Promise<WebhookResult> {
  const cfg = getSkipCashConfig(env);
  if (!cfg.webhookKey) return { ok: false, status: 503, error: "webhook_key_unset" };
  let payload: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 20_000) return { ok: false, status: 400, error: "too_large" };
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: "bad_json" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: "bad_json" };
  }
  if (!verifyWebhookSignature(payload, req.headers.get("authorization"), cfg.webhookKey)) {
    return { ok: false, status: 401, error: "bad_signature" };
  }
  const statusId = Number(payload.StatusId);
  if (!payload.PaymentId || !Number.isFinite(statusId)) return { ok: false, status: 400, error: "missing_fields" };
  return {
    ok: true,
    event: {
      providerPaymentId: String(payload.PaymentId),
      ourPaymentId: payload.Custom1 ? String(payload.Custom1) : null,
      referenceCode: payload.TransactionId ? String(payload.TransactionId) : null,
      statusId,
      amount: String(payload.Amount ?? ""),
      raw: payload,
    },
  };
}

export type WebhookDecision =
  | { action: "mark_paid" }
  | { action: "ignore"; reason: "already_paid" | "not_paid_status" | "not_open" }
  | { action: "review"; reason: "amount_mismatch" | "currency_mismatch" | "late_paid" | "status_unconfirmed" };

/**
 * What to do with a webhook, AFTER the payment was fetched from SkipCash.
 * Never moves a paid payment backwards; only a confirmed "paid" with the
 * exact amount in QAR marks ours paid.
 */
export function decideWebhook(
  local: { status: string; amount_qar: number },
  remote: Pick<ProviderStatus, "state" | "amount" | "currency"> | null,
): WebhookDecision {
  if (local.status === "paid" || local.status === "refunded") return { action: "ignore", reason: "already_paid" };
  if (!remote || remote.state !== "paid") return remote ? { action: "ignore", reason: "not_paid_status" } : { action: "review", reason: "status_unconfirmed" };
  if ((remote.currency ?? "").toUpperCase() !== "QAR") return { action: "review", reason: "currency_mismatch" };
  if (remote.amount == null || Math.round(remote.amount * 100) !== Math.round(Number(local.amount_qar) * 100)) {
    return { action: "review", reason: "amount_mismatch" };
  }
  if (local.status !== "awaiting_transfer") return { action: "review", reason: "late_paid" };
  return { action: "mark_paid" };
}

export const skipCashProvider: PaymentProvider = {
  method: "skipcash",
  enabled: () => isSkipCashEnabled(),
  createPayment: (draft) => createSkipCashPayment(draft),
  getStatus: (id) => getSkipCashPayment(id),
  handleWebhook: (req) => parseSkipCashWebhook(req),
};
