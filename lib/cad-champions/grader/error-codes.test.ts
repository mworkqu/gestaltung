import { describe, expect, it } from "vitest";

import { GRADER_ERROR_CODES, graderErrorInfo } from "./error-codes";

describe("graderErrorInfo", () => {
  it("covers every code in both languages with a help slug", () => {
    for (const code of GRADER_ERROR_CODES) {
      for (const locale of ["en", "ar"] as const) {
        const info = graderErrorInfo(code, locale);
        expect(info.code).toBe(code);
        expect(info.message.length).toBeGreaterThan(20);
        expect(info.helpSlug).toMatch(/^[a-z0-9-]+$/);
      }
      expect(graderErrorInfo(code, "ar").message).not.toBe(graderErrorInfo(code, "en").message);
    }
  });

  it("maps slugs as specified", () => {
    expect(graderErrorInfo("E_WRONG_UNITS", "en").helpSlug).toBe("set-units-to-mm");
    expect(graderErrorInfo("E_TOO_LARGE", "en").helpSlug).toBe("my-file-is-too-large");
    for (const c of ["E_NOT_STEP", "E_EMPTY", "E_PARSE_FAILED", "E_INVALID_GEOMETRY", "E_TIMEOUT", "E_MULTIPLE_SOLIDS", "E_NO_SOLID"]) {
      expect(graderErrorInfo(c, "en").helpSlug).toBe("my-file-was-rejected");
    }
  });

  it("uses the agreed wrong-units wording", () => {
    expect(graderErrorInfo("E_WRONG_UNITS", "en").message).toBe(
      "Your model looks about 1000 times too big or too small. Set units to millimetres and export again.",
    );
  });

  it("mentions combining bodies for multiple solids", () => {
    expect(graderErrorInfo("E_MULTIPLE_SOLIDS", "en").message.toLowerCase()).toContain("combine");
  });

  it("falls back for unknown codes", () => {
    const info = graderErrorInfo("E_SOMETHING_NEW", "en");
    expect(info.helpSlug).toBe("my-file-was-rejected");
    expect(info.message.length).toBeGreaterThan(10);
  });
});
