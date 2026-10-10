import { describe, expect, it } from "vitest";

import { DEFAULT_QUOTE_METHOD, normalizeQuoteMethod } from "./quote-method";

describe("normalizeQuoteMethod", () => {
  it("defaults empty / missing / not sure to not_sure", () => {
    for (const v of [undefined, null, "", "  ", "not_sure", "Not sure", "banana", 3]) {
      expect(normalizeQuoteMethod(v)).toBe(DEFAULT_QUOTE_METHOD);
    }
  });
  it("keeps real methods", () => {
    expect(normalizeQuoteMethod("edm")).toBe("edm");
    expect(normalizeQuoteMethod("3d_printing")).toBe("3d_printing");
    expect(normalizeQuoteMethod("cnc_machining")).toBe("cnc_machining");
  });
});
