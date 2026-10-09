import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRICE_CODE_KEY,
  clearStoredCode,
  conversionPct,
  normaliseCode,
  parseCohortFunnel,
  parseQuote,
  parseQuoteRows,
  readCodeFromSearch,
  readStoredCode,
  storeCode,
} from "./experiment";

describe("normaliseCode", () => {
  it("trims and upper-cases", () => {
    expect(normaliseCode("  early-15 ")).toBe("EARLY-15");
    expect(normaliseCode("abc")).toBe("ABC");
  });
  it("rejects bad shapes", () => {
    for (const bad of ["", "ab", "a b c", "x".repeat(33), "ab$c", "عربي1", null, undefined, 5, {}]) {
      expect(normaliseCode(bad)).toBeNull();
    }
  });
  it("accepts the 32 character limit", () => {
    expect(normaliseCode("a".repeat(32))).toBe("A".repeat(32));
  });
});

describe("readCodeFromSearch", () => {
  it("reads ?code=", () => {
    expect(readCodeFromSearch("?code=early-15")).toBe("EARLY-15");
    expect(readCodeFromSearch("?x=1&code=abc")).toBe("ABC");
  });
  it("returns null without a valid code", () => {
    expect(readCodeFromSearch("")).toBeNull();
    expect(readCodeFromSearch("?code=")).toBeNull();
    expect(readCodeFromSearch("?code=a")).toBeNull();
    expect(readCodeFromSearch("?other=abc")).toBeNull();
  });
});

describe("parseQuote", () => {
  it("accepts positive numbers and numeric strings", () => {
    expect(parseQuote(15)).toBe(15);
    expect(parseQuote("17.50")).toBe(17.5);
    expect(parseQuote(" 20 ")).toBe(20);
  });
  it("rejects everything else", () => {
    for (const bad of [null, undefined, 0, -1, "0", "-5", "abc", "", NaN, Infinity, "1e3", [], {}, true]) {
      expect(parseQuote(bad)).toBeNull();
    }
  });
});

describe("parseQuoteRows", () => {
  it("takes the credit_qar of the first valid row", () => {
    expect(parseQuoteRows([{ cohort: "A", credit_qar: "15" }])).toBe(15);
    expect(parseQuoteRows([{ cohort: "A", credit_qar: null }, { cohort: "B", credit_qar: 25 }])).toBe(25);
  });
  it("is null for no rows or bad data", () => {
    expect(parseQuoteRows([])).toBeNull();
    expect(parseQuoteRows(null)).toBeNull();
    expect(parseQuoteRows({ credit_qar: 15 })).toBeNull();
    expect(parseQuoteRows([null, 3, { credit_qar: 0 }])).toBeNull();
  });
});

describe("stored code (localStorage)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeWindow = (store: Record<string, string>) => ({
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    },
  });

  it("round-trips a code", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", fakeWindow(store));
    expect(readStoredCode()).toBeNull();
    expect(storeCode(" early-15 ")).toBe(true);
    expect(store[PRICE_CODE_KEY]).toBe("EARLY-15");
    expect(readStoredCode()).toBe("EARLY-15");
    clearStoredCode();
    expect(readStoredCode()).toBeNull();
  });

  it("refuses to store an invalid code", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", fakeWindow(store));
    expect(storeCode("a")).toBe(false);
    expect(store).toEqual({});
  });

  it("ignores a stored value that is not a valid code", () => {
    vi.stubGlobal("window", fakeWindow({ [PRICE_CODE_KEY]: "<script>" }));
    expect(readStoredCode()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(readStoredCode()).toBeNull();
    expect(storeCode("abc")).toBe(false);
    expect(() => clearStoredCode()).not.toThrow();
  });

  it("does nothing without a window", () => {
    expect(readStoredCode()).toBeNull();
    expect(storeCode("abc")).toBe(false);
    expect(() => clearStoredCode()).not.toThrow();
  });
});

describe("parseCohortFunnel", () => {
  it("maps rows and coerces counts", () => {
    expect(
      parseCohortFunnel([
        { cohort: "EARLY-15", users: 10, with_project: "6", bought_credits: 2, with_order: 1 },
        { cohort: "X", users: null },
      ]),
    ).toEqual([
      { cohort: "EARLY-15", users: 10, withProject: 6, boughtCredits: 2, withOrder: 1 },
      { cohort: "X", users: 0, withProject: 0, boughtCredits: 0, withOrder: 0 },
    ]);
  });
  it("is empty for anything else", () => {
    expect(parseCohortFunnel(null)).toEqual([]);
    expect(parseCohortFunnel({})).toEqual([]);
    expect(parseCohortFunnel([{ users: 3 }, 5, null, { cohort: " " }])).toEqual([]);
  });
});

describe("conversionPct", () => {
  it("rounds to a whole percent", () => {
    expect(conversionPct(1, 3)).toBe("33%");
    expect(conversionPct(2, 3)).toBe("67%");
    expect(conversionPct(0, 5)).toBe("0%");
  });
  it("shows a dash with no users", () => {
    expect(conversionPct(0, 0)).toBe("—");
    expect(conversionPct(3, 0)).toBe("—");
  });
});
