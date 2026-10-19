import { describe, expect, it } from "vitest";

import { analysisFingerprint, normaliseBrief } from "./analysis-request";
import type { Answer } from "./analysis";

const req = (brief: string, answers: Answer[] = [], locale: "en" | "ar" = "en") => ({ brief, answers, locale });

describe("analysisFingerprint", () => {
  it("is the same for the same request, so a repeat run can be recognised", () => {
    expect(analysisFingerprint(req("A plant monitor with four LEDs."))).toBe(
      analysisFingerprint(req("A plant monitor with four LEDs."))
    );
  });

  it("ignores whitespace a client did not mean to change", () => {
    expect(analysisFingerprint(req("  A plant\n\nmonitor  with four LEDs. "))).toBe(
      analysisFingerprint(req("A plant monitor with four LEDs."))
    );
  });

  it("changes when the brief changes, so a real edit is analysed again", () => {
    expect(analysisFingerprint(req("A plant monitor with four LEDs."))).not.toBe(
      analysisFingerprint(req("A plant monitor with five LEDs."))
    );
  });

  it("changes when the client settles a question", () => {
    const brief = "A plant monitor with four LEDs.";
    expect(analysisFingerprint(req(brief))).not.toBe(
      analysisFingerprint(req(brief, [{ id: "quantity", label: "Quantity", value: "10" }]))
    );
  });

  it("does not depend on the order the answers arrive in", () => {
    const brief = "A plant monitor with four LEDs.";
    const a: Answer = { id: "quantity", label: "Quantity", value: "10" };
    const b: Answer = { id: "power", label: "Power", value: "mains" };
    expect(analysisFingerprint(req(brief, [a, b]))).toBe(analysisFingerprint(req(brief, [b, a])));
  });

  it("treats a cleared answer as different from no answer at all", () => {
    const brief = "A plant monitor with four LEDs.";
    expect(analysisFingerprint(req(brief, [{ id: "quantity", label: "Quantity", value: null }]))).not.toBe(
      analysisFingerprint(req(brief))
    );
  });

  it("separates the two languages: the same brief is read differently in each", () => {
    expect(analysisFingerprint(req("A plant monitor.", [], "en"))).not.toBe(
      analysisFingerprint(req("A plant monitor.", [], "ar"))
    );
  });

  it("keeps case: 'RED' and 'red' can read differently", () => {
    expect(analysisFingerprint(req("A RED enclosure."))).not.toBe(analysisFingerprint(req("A red enclosure.")));
  });

  it("fits the column it is stored in", () => {
    expect(analysisFingerprint(req("A plant monitor."))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("normaliseBrief", () => {
  it("collapses every run of whitespace to one space", () => {
    expect(normaliseBrief("one\t two\n\nthree ")).toBe("one two three");
  });
});
