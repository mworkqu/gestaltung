import { describe, expect, it } from "vitest";

import type { Analysis } from "./analysis";
import { aiConsentOf, hasAiConsent, mergeAnalysis, type Spec } from "./spec";

const consent = { at: "2026-09-26T10:00:00.000Z", destination: "Google Gemini" };

const baseSpec: Spec = {
  summary: "",
  rows: [],
  questions: [],
  confirmed: false,
  provider: "gemini",
  fallback: null,
};

describe("hasAiConsent", () => {
  it("is false with no spec", () => {
    expect(hasAiConsent(null)).toBe(false);
    expect(hasAiConsent(undefined)).toBe(false);
  });

  it("is false when no consent was recorded", () => {
    expect(hasAiConsent(baseSpec)).toBe(false);
    expect(hasAiConsent({ ...baseSpec, aiConsent: null })).toBe(false);
  });

  it("is true once consent is recorded", () => {
    expect(hasAiConsent({ ...baseSpec, aiConsent: consent })).toBe(true);
  });

  it("only counts consent for the same destination when one is given", () => {
    const spec = { ...baseSpec, aiConsent: consent };
    expect(hasAiConsent(spec, "Google Gemini")).toBe(true);
    expect(hasAiConsent(spec, "Another provider")).toBe(false);
    // null destination = the rules reader; no destination filter applies.
    expect(hasAiConsent(spec, null)).toBe(true);
  });

  it("ignores malformed values from the jsonb column", () => {
    const bad = (v: unknown) => ({ aiConsent: v }) as unknown as Spec;
    expect(hasAiConsent(bad({ at: "not a date", destination: "Google Gemini" }))).toBe(false);
    expect(hasAiConsent(bad({ at: consent.at }))).toBe(false);
    expect(hasAiConsent(bad("yes"))).toBe(false);
    expect(hasAiConsent(bad(true))).toBe(false);
  });

  it("aiConsentOf returns the stored consent", () => {
    expect(aiConsentOf({ ...baseSpec, aiConsent: consent })).toEqual(consent);
  });
});

describe("mergeAnalysis keeps consent", () => {
  const analysis = {
    summary: "s",
    requirements: [],
    questions: [],
    disciplines: [],
    suggestedParts: [],
    bom: [],
  } as unknown as Analysis;

  it("carries consent across a re-analysis", () => {
    const merged = mergeAnalysis({ ...baseSpec, aiConsent: consent }, analysis, {
      provider: "gemini",
      fallback: null,
    });
    expect(merged.aiConsent).toEqual(consent);
  });

  it("has no consent on a first analysis", () => {
    const merged = mergeAnalysis(null, analysis, { provider: "gemini", fallback: null });
    expect(merged.aiConsent ?? null).toBeNull();
  });
});
