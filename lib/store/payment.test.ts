import { describe, expect, it } from "vitest";

import { paymentSummary } from "./payment";

describe("paymentSummary", () => {
  it("prices every AI call at the set rate and waives it during launch", () => {
    const s = paymentSummary({ aiCalls: 7, perCallQar: 20, partsQar: 120.5, charging: false });
    expect(s.lines).toEqual([
      { key: "ai", qty: 7, unitQar: 20, amountQar: 140 },
      { key: "parts", amountQar: 120.5 },
    ]);
    expect(s.totalQar).toBe(260.5);
    expect(s.dueQar).toBe(0);
    expect(s.waivedQar).toBe(140);
  });
  it("charges the AI generations once charging is on (parts are paid at checkout)", () => {
    const s = paymentSummary({ aiCalls: 3, perCallQar: 20, partsQar: 50, charging: true });
    expect(s.dueQar).toBe(60);
    expect(s.waivedQar).toBe(0);
  });
  it("never goes negative on bad input", () => {
    expect(paymentSummary({ aiCalls: -2, perCallQar: -1, partsQar: -5, charging: true }).totalQar).toBe(0);
  });
});
