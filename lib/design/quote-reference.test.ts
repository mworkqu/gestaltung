import { describe, expect, it } from "vitest";

import { quoteReference } from "@/lib/design/quote-reference";

describe("quoteReference", () => {
  it("derives a stable short reference from the row id", () => {
    const id = "3f2a91c4-1b2c-4d5e-8f90-a1b2c3d4e5f6";
    expect(quoteReference(id)).toBe("Q-3F2A91C4");
    expect(quoteReference(id.toUpperCase())).toBe("Q-3F2A91C4");
  });

  it("returns null for anything that is not a uuid", () => {
    expect(quoteReference("")).toBeNull();
    expect(quoteReference("123")).toBeNull();
    expect(quoteReference("Q-3F2A91C4")).toBeNull();
  });
});
