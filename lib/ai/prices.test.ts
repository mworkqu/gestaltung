import { afterEach, describe, expect, it, vi } from "vitest";

import { callCostUsd, modelPrice, WHISPER_USD_PER_HOUR } from "./prices";

afterEach(() => vi.unstubAllEnvs());

describe("modelPrice", () => {
  it("flash-lite is matched before flash, and pro after both", () => {
    expect(modelPrice("gemini-3.5-flash-lite")).toEqual({ in: 0.1, out: 0.4 });
    expect(modelPrice("gemini-3.5-flash")).toEqual({ in: 0.3, out: 2.5 });
    expect(modelPrice("gemini-3.5-pro")).toEqual({ in: 1.25, out: 10 });
    expect(modelPrice("GEMINI-FLASH-LITE")).toEqual({ in: 0.1, out: 0.4 });
  });

  it("is null for an unknown or missing model", () => {
    expect(modelPrice("whisper-large-v3")).toBeNull();
    expect(modelPrice("")).toBeNull();
    expect(modelPrice(null)).toBeNull();
    expect(modelPrice(undefined)).toBeNull();
  });

  it("AI_PRICES overrides by exact (case-insensitive) model name, ignoring bad entries", () => {
    vi.stubEnv("AI_PRICES", JSON.stringify({ "My-Model": { in: 1, out: 2 }, bad: { in: -1, out: 2 }, worse: { in: "x" } }));
    expect(modelPrice("my-model")).toEqual({ in: 1, out: 2 });
    expect(modelPrice("bad")).toBeNull();
    expect(modelPrice("worse")).toBeNull();
    expect(modelPrice("gemini-3.5-flash")).toEqual({ in: 0.3, out: 2.5 });
  });

  it("invalid AI_PRICES JSON falls back to the defaults", () => {
    vi.stubEnv("AI_PRICES", "{not json");
    expect(modelPrice("gemini-3.5-flash-lite")).toEqual({ in: 0.1, out: 0.4 });
  });
});

describe("callCostUsd", () => {
  it("prices input and output per million tokens", () => {
    expect(callCostUsd({ model: "gemini-3.5-flash-lite", promptTokens: 1000, completionTokens: 1000 })).toBeCloseTo(0.0005, 10);
    expect(callCostUsd({ model: "gemini-3.5-flash", promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBeCloseTo(2.8, 10);
  });

  it("bills thinking tokens as output: output = max(completion, total - prompt)", () => {
    const base = { model: "gemini-3.5-flash-lite", promptTokens: 1000, completionTokens: 100 };
    // total 1500 -> 500 billed output tokens
    expect(callCostUsd({ ...base, totalTokens: 1500 })).toBeCloseTo((1000 * 0.1 + 500 * 0.4) / 1e6, 12);
    // total below prompt + completion never lowers the output
    expect(callCostUsd({ ...base, totalTokens: 900 })).toBeCloseTo((1000 * 0.1 + 100 * 0.4) / 1e6, 12);
  });

  it("is 0 for a priced model with no tokens, null for an unpriced one", () => {
    expect(callCostUsd({ model: "gemini-3.5-flash" })).toBe(0);
    expect(callCostUsd({ model: "mystery", promptTokens: 10 })).toBeNull();
    expect(callCostUsd({})).toBeNull();
  });

  it("ignores negative token counts", () => {
    expect(callCostUsd({ model: "gemini-3.5-flash", promptTokens: -50, completionTokens: -5 })).toBe(0);
  });

  it("audio is priced per hour of audio, whatever the model", () => {
    expect(callCostUsd({ model: "whisper-large-v3", audioSeconds: 3600 })).toBeCloseTo(WHISPER_USD_PER_HOUR, 12);
    expect(callCostUsd({ audioSeconds: 1800 })).toBeCloseTo(WHISPER_USD_PER_HOUR / 2, 12);
  });

  it("zero audio seconds falls through to token pricing", () => {
    expect(callCostUsd({ model: "gemini-3.5-flash", audioSeconds: 0, promptTokens: 1_000_000 })).toBeCloseTo(0.3, 10);
  });
});
