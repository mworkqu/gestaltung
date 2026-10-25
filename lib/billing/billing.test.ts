import { describe, expect, it } from "vitest";

import {
  MAKER_PASS,
  TOKEN_BASE_PRICE_QAR,
  TOKEN_LAUNCH_DISCOUNT,
  TOKEN_PACKS,
  TOKEN_PRICE_QAR,
  effectiveTokenPrice,
  productById,
  tokenCopyParams,
} from "./config";
import { checkReceipt, cleanReceipt, fold, type Receipt } from "./verify";

describe("billing config", () => {
  it("token price: base QAR 10 with an 80% launch discount is an effective QAR 2", () => {
    expect(TOKEN_BASE_PRICE_QAR).toBe(10);
    expect(TOKEN_LAUNCH_DISCOUNT).toEqual({ active: true, pct: 80 });
    expect(TOKEN_PRICE_QAR).toBe(2);
    expect(effectiveTokenPrice(TOKEN_BASE_PRICE_QAR, TOKEN_LAUNCH_DISCOUNT)).toBe(2);
    // Switching the discount off puts the price back to the base; the copy params follow.
    expect(effectiveTokenPrice(10, { active: false, pct: 80 })).toBe(10);
    expect(tokenCopyParams()).toMatchObject({ tokenPrice: "2", base: "10", discount: "80", promo: "on", tier2: "7", tier3: "14" });
  });
  it("the Maker Pass is always 2x what its price buys pay-per-use", () => {
    expect(MAKER_PASS.monthlyTokens).toBe(2 * Math.floor(MAKER_PASS.qar / TOKEN_PRICE_QAR));
    expect(MAKER_PASS.rolloverCap).toBe(2 * MAKER_PASS.monthlyTokens);
  });
  it("packs are priced per token; products resolve from config only", () => {
    for (const p of TOKEN_PACKS) expect(p.qar).toBe(p.tokens * TOKEN_PRICE_QAR);
    expect(productById("maker_pass")).toMatchObject({ kind: "pass", qar: MAKER_PASS.qar, tokens: MAKER_PASS.monthlyTokens });
    expect(productById(TOKEN_PACKS[0].id)).toMatchObject({ kind: "tokens", tokens: TOKEN_PACKS[0].tokens });
    expect(productById("tokens_1000")).toBeNull();
  });
});

const now = new Date("2026-10-18T12:00:00+03:00");
const payment = { amountQar: 20, createdAt: new Date("2026-10-18T11:50:00+03:00"), referenceCode: "GT-7K3M9Q" };
const good: Receipt = {
  isTransferReceipt: true,
  amountQar: 20,
  currency: "QAR",
  recipient: "CR-236988 GESTALTUNG FOR TRD AND SERV",
  date: "2026-10-18T11:55",
  transferRef: "FT2629183",
  note: "GT-7K3M9Q",
  confidence: 0.95,
};

describe("checkReceipt", () => {
  it("a clean receipt passes", () => {
    expect(checkReceipt(good, payment, now)).toEqual({ ok: true, reasons: [] });
  });
  it("Arabic recipient and currency pass", () => {
    expect(checkReceipt({ ...good, recipient: "جِستالتونج للتجارة", currency: "ر.ق" }, payment, now).ok).toBe(true);
  });
  it("each problem is named", () => {
    const r = (patch: Partial<Receipt>) => checkReceipt({ ...good, ...patch }, payment, now).reasons;
    expect(r({ amountQar: 2 })).toEqual(["amount"]);
    expect(r({ amountQar: null })).toEqual(["amount"]);
    expect(r({ recipient: "Someone Else" })).toEqual(["recipient"]);
    expect(r({ date: "2026-10-01" })).toEqual(["date_old"]);
    expect(r({ date: "2026-10-25" })).toEqual(["date_future"]);
    expect(r({ date: "yesterday" })).toEqual(["date_unreadable"]);
    expect(r({ transferRef: "" })).toEqual(["no_reference"]);
    expect(r({ currency: "USD" })).toEqual(["currency"]);
    expect(r({ confidence: 0.3 })).toEqual(["low_confidence"]);
    expect(r({ isTransferReceipt: false })).toContain("not_a_receipt");
  });
  it("a receipt from before the checkout opened is too old", () => {
    expect(checkReceipt({ ...good, date: "2026-10-16T09:00" }, payment, now).reasons).toEqual(["date_old"]);
  });
});

