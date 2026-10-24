// Automatic Fawran proof check (owner, 2026-10-18). The vision model only READS
// the screenshot into a Receipt; checkReceipt() (pure, tested) decides. A pass
// grants at once; anything else goes to "needs review" with the reasons. The
// SQL (payment_settle) also refuses to auto-approve a reused image hash or
// transfer reference, whatever this says.

import { FAWRAN_CHECK } from "./config";
import { DAY_MS } from "@/lib/format/date";

export type Receipt = {
  isTransferReceipt: boolean;
  amountQar: number | null;
  currency: string;
  recipient: string;
  date: string;
  transferRef: string;
  note: string;
  confidence: number;
};

export type ReviewReason =
  | "not_a_receipt"
  | "low_confidence"
  | "currency"
  | "amount"
  | "recipient"
  | "date_old"
  | "date_future"
  | "date_unreadable"
  | "no_reference"
  | "reference_mismatch"
  | "duplicate"
  | "model_unavailable";

export const RECEIPT_SYSTEM =
  "You read a screenshot of a bank transfer confirmation (Qatar, usually Fawran instant payment). " +
  "Copy what is written; never guess or invent. Return JSON only. " +
  "isTransferReceipt = true only for a completed/successful transfer confirmation (not a draft, form or failed transfer). " +
  "amountQar = the transferred amount as a number (convert Arabic-Indic digits), null if unreadable. currency as written (QAR, ر.ق). " +
  "recipient = the beneficiary name, alias or account exactly as written. date = the transfer date/time in ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm). " +
  "transferRef = the bank's transaction/reference number. note = the payment note/description text if shown. " +
  "confidence = 0–1, how clearly you could read all of it.";

export const RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    isTransferReceipt: { type: "BOOLEAN" },
    amountQar: { type: "NUMBER", nullable: true },
    currency: { type: "STRING" },
    recipient: { type: "STRING" },
    date: { type: "STRING" },
    transferRef: { type: "STRING" },
    note: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["isTransferReceipt", "amountQar", "currency", "recipient", "date", "transferRef", "note", "confidence"],
};

const str = (v: unknown, max = 160) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Model JSON → a Receipt, or null when it is not even the right shape. */
export function cleanReceipt(raw: unknown): Receipt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.isTransferReceipt !== "boolean") return null;
  const amount = typeof o.amountQar === "number" && Number.isFinite(o.amountQar) ? o.amountQar : null;
  const confidence = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0;
  return {
    isTransferReceipt: o.isTransferReceipt,
    amountQar: amount,
    currency: str(o.currency, 20),
    recipient: str(o.recipient),
    date: str(o.date, 40),
    transferRef: str(o.transferRef, 80),
    note: str(o.note),
    confidence,
  };
}

/** Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits → ASCII. */
const asciiDigits = (s: string) =>
  s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) & 0xf));

/**
 * Upper-case, no spaces/dashes/diacritics, Arabic alef forms folded, Arabic-Indic
 * digits mapped to ASCII — for "contains" matching.
 */
export function fold(s: string | null | undefined): string {
  return asciiDigits((s ?? "").normalize("NFKD"))
    .replace(/[ً-ْٰ̀-ͯ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[\s\-_.]/g, "")
    .toUpperCase();
}

/**
 * Decides whether a read receipt matches the payment. Pure.
 *
 * What the reference-code check (reference_mismatch) does: it stops a GENUINE
 * receipt from being reused for a payment whose code it does not carry (an old
 * transfer, or someone else's screenshot), and it stops lazy forgeries.
 *
 * What it does NOT do: it does not stop a forged or edited screenshot that
 * includes the payer's own code. The code is not a secret (checkout shows it to
 * the payer), so an image carrying it passes. Treat a pass as "plausible", not
 * "verified". The real controls are owner-level and live outside this function:
 * no auto-approval for service payments, per-user caps, and a unique
 * transfer_ref (the SQL in payment_settle also refuses a reused image hash).
 */
export function checkReceipt(
  r: Receipt,
  payment: { amountQar: number; createdAt: Date; referenceCode: string },
  now = new Date(),
): { ok: boolean; reasons: ReviewReason[] } {
  const reasons: ReviewReason[] = [];
  if (!r.isTransferReceipt) reasons.push("not_a_receipt");
  if (r.confidence < FAWRAN_CHECK.minConfidence) reasons.push("low_confidence");
  if (r.currency && !/QAR|ر\.?\s?ق|ريال|riyal/i.test(r.currency)) reasons.push("currency");
  if (r.amountQar === null || Math.abs(r.amountQar - payment.amountQar) > 0.009) reasons.push("amount");
  const who = fold(r.recipient);
  if (!who || !FAWRAN_CHECK.recipients.some((x) => who.includes(fold(x)))) reasons.push("recipient");
  const when = r.date ? new Date(r.date) : null;
  if (!when || Number.isNaN(when.getTime())) reasons.push("date_unreadable");
  else if (when.getTime() > now.getTime() + DAY_MS) reasons.push("date_future");
  else if (
    when.getTime() < now.getTime() - FAWRAN_CHECK.maxAgeDays * DAY_MS ||
    when.getTime() < payment.createdAt.getTime() - DAY_MS
  )
    reasons.push("date_old");
  if (!r.transferRef) reasons.push("no_reference");
  // The payer is told to write the payment's own code (GT-XXXXXX) in the
  // transfer note. Without it a screenshot of any other transfer — or a forged
  // one — could auto-approve this payment (audit API-01).
  const code = fold(payment.referenceCode);
  if (!code || !(fold(r.note).includes(code) || fold(r.transferRef).includes(code))) reasons.push("reference_mismatch");
  return { ok: reasons.length === 0, reasons };
}
