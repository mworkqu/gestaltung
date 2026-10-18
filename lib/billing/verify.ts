// Automatic Fawran proof check (owner, 2026-10-18). The vision model only READS
// the screenshot into a Receipt; checkReceipt() (pure, tested) decides. A pass
// grants at once; anything else goes to "needs review" with the reasons. The
// SQL (payment_settle) also refuses to auto-approve a reused image hash or
// transfer reference, whatever this says.

import { FAWRAN_CHECK } from "./config";

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

/** Upper-case, no spaces/dashes/diacritics, Arabic alef forms folded — for "contains" matching. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[ً-ْٰ̀-ͯ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[\s\-_.]/g, "")
    .toUpperCase();
}

const DAY = 86_400_000;

export function checkReceipt(
  r: Receipt,
  payment: { amountQar: number; createdAt: Date },
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
  else if (when.getTime() > now.getTime() + DAY) reasons.push("date_future");
  else if (
    when.getTime() < now.getTime() - FAWRAN_CHECK.maxAgeDays * DAY ||
    when.getTime() < payment.createdAt.getTime() - DAY
  )
    reasons.push("date_old");
  if (!r.transferRef) reasons.push("no_reference");
  return { ok: reasons.length === 0, reasons };
}
