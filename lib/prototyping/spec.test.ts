import { describe, expect, it } from "vitest";

import type { Analysis } from "./analysis";
import { aiConsentOf, hasAiConsent, mergeAnalysis, nextOpenQuestion, setFact, type Spec } from "./spec";

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

// The project's own record of its latest analysis: without it the only trace of
// a run is analysis_runs, and the 18 Oct 2026 export showed an empty `analysis`
// block beside 24 recorded runs.
describe("mergeAnalysis records when the analysis ran", () => {
  const analysis = {
    summary: "s",
    requirements: [],
    questions: [],
    disciplines: [],
    suggestedParts: [],
    bom: [],
  } as unknown as Analysis;

  it("stores the run time on the spec", () => {
    const merged = mergeAnalysis(null, analysis, {
      provider: "gemini",
      fallback: null,
      runAt: "2026-10-18T05:45:02.378Z",
    });
    expect(merged.runAt).toBe("2026-10-18T05:45:02.378Z");
  });

  it("keeps the earlier run time when none is given", () => {
    const prev = { ...baseSpec, runAt: "2026-10-18T05:45:02.378Z" };
    expect(mergeAnalysis(prev, analysis, { provider: "gemini", fallback: null }).runAt).toBe(prev.runAt);
  });

  it("is null on a spec that has never been analysed", () => {
    expect(mergeAnalysis(null, analysis, { provider: "rules", fallback: "missing_key" }).runAt).toBeNull();
  });
});

describe("nextOpenQuestion", () => {
  const q = (id: string) => ({ id, label: id, type: "number" as const });
  const spec = (ids: string[]): Spec => ({ ...baseSpec, questions: ids.map(q) });

  it("is null with no spec and with nothing open", () => {
    expect(nextOpenQuestion(null)).toBeNull();
    expect(nextOpenQuestion(baseSpec)).toBeNull();
  });

  it("prefers a standard fact, because only those block", () => {
    expect(nextOpenQuestion(spec(["colour", "power"]))?.id).toBe("power");
  });

  it("falls back to the first optional question", () => {
    expect(nextOpenQuestion(spec(["colour", "finish"]))?.id).toBe("colour");
  });

  it("skips a question the client already answered", () => {
    const answered = setFact(spec(["power", "quantity"]), { id: "power", label: "power" }, "mains");
    expect(nextOpenQuestion(answered)?.id).toBe("quantity");
  });

  it("counts 'not decided yet' as an answer", () => {
    const answered = setFact(spec(["power"]), { id: "power", label: "power" }, null);
    expect(nextOpenQuestion(answered)).toBeNull();
  });
});
