import { describe, expect, it } from "vitest";

import { quoteReceivedEmail } from "@/lib/email/quote-received-email";

describe("quoteReceivedEmail", () => {
  it("carries the reference and the file name in EN and AR", () => {
    for (const locale of ["en", "ar"] as const) {
      const m = quoteReceivedEmail({ locale, reference: "Q-3F2A91C4", fileName: "bracket.step", fileUploaded: true });
      expect(m.subject).toContain("Q-3F2A91C4");
      expect(m.html).toContain("Q-3F2A91C4");
      expect(m.html).toContain("bracket.step");
      expect(m.text).toContain("bracket.step");
    }
  });
});
