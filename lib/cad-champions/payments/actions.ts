"use server";

// Server actions for checkout, proof upload and the admin queue. Every action
// checks the session (and the admin role) on the server; the amounts, the
// status and the enrollment are decided by lib/cad-champions/payments/server.ts
// and the 0084 RPCs, never by the browser.

import { revalidatePath } from "next/cache";

import type { Locale } from "@/i18n/routing";

import { getCcUser } from "../auth/server";
import { CC_LOCALES } from "../db/types";
import { ccPath, isCcLocale } from "../routes";
import {
  approvePayment,
  cancelReservation,
  createCheckout,
  rejectPayment,
  submitProof,
  validateCouponForUser,
  isUuid,
  type AdminActionError,
  type CheckoutError,
  type CouponCheck,
  type ProofError,
  type ProofInput,
} from "./server";

function revalidatePayment(paymentId?: string) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/account/payments"));
    if (paymentId) revalidatePath(ccPath(l, `/account/payments/${paymentId}`));
    revalidatePath(ccPath(l, "/admin/payments"));
    revalidatePath(ccPath(l, "/dashboard"));
  }
}

export async function validateCouponAction(input: { code: string; planId: string }): Promise<CouponCheck> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, reason: "signed_out" };
  const code = String(input?.code ?? "").slice(0, 40);
  if (!code.trim() || !isUuid(input?.planId)) return { ok: false, reason: "invalid" };
  return validateCouponForUser(code, input.planId);
}

export async function createCheckoutAction(input: {
  locale: string;
  planSlug: string;
  cohortId: string | null;
  couponCode: string | null;
  addKit: boolean;
  termsAccepted: boolean;
  method: "fawran" | "skipcash";
}): Promise<{ ok: true; paymentId: string; redirectUrl?: string } | { ok: false; error: CheckoutError | "signed_out" }> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signed_out" };
  const locale: Locale = isCcLocale(input?.locale) ? input.locale : "en";
  const res = await createCheckout(
    cc,
    {
      planSlug: String(input?.planSlug ?? "").slice(0, 80),
      cohortId: input?.cohortId ? String(input.cohortId) : null,
      couponCode: input?.couponCode ? String(input.couponCode).slice(0, 40) : null,
      addKit: !!input?.addKit,
      termsAccepted: input?.termsAccepted === true,
      method: input?.method === "skipcash" ? "skipcash" : "fawran",
    },
    locale,
  );
  if (res.ok) revalidatePayment(res.paymentId);
  return res;
}

export async function submitProofAction(input: ProofInput): Promise<{ ok: true } | { ok: false; error: ProofError | "signed_out" }> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signed_out" };
  const res = await submitProof(cc, {
    paymentId: String(input?.paymentId ?? ""),
    proofPath: String(input?.proofPath ?? ""),
    payerName: String(input?.payerName ?? ""),
    payerBank: String(input?.payerBank ?? ""),
    payerBankOther: input?.payerBankOther ? String(input.payerBankOther) : null,
    transferReference: String(input?.transferReference ?? ""),
    transferredAt: String(input?.transferredAt ?? ""),
  });
  if (res.ok) revalidatePayment(input.paymentId);
  return res;
}

export async function cancelReservationAction(input: { paymentId: string }): Promise<{ ok: boolean; error?: string }> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signed_out" };
  const res = await cancelReservation(cc, String(input?.paymentId ?? ""));
  if (res.ok) revalidatePayment(input.paymentId);
  return res;
}

export async function approvePaymentAction(input: { paymentId: string }): Promise<{ ok: true } | { ok: false; error: AdminActionError | "forbidden" }> {
  const cc = await getCcUser();
  if (!cc?.isAdmin) return { ok: false, error: "forbidden" };
  const res = await approvePayment(cc.user.id, String(input?.paymentId ?? ""));
  if (res.ok) revalidatePayment(input.paymentId);
  return res;
}

export async function rejectPaymentAction(input: { paymentId: string; reasonEn: string; reasonAr: string }): Promise<{ ok: true } | { ok: false; error: AdminActionError | "forbidden" }> {
  const cc = await getCcUser();
  if (!cc?.isAdmin) return { ok: false, error: "forbidden" };
  const res = await rejectPayment(cc.user.id, String(input?.paymentId ?? ""), String(input?.reasonEn ?? ""), String(input?.reasonAr ?? ""));
  if (res.ok) revalidatePayment(input.paymentId);
  return res;
}