describe("checkReceipt — payment code (audit API-01)", () => {
  it("passes when the note carries the payment code", () => {
    expect(checkReceipt({ ...good, note: "Gestaltung GT-7K3M9Q thanks" }, payment, now)).toEqual({ ok: true, reasons: [] });
  });
  it("passes when the code is only in the transfer reference", () => {
    expect(checkReceipt({ ...good, note: "", transferRef: "FT2629183 GT7K3M9Q" }, payment, now)).toEqual({ ok: true, reasons: [] });
  });
  it("matches the code regardless of case, spaces and dashes", () => {
    expect(checkReceipt({ ...good, note: "gt 7k3m 9q" }, payment, now)).toEqual({ ok: true, reasons: [] });
  });
  it("a perfect receipt without the code goes to review", () => {
    expect(checkReceipt({ ...good, note: "payment" }, payment, now)).toEqual({ ok: false, reasons: ["reference_mismatch"] });
    expect(checkReceipt({ ...good, note: "" }, payment, now).reasons).toEqual(["reference_mismatch"]);
  });
  it("another payment's code does not count", () => {
    expect(checkReceipt({ ...good, note: "GT-AAAAAA" }, payment, now).reasons).toEqual(["reference_mismatch"]);
  });
  it("an empty payment code never auto-approves", () => {
    expect(checkReceipt(good, { ...payment, referenceCode: "" }, now).reasons).toEqual(["reference_mismatch"]);
  });
  it("accepts the code written with Arabic-Indic digits (GT-7K3M9Q → GT-\u0667K\u0663M\u0669Q)", () => {
    expect(checkReceipt({ ...good, note: "GT-\u0667K\u0663M\u0669Q" }, payment, now)).toEqual({ ok: true, reasons: [] });
  });
  it("accepts the code written with Eastern Arabic-Indic digits and in the transfer reference", () => {
    expect(checkReceipt({ ...good, note: "GT-\u06F7K\u06F3M\u06F9Q" }, payment, now)).toEqual({ ok: true, reasons: [] });
    expect(checkReceipt({ ...good, note: "", transferRef: "GT\u0667K\u0663M\u0669Q" }, payment, now).ok).toBe(true);
  });
  it("Arabic digits do not make a different code match", () => {
    expect(checkReceipt({ ...good, note: "GT-\u0668K\u0663M\u0669Q" }, payment, now).reasons).toEqual(["reference_mismatch"]);
  });
});

describe("fold digits", () => {
  it("maps Arabic-Indic and Eastern Arabic-Indic digits to ASCII", () => {
    expect(fold("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669")).toBe("0123456789");
    expect(fold("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9")).toBe("0123456789");
  });
});

describe("cleanReceipt + fold", () => {
  it("rejects a wrong shape and clamps confidence", () => {
    expect(cleanReceipt(null)).toBeNull();
    expect(cleanReceipt({ amountQar: 20 })).toBeNull();
    expect(cleanReceipt({ ...good, confidence: 7 })?.confidence).toBe(1);
  });
  it("fold ignores spaces, dashes, case and Arabic marks", () => {
    expect(fold("cr - 236 988")).toBe(fold("CR-236988"));
    expect(fold("جِستالتونج")).toBe(fold("جستالتونج"));
  });
  it("fold treats null/undefined as empty", () => {
    expect(fold(null)).toBe("");
    expect(fold(undefined)).toBe("");
  });
});
