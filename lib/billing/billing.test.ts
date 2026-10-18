import { describe, expect, it } from "vitest";

import { MAKER_PASS, TOKEN_PACKS, TOKEN_PRICE_QAR, productById } from "./config";
import { checkReceipt, cleanReceipt, fold, type Receipt } from "./verify";

describe("billing config", () => {
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
const payment = { amountQar: 20, createdAt: new Date("2026-10-18T11:50:00+03:00") };
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
});
