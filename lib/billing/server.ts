// Payments — server side (migration 0089). Server-only.
//
// Writes go through the service-role client (lib/supabase/service.ts) and the
// service-role-only SQL functions, so a user can never create a cheaper row or
// approve their own payment. Amounts come from lib/billing/config.ts.

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validatedCall } from "@/lib/prototyping/ai-call";
import { createServiceClient } from "@/lib/supabase/service";
import { productById } from "./config";
import { RECEIPT_SCHEMA, RECEIPT_SYSTEM, checkReceipt, cleanReceipt, type Receipt, type ReviewReason } from "./verify";

export const PROOF_BUCKET = "payment-proofs";
const PROOF_MAX_BYTES = 8 * 1024 * 1024;

export type PaymentRow = {
  id: string;
  user_id: string;
  kind: "tokens" | "pass" | "service";
  product: string;
  amount_qar: number;
  tokens: number;
  days: number | null;
  reference_code: string;
  status: "awaiting_proof" | "verifying" | "approved" | "needs_review" | "rejected" | "revoked" | "cancelled";
  review_reasons: string[] | null;
  created_at: string;
};

export type CreateResult = { ok: true; payment: PaymentRow } | { ok: false; error: "bad_product" | "not_configured" | "failed" };

export async function createPayment(userId: string, productId: string): Promise<CreateResult> {
  const product = productById(productId);
  if (!product) return { ok: false, error: "bad_product" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "not_configured" };
  const { data, error } = await service.rpc("payment_create", {
    p_user: userId,
    p_kind: product.kind,
    p_product: product.id,
    p_amount: product.qar,
    p_tokens: product.tokens,
    p_days: product.kind === "pass" ? product.days : null,
    p_cap: product.kind === "pass" ? product.cap : null,
    p_is_test: false,
  });
  if (error) {
    console.error("[billing] payment_create failed:", error.message);
    return { ok: false, error: /could not find the function|PGRST202/i.test(`${error.code} ${error.message}`) ? "not_configured" : "failed" };
  }
  return { ok: true, payment: data as PaymentRow };
}

export type ProofResult =
  | { ok: true; status: "approved" | "needs_review"; reasons: ReviewReason[] }
  | { ok: false; error: "not_found" | "not_open" | "bad_file" | "not_configured" | "failed" };

/**
 * The user uploaded `path` (their own folder in payment-proofs) for `paymentId`:
 * hash it, read it with the vision model, settle the row.
 * `supabase` = the user's own session (RLS: only their rows; also meters the AI call).
 */
export async function submitProof(supabase: SupabaseClient, userId: string, paymentId: string, path: string): Promise<ProofResult> {
  const service = createServiceClient();
  if (!service) return { ok: false, error: "not_configured" };
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return { ok: false, error: "bad_file" };

  const { data: row } = await supabase.from("payments").select("*").eq("id", paymentId).maybeSingle();
  const payment = row as (PaymentRow & { proof_hash: string | null }) | null;
  if (!payment || payment.user_id !== userId) return { ok: false, error: "not_found" };
  if (payment.status !== "awaiting_proof" && payment.status !== "needs_review") return { ok: false, error: "not_open" };

  const { data: file, error: dl } = await service.storage.from(PROOF_BUCKET).download(path);
  if (dl || !file) return { ok: false, error: "bad_file" };
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type === "image/png" ? "image/png" : file.type === "image/jpeg" ? "image/jpeg" : null;
  if (!mimeType || bytes.length === 0 || bytes.length > PROOF_MAX_BYTES) return { ok: false, error: "bad_file" };
  const hash = createHash("sha256").update(bytes).digest("hex");

  const { error: attachError } = await service.rpc("payment_attach_proof", { p_payment: payment.id, p_path: path, p_hash: hash });
  if (attachError) return { ok: false, error: /not_open/.test(attachError.message) ? "not_open" : "failed" };

  // Read the screenshot. A model failure is never a rejection: the row waits for a person.
  let receipt: Receipt | null = null;
  const r = await validatedCall<Receipt>({
    supabase,
    projectId: null,
    feature: "billing",
    step: "fawran",
    system: RECEIPT_SYSTEM,
    prompt: `Read this transfer confirmation. Today is ${new Date().toISOString().slice(0, 10)}.`,
    schema: RECEIPT_SCHEMA,
    validate: (raw) => {
      const v = cleanReceipt(raw);
      return v ? { value: v, errors: [] } : { value: null, errors: ["return the receipt JSON object"] };
    },
    temperature: 0,
    timeoutMs: 45_000,
    images: [{ mimeType, data: bytes.toString("base64") }],
  });
  if (r.ok) receipt = r.value;

  const verdict = receipt
    ? checkReceipt(receipt, { amountQar: Number(payment.amount_qar), createdAt: new Date(payment.created_at) })
    : { ok: false, reasons: ["model_unavailable" as const] };

  const { data: status, error: settleError } = await service.rpc("payment_settle", {
    p_payment: payment.id,
    p_status: verdict.ok ? "approved" : "needs_review",
    p_auto: true,
    p_verdict: receipt,
    p_reasons: verdict.reasons,
    p_transfer_ref: receipt?.transferRef ?? null,
  });
  if (settleError) {
    console.error(`[billing] settle ${payment.id} failed:`, settleError.message);
    return { ok: false, error: "failed" };
  }
  const final = status === "approved" ? "approved" : "needs_review";
  // The SQL may add "duplicate" (a reused image or transfer reference).
  const reasons: ReviewReason[] = final === "approved" ? [] : verdict.ok ? ["duplicate"] : verdict.reasons;
  return { ok: true, status: final, reasons };
}
